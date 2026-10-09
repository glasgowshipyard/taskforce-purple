// PAC gifts and each PAC's own donors (#57), on a tiny made-up set of files.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { pacPeopleCredit, tracePacs } from '../../../workers/tier-calculation.js';
import { asPacContributions, pacGifts, pacProfiles, pacSummary } from './pacs.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tfp-pacs-'));
const indiv = (cmte, name, amount, sub) =>
  [
    cmte,
    'N',
    'Q1',
    'P',
    '1',
    '15',
    'IND',
    name,
    'X',
    'OH',
    '43215',
    '',
    '',
    '01152026',
    String(amount),
    '',
    `T${sub}`,
    '1',
    '',
    '',
    String(sub),
  ].join('|');
// A union PAC funded by many people, a company PAC funded by two executives
writeFileSync(
  join(dir, 'itcont.txt'),
  [
    ...Array.from({ length: 40 }, (_, i) => indiv('C00000010', `MEMBER, NUMBER${i}`, 250, i)),
    indiv('C00000020', 'EXEC, ONE', 5000, 100),
    indiv('C00000020', 'EXEC, TWO', 5000, 101),
  ].join('\n')
);

async function db() {
  const conn = await (await DuckDBInstance.create(':memory:')).connect();
  await conn.run(`CREATE TABLE cm AS SELECT * FROM (VALUES
    ('C00000010', 'TEACHERS UNION PAC', 'Q', 'B', 'L', 'TEACHERS UNION'),
    ('C00000020', 'ACME CORP PAC', 'Q', 'U', 'C', 'ACME CORP'),
    ('C00000030', 'STATE PARTY', 'Y', 'U', NULL, NULL),
    ('C00000040', 'SENATOR X LEADERSHIP PAC', 'Q', 'D', NULL, NULL),
    ('C00000099', 'MEMBER CAMPAIGN', 'H', 'P', NULL, NULL)
  ) t(id, name, type, designation, org_type, connected_org)`);
  await conn.run(`CREATE TABLE oth AS SELECT * FROM (VALUES
    ('C00000010', 'C00000099', '24K', 5000.0),
    ('C00000010', 'C00000099', '24K', 2500.0),
    ('C00000020', 'C00000099', '24K', 5000.0),
    ('C00000030', 'C00000099', '24K', 5000.0),
    ('C00000040', 'C00000099', '24Z', 1000.0),
    ('C00000099', 'C00000040', '24K', 2000.0)
  ) t(committee_id, other_id, tx_type, amount)`);
  await conn.run(`CREATE TABLE webk AS SELECT * FROM (VALUES
    ('C00000010', 50000.0, 0.0, 48000.0, 2000.0),
    ('C00000020', 10000.0, 0.0, 10000.0, 0.0)
  ) t(id, receipts, from_affiliates, individuals, other_committees)`);
  return { read: async (sql, ...p) => (await conn.runAndReadAll(sql, p)).getRowObjectsJS() };
}

describe('PAC gifts (#57)', () => {
  it('every PAC gift to the member, by kind; party committees left out', async () => {
    const gifts = await pacGifts(await db(), ['C00000099']);
    expect(gifts.map(g => [g.name, g.kind, g.orgType, g.amount])).toEqual([
      ['TEACHERS UNION PAC', 'lobbyist', 'L', 7500],
      ['ACME CORP PAC', 'group', 'C', 5000],
      ['SENATOR X LEADERSHIP PAC', 'politician', null, 1000],
    ]);
    expect(asPacContributions(gifts)[0]).toEqual({
      pacName: 'TEACHERS UNION PAC',
      amount: 7500,
      contributorId: 'C00000010',
      committee_type: 'Q',
      designation: 'B',
    });
  });

  it("each PAC's own donors: many people versus a few", async () => {
    const d = await db();
    const profiles = await pacProfiles(d, join(dir, 'itcont.txt'), ['C00000010', 'C00000020']);
    expect(profiles.get('C00000010')).toEqual({
      receipts: 50000,
      individuals: 48000,
      fromAffiliates: 0,
      otherCommittees: 2000,
      itemized: 10000,
      donors: 40,
      nakamoto: 20,
    });
    expect(profiles.get('C00000020')).toMatchObject({ itemized: 10000, donors: 2, nakamoto: 1 });
    const gifts = await pacGifts(d, ['C00000099']);
    const traced = tracePacs(profiles);
    const summary = pacSummary(gifts, profiles, traced);
    expect(summary).toMatchObject({
      total: 13500,
      count: 3,
      byKind: { lobbyist: 7500, group: 5000, politician: 1000 },
      counted: pacPeopleCredit(gifts, traced),
    });
    expect(summary.counted).toBeGreaterThan(0);
    expect(summary.list[0].profile.donors).toBe(40);
    // Each PAC's share traced to people, as the grade counts it
    expect(summary.list[0].peopleShare).toBeCloseTo(traced.get(summary.list[0].id)[2].share, 3);
    expect(summary.list.find(p => !profiles.has(p.id)).peopleShare).toBeNull();
  });
});
