// Publishing grades to the site (Stage 3, REBUILD_SPEC §6-7; owner's yes
// 2026-10-05). The refresh job's results live in D1 `tfp-results`; the site
// lists members from KV `members:list`. Publishing lays each member's graded
// result over their stored record and rewrites the list ONCE, only if
// anything in it changed. A member's page reads its detail from D1 directly
// (the API worker's /api/member-detail), so no per-member KV record is
// written: one KV write per publish instead of about 1,080 (the free plan
// allows 1,000 a day).
//
// Every published grade change is kept in `grade_history`.

import {
  LIST_KEY,
  listBody,
  listEntry,
  memberKey,
  publishedMember,
  sameValue,
} from '../../../workers/member-store.js';

const parse = s => (s ? JSON.parse(s) : null);

/**
 * @returns {{ changed: boolean, published: number, gradeChanges: object[] }}
 */
export async function publishGrades({ cf, d1, cycle, log = () => {}, dryRun = false }) {
  const current = parse(await cf.kvGet(LIST_KEY));
  if (!current?.members?.length) {
    throw new Error('publish: members:list is missing; nothing to publish onto');
  }
  const rows = await d1(
    'SELECT bioguide_id, cycle, computed_at, status, grade, analysis FROM results WHERE cycle = ?',
    [cycle]
  );
  const results = new Map(
    rows.map(r => [r.bioguide_id, { ...r, grade: parse(r.grade), analysis: parse(r.analysis) }])
  );

  const entries = [];
  const gradeChanges = [];
  let published = 0;
  let newest = current.lastUpdated || null;
  for (const old of current.members) {
    const r = results.get(old.bioguideId);
    const record = r?.grade?.tier ? parse(await cf.kvGet(memberKey(old.bioguideId))) : null;
    if (!record) {
      // Not graded by the refresh job (no FEC identity, pending, or no
      // record): the list keeps what it has
      entries.push(old);
      continue;
    }
    const entry = listEntry(publishedMember(record, r));
    entries.push(entry);
    published++;
    if (r.computed_at && (!newest || r.computed_at > newest)) {
      newest = r.computed_at;
    }
    if (entry.tier !== old.tier) {
      gradeChanges.push({ id: old.bioguideId, name: old.name, from: old.tier, to: entry.tier });
    }
  }

  const body = listBody(entries, {
    lastUpdated: newest,
    adaptiveThresholds: current.adaptiveThresholds,
  });
  if (sameValue(body, current)) {
    log(`publish: ${published} graded member(s), nothing on the site changes`);
    return { changed: false, published, gradeChanges };
  }
  log(
    `publish: ${published} graded member(s); ${gradeChanges.length} grade(s) change${dryRun ? ' (dry run: not written)' : ''}`
  );
  if (!dryRun) {
    await cf.kvPut(LIST_KEY, JSON.stringify(body));
    const now = new Date().toISOString();
    for (let i = 0; i < gradeChanges.length; i += 10) {
      const batch = gradeChanges.slice(i, i + 10);
      await d1(
        `INSERT INTO grade_history (bioguide_id, cycle, changed_at, old_tier, new_tier) VALUES ${batch
          .map(() => '(?,?,?,?,?)')
          .join(',')}`,
        batch.flatMap(c => [c.id, cycle, now, c.from ?? null, c.to])
      );
    }
  }
  return { changed: true, published, gradeChanges };
}
