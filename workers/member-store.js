// Member storage: one KV record per member, plus a slim list for the site.
// REBUILD_SPEC.md §7, Stage 1.
//
// Replaces the single 3.5 MB `members:all` value, which every update
// rewrote whole and every page view re-parsed (#46). The rules here:
//   - `member:{bioguideId}` holds one member's full record. It is written only
//     when a field actually differs.
//   - `members:list` holds the exact JSON body `/api/members` returns: only
//     the fields the list page and the RUNBOOK checks read. The API worker
//     serves it as stored, without parsing it. It is rewritten at most once
//     per invocation, and only when a list-visible field changed.
//   - Until the migration has written a member's own key, reads fall back to
//     `members:all`.

import { getCommitteeCategory, getPACTransparencyWeight } from './tier-calculation.js';
import { quicklookSectors } from '../src/lib/donor-taxonomy.js';

export const MEMBER_KEY_PREFIX = 'member:';
export const LIST_KEY = 'members:list';
export const LEGACY_KEY = 'members:all';
export const memberKey = bioguideId => `${MEMBER_KEY_PREFIX}${bioguideId}`;

// Fields of the served member that the list page, `/api/status` and the
// RUNBOOK checks read. Heavy fields (PAC donation lists, FARA firms, conduit
// lists, committee details) are served per member by /api/member-detail.
export const LIST_FIELDS = [
  'bioguideId',
  'name',
  'party',
  'state',
  'district',
  'chamber',
  'tier',
  'totalRaised',
  'grassrootsPercent',
  'rawFECGrassrootsPercent',
  'grassrootsDonations',
  'largeDonorDonations',
  'pacMoney',
  'individualFundingPercent',
  'gradeBasis',
  'personFigures',
  'evidenceChecked',
  'fecIdentityVerified',
  'nakamotoCoefficient',
  'faraEmployerTotal',
  'pacDetailsStatus',
  'lastUpdated',
];

// --- The served form of a member (moved unchanged from data-pipeline.js) ---

export function calculateEnhancedGrassrootsPercent(member) {
  if (!member.totalRaised || member.totalRaised === 0) {
    return member.grassrootsPercent || 0;
  }
  // grassrootsDonations is the FEC's individual_unitemized_contributions (<$200)
  if (member.grassrootsDonations !== undefined) {
    return Math.round((member.grassrootsDonations / member.totalRaised) * 100);
  }
  return member.grassrootsPercent || 0;
}

export function getGrassrootsPACTypesSummary(member) {
  if (!member.pacContributions?.length) {
    return null;
  }
  const grassrootsFriendlyTypes = new Set();
  for (const pac of member.pacContributions) {
    const weight =
      pac.committee_type || pac.designation
        ? getPACTransparencyWeight(pac.committee_type, pac.designation)
        : 1.0;
    // Only PAC types that are grassroots-friendly (weight < 1.0)
    if (weight < 1.0) {
      grassrootsFriendlyTypes.add(getCommitteeCategory(pac.committee_type, pac.designation));
    }
  }
  return grassrootsFriendlyTypes.size > 0 ? Array.from(grassrootsFriendlyTypes) : null;
}

/**
 * What the API serves for a member: exactly the transform `/api/members`
 * applied to every record on every request before Stage 1. It is now applied
 * once, when the record is written (list) or read (detail).
 */
export function servedMember(member) {
  return {
    ...member,
    grassrootsPercent: calculateEnhancedGrassrootsPercent(member),
    rawFECGrassrootsPercent: member.grassrootsPercent, // the original, for reference
    hasEnhancedData:
      member.pacContributions &&
      member.pacContributions.length > 0 &&
      member.pacContributions.some(pac => pac.committee_type || pac.designation),
    grassrootsPACTypes: getGrassrootsPACTypesSummary(member),
    nakamotoCoefficient: member.nakamotoCoefficient ?? null,
    nakamotoPercent: member.nakamotoPercent ?? null,
    uniqueDonors: member.uniqueDonors ?? null,
    top10Concentration: member.top10Concentration ?? null,
  };
}

/**
 * A member as published: their stored record with the refresh job's result
 * for the cycle laid over it (Stage 3, REBUILD_SPEC §6-7). `result` is a row
 * of D1 tfp-results `results` with its JSON columns parsed. A member with no
 * graded result (none yet, or pending) is published as stored.
 *
 * The grade, its basis and evidence state come from the result; so do the
 * donor figures it was graded on (concentration, conduits, foreign-agent
 * employers). Everything else (name, seat, PAC list, social handles) stays
 * from the record.
 */
export function publishedMember(record, result) {
  const g = result?.grade;
  if (!g?.tier) {
    return record;
  }
  const a = result.analysis || {};
  const donors = a.uniqueDonors ?? null;
  return {
    ...record,
    tier: g.tier,
    individualFundingPercent: g.individualFundingPercent ?? null,
    gradeBasis: g.gradeBasis,
    personFigures: g.personFigures ?? null,
    evidenceChecked: g.evidenceChecked ?? null,
    gradeCycle: result.cycle,
    gradedAt: result.computed_at,
    uniqueDonors: donors,
    nakamotoCoefficient: a.nakamotoCoefficient ?? null,
    nakamotoPercent:
      donors && a.nakamotoCoefficient !== null && a.nakamotoCoefficient !== undefined
        ? (a.nakamotoCoefficient / donors) * 100
        : null,
    top10Concentration: a.top10Concentration ?? null,
    topConduits: a.conduits || [],
    earmarkedIndividualTotal: a.earmarkedTotal ?? null,
    faraFirms: a.faraFirms || [],
    faraEmployerTotal: a.faraEmployerTotal ?? null,
  };
}

/**
 * One member's entry in `members:list`. Includes two small derived fields so
 * the list never needs the heavy conduit list: the warning-icon sectors for
 * the row (`quicklook`) and how many conduits there are (`conduitCount`).
 */
export function listEntry(member) {
  const served = servedMember(member);
  const entry = {};
  for (const field of LIST_FIELDS) {
    if (served[field] !== undefined) {
      entry[field] = served[field];
    }
  }
  entry.quicklook = quicklookSectors(served);
  entry.conduitCount = Array.isArray(served.topConduits) ? served.topConduits.length : 0;
  return entry;
}

/** The `/api/members` response body, stored as `members:list`. */
export function listBody(entries, { lastUpdated, adaptiveThresholds }) {
  return { members: entries, lastUpdated, total: entries.length, adaptiveThresholds };
}

// --- Comparison: key order must not count as a change ---

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter(k => value[k] !== undefined)
        .map(k => [k, canonical(value[k])])
    );
  }
  return value;
}

export function sameValue(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// --- Reading ---

/**
 * One member's full record, or null. Falls back to `members:all` only while
 * the member has no key of their own (before the migration).
 */
export async function getMember(env, bioguideId) {
  const raw = await env.MEMBER_DATA.get(memberKey(bioguideId));
  if (raw) {
    return JSON.parse(raw);
  }
  const legacy = await env.MEMBER_DATA.get(LEGACY_KEY);
  if (!legacy) {
    return null;
  }
  return JSON.parse(legacy).find(m => m.bioguideId === bioguideId) || null;
}

/** The stored list body, or null before the migration. */
export async function getListBody(env) {
  const raw = await env.MEMBER_DATA.get(LIST_KEY);
  return raw ? JSON.parse(raw) : null;
}

// --- Writing ---

/**
 * The only way member data is written. Use one writer per invocation:
 *
 *   const writer = new MemberWriter(env);
 *   await writer.save(before, after);   // writes member:{id} only if it differs
 *   await writer.remove(bioguideId);    // deletes member:{id}
 *   await writer.flush();               // one members:list write, if needed
 *
 * `before` is the record as read (or null for a new member).
 */
export class MemberWriter {
  constructor(env, { now = () => new Date().toISOString() } = {}) {
    this.env = env;
    this.now = now;
    this.listPatches = new Map(); // bioguideId -> new entry, or null to remove
    this.stats = { memberWrites: 0, unchanged: 0, removed: 0, listWrites: 0 };
  }

  async save(before, after) {
    if (!after?.bioguideId) {
      throw new Error('MemberWriter.save: record has no bioguideId');
    }
    if (before && sameValue(before, after)) {
      this.stats.unchanged++;
      return false;
    }
    await this.env.MEMBER_DATA.put(memberKey(after.bioguideId), JSON.stringify(after));
    this.stats.memberWrites++;
    const entry = listEntry(after);
    if (!before || !sameValue(listEntry(before), entry)) {
      this.listPatches.set(after.bioguideId, entry);
    }
    return true;
  }

  async remove(bioguideId) {
    await this.env.MEMBER_DATA.delete(memberKey(bioguideId));
    this.stats.removed++;
    this.listPatches.set(bioguideId, null);
  }

  /** Writes `members:list` once, only if a list-visible field changed. */
  async flush() {
    if (this.listPatches.size === 0) {
      return false;
    }
    const body = await getListBody(this.env);
    if (!body) {
      throw new Error(
        'members:list does not exist yet: run the Stage 1 migration before writing members'
      );
    }
    const entries = [];
    for (const entry of body.members) {
      if (!this.listPatches.has(entry.bioguideId)) {
        entries.push(entry);
        continue;
      }
      const patched = this.listPatches.get(entry.bioguideId);
      this.listPatches.delete(entry.bioguideId);
      if (patched) {
        entries.push(patched);
      }
    }
    // Members not in the list yet (new members) go at the end
    for (const patched of this.listPatches.values()) {
      if (patched) {
        entries.push(patched);
      }
    }
    // The site's "last updated" is when the list's data last changed (#38)
    const next = listBody(entries, {
      lastUpdated: this.now(),
      adaptiveThresholds: body.adaptiveThresholds,
    });
    await this.env.MEMBER_DATA.put(LIST_KEY, JSON.stringify(next));
    this.listPatches.clear();
    this.stats.listWrites++;
    return true;
  }
}
