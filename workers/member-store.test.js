import { describe, expect, it } from 'vitest';
import {
  LIST_KEY,
  LEGACY_KEY,
  MemberWriter,
  getMember,
  listBody,
  listEntry,
  memberKey,
  publishedMember,
  sameValue,
  servedMember,
} from './member-store.js';

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  const log = [];
  return {
    store,
    log,
    get: async k => store.get(k) ?? null,
    put: async (k, v) => {
      log.push(['put', k]);
      store.set(k, v);
    },
    delete: async k => {
      log.push(['delete', k]);
      store.delete(k);
    },
  };
}

const member = (id, extra = {}) => ({
  bioguideId: id,
  name: `Member ${id}`,
  party: 'Independent',
  state: 'VT',
  chamber: 'Senate',
  tier: 'B',
  totalRaised: 1000,
  grassrootsDonations: 600,
  grassrootsPercent: 55,
  pacContributions: [{ pacName: 'X PAC', amount: 500, committee_type: 'Q', designation: 'B' }],
  topConduits: [{ name: 'ACTBLUE', amount: 10 }],
  ...extra,
});

function seeded(members) {
  const entries = members.map(listEntry);
  return fakeKV({
    ...Object.fromEntries(members.map(m => [memberKey(m.bioguideId), JSON.stringify(m)])),
    [LIST_KEY]: JSON.stringify(
      listBody(entries, { lastUpdated: 'old', adaptiveThresholds: { houseThreshold: 1 } })
    ),
  });
}

describe('servedMember and listEntry', () => {
  it('applies the transform /api/members always applied', () => {
    const s = servedMember(member('A000001'));
    expect(s.grassrootsPercent).toBe(60); // 600 / 1000, not the stored 55
    expect(s.rawFECGrassrootsPercent).toBe(55);
    expect(s.hasEnhancedData).toBe(true);
    expect(s.nakamotoCoefficient).toBeNull();
  });

  it('the list entry carries no heavy fields', () => {
    const e = listEntry(member('A000001', { faraFirms: [{ name: 'F' }] }));
    expect(e.pacContributions).toBeUndefined();
    expect(e.topConduits).toBeUndefined();
    expect(e.faraFirms).toBeUndefined();
    expect(e.conduitCount).toBe(1);
    expect(Array.isArray(e.quicklook)).toBe(true);
    expect(e.grassrootsPercent).toBe(60);
  });
});

describe('sameValue', () => {
  it('ignores key order', () => {
    expect(sameValue({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('MemberWriter', () => {
  it('writes nothing when nothing changed', async () => {
    const m = member('A000001');
    const kv = seeded([m]);
    const w = new MemberWriter({ MEMBER_DATA: kv });
    expect(await w.save(m, { ...m })).toBe(false);
    expect(await w.flush()).toBe(false);
    expect(kv.log).toEqual([]);
  });

  it('a hidden-field change writes the member but not the list', async () => {
    const m = member('A000001');
    const kv = seeded([m]);
    const w = new MemberWriter({ MEMBER_DATA: kv });
    await w.save(m, {
      ...m,
      pacContributions: [...m.pacContributions, { pacName: 'Y', amount: 1 }],
    });
    await w.flush();
    expect(kv.log).toEqual([['put', memberKey('A000001')]]);
  });

  it('a list-visible change patches only that entry, in one list write', async () => {
    const a = member('A000001');
    const b = member('B000002');
    const kv = seeded([a, b]);
    const w = new MemberWriter({ MEMBER_DATA: kv }, { now: () => 'now' });
    await w.save(a, { ...a, tier: 'S' });
    await w.save(b, { ...b, tier: 'F' });
    await w.flush();
    expect(kv.log.filter(([, k]) => k === LIST_KEY)).toHaveLength(1);
    const body = JSON.parse(kv.store.get(LIST_KEY));
    expect(body.members.map(e => [e.bioguideId, e.tier])).toEqual([
      ['A000001', 'S'],
      ['B000002', 'F'],
    ]);
    expect(body.lastUpdated).toBe('now');
    expect(body.adaptiveThresholds).toEqual({ houseThreshold: 1 });
    expect(body.total).toBe(2);
  });

  it('adds new members and removes departed ones', async () => {
    const a = member('A000001');
    const kv = seeded([a]);
    const w = new MemberWriter({ MEMBER_DATA: kv });
    await w.save(null, member('C000003'));
    await w.remove('A000001');
    await w.flush();
    const body = JSON.parse(kv.store.get(LIST_KEY));
    expect(body.members.map(e => e.bioguideId)).toEqual(['C000003']);
    expect(kv.store.has(memberKey('A000001'))).toBe(false);
  });

  it('refuses to write the list before the migration has created it', async () => {
    const kv = fakeKV();
    const w = new MemberWriter({ MEMBER_DATA: kv });
    await w.save(null, member('A000001'));
    await expect(w.flush()).rejects.toThrow(/migration/);
  });
});

describe('getMember', () => {
  it("reads the member's own key", async () => {
    const kv = seeded([member('A000001', { tier: 'S' })]);
    expect((await getMember({ MEMBER_DATA: kv }, 'A000001')).tier).toBe('S');
  });

  it('falls back to members:all before the migration', async () => {
    const kv = fakeKV({ [LEGACY_KEY]: JSON.stringify([member('A000001', { tier: 'C' })]) });
    expect((await getMember({ MEMBER_DATA: kv }, 'A000001')).tier).toBe('C');
    expect(await getMember({ MEMBER_DATA: kv }, 'Z999999')).toBeNull();
  });
});

describe('publishedMember', () => {
  const record = {
    bioguideId: 'X000001',
    name: 'Test, Member',
    tier: 'F',
    gradeBasis: 'campaign-committee',
    individualFundingPercent: 6,
    nakamotoCoefficient: 30,
    uniqueDonors: 308,
    pacContributions: [{ committee_type: 'Q' }],
  };
  const result = {
    cycle: 2026,
    computed_at: '2026-10-05T13:30:00Z',
    status: 'provisional',
    grade: {
      tier: 'A',
      individualFundingPercent: 76,
      gradeBasis: 'all-committees',
      personFigures: { totalRaised: 1871800 },
      evidenceChecked: false,
    },
    analysis: {
      uniqueDonors: 3162,
      nakamotoCoefficient: 209,
      top10Concentration: 0.1,
      conduits: [{ name: 'WINRED', amount: 5000, count: 40 }],
      earmarkedTotal: 5000,
      faraFirms: [],
      faraEmployerTotal: 0,
    },
  };

  it('lays the graded result over the stored record', () => {
    const m = publishedMember(record, result);
    expect(m).toMatchObject({
      tier: 'A',
      gradeBasis: 'all-committees',
      evidenceChecked: false,
      individualFundingPercent: 76,
      uniqueDonors: 3162,
      nakamotoCoefficient: 209,
      gradeCycle: 2026,
      topConduits: [{ name: 'WINRED', amount: 5000, count: 40 }],
      earmarkedIndividualTotal: 5000,
    });
    expect(m.nakamotoPercent).toBeCloseTo((209 / 3162) * 100);
    // record-only fields stay
    expect(m.name).toBe('Test, Member');
    expect(m.pacContributions).toEqual(record.pacContributions);
  });

  it('a member with no result yet is published as stored', () => {
    const verified = { ...record, fecIdentityVerified: true };
    expect(publishedMember(verified, null)).toBe(verified);
  });

  it('never with a letter grade on an unconfirmed FEC identity (#41)', () => {
    const m = publishedMember({ ...record, fecIdentityVerified: false }, null);
    expect(m.tier).toBe('UNVERIFIED');
    expect(m.withheldReason).toBe('identity-not-confirmed');
    expect(publishedMember(record, null).tier).toBe('UNVERIFIED'); // never stamped
    // a ringfence already in place is left alone
    expect(publishedMember({ ...record, tier: 'DISPUTED' }, null).tier).toBe('DISPUTED');
  });

  it('nor keeps an old letter grade the refresh job could not confirm (owner, 2026-10-09)', () => {
    // A member whose only committee for the cycle is an ordinary PAC: the
    // job records why and grades nothing; the stored B from the old
    // pipeline is withheld, not shown
    const verified = { ...record, tier: 'B', fecIdentityVerified: true };
    const pending = {
      status: 'pending',
      grade: null,
      reconciliation: {
        ok: false,
        reason: 'no campaign committee, leadership PAC or joint fund registered for the cycle',
      },
    };
    const m = publishedMember(verified, pending);
    expect(m.tier).toBe('UNVERIFIED');
    expect(m.withheldReason).toBe('no-campaign-committee');
    expect(listEntry(m)).toMatchObject({
      tier: 'UNVERIFIED',
      withheldReason: 'no-campaign-committee',
    });
    expect(publishedMember(verified, { status: 'pending', grade: null }).withheldReason).toBe(
      'not-graded'
    );
    // Already withheld (the list's entry): the reason is renewed
    const listed = { ...verified, tier: 'UNVERIFIED', withheldReason: 'not-graded' };
    expect(publishedMember(listed, pending).withheldReason).toBe('no-campaign-committee');
    // Withheld for identity by the old rule (no reason): left alone
    const old = { ...record, tier: 'UNVERIFIED' };
    expect(publishedMember(old, null)).toBe(old);
  });

  it('the list entry carries the evidence state', () => {
    expect(listEntry(publishedMember(record, result))).toMatchObject({
      tier: 'A',
      evidenceChecked: false,
    });
  });
});
