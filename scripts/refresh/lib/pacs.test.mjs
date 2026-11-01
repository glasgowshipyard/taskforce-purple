// PAC gifts and each PAC's own donors (#57), on a tiny made-up set of files.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { describe, expect, it } from 'vitest';
import { pacPeopleCredit, tracePacs } from '../../../workers/tier-calculation.js';
import {
  asPacContributions,
  campaignSideGifts,
  pacGifts,
  pacProfiles,
  pacSummary,
  shortLists,
  nameFromPacReports,
} from './pacs.mjs';

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
    ('C00000010', 'C00000099', '24K', 5000.0, '2026-03-01'),
    ('C00000010', 'C00000099', '24K', 2500.0, '2026-03-01'),
    ('C00000020', 'C00000099', '24K', 5000.0, '2026-03-01'),
    ('C00000030', 'C00000099', '24K', 5000.0, '2026-03-01'),
    ('C00000040', 'C00000099', '24Z', 1000.0, '2026-03-01'),
    ('C00000099', 'C00000040', '24K', 2000.0, '2026-03-01')
  ) t(committee_id, other_id, tx_type, amount, date)`);
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

  it('the gifts as the campaign reported them, party and own committees left out', async () => {
    const side = {
      missing: new Set(),
      byRecipient: new Map([
        [
          'C00000099',
          [
            { giver: 'C00000010', recipient: 'C00000099', amount: 5000, date: '2026-08-01' },
            { giver: 'C00000010', recipient: 'C00000099', amount: 2000, date: '2026-09-01' },
            { giver: 'C00000030', recipient: 'C00000099', amount: 5000, date: '2026-09-01' },
            { giver: 'C00000040', recipient: 'C00000099', amount: 1000, date: '2026-09-01' },
          ],
        ],
      ]),
    };
    const gifts = await campaignSideGifts(await db(), ['C00000099'], side, ['C00000040']);
    expect(gifts.map(g => [g.id, g.amount, g.gifts])).toEqual([['C00000010', 7000, 2]]);
  });

  it("keeps the PACs' side for a committee whose own records couldn't be read", async () => {
    const side = { missing: new Set(['C00000099']), byRecipient: new Map() };
    const gifts = await campaignSideGifts(await db(), ['C00000099'], side);
    expect(gifts.map(g => g.amount)).toEqual([7500, 5000, 1000]);
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

describe('shortLists', () => {
  const side = {
    byRecipient: new Map([
      ['C00000001', [{ giver: 'C00000009', amount: 15000 }]],
      ['C00000002', [{ giver: 'C00000009', amount: 98000 }]],
      ['C00000003', []],
    ]),
    missing: new Set(['C00000003']),
  };
  it('names a list well under its own reported PAC total', () => {
    const committees = [
      { committeeId: 'C00000001', role: 'leadership', pac: 139583 },
      { committeeId: 'C00000002', role: 'campaign', pac: 100000 },
      { committeeId: 'C00000003', role: 'campaign', pac: 500000 },
      { committeeId: 'C00000004', role: 'joint', pac: 500000 },
    ];
    expect(shortLists(committees, side)).toEqual([
      { committeeId: 'C00000001', listed: 15000, reported: 139583 },
    ]);
  });
});

describe('nameFromPacReports', () => {
  const recipient = 'C00895722';
  const pilots = 'C00035451';
  const owners = 'C00131185';
  it("names a line from the PAC's own report of the gift (Jim Desmond's, 2026-11-01)", () => {
    const found = nameFromPacReports({
      recipient,
      // The pilots' March gift came with its ID: it takes the March report
      named: [{ giver: pilots, amount: 5000, date: '2026-03-26' }],
      unnamed: [
        { amount: 5000, date: '2026-07-27', name: "AIR LINE PILOTS ASSOC. INT'L PAC" },
        { amount: 2500, date: '2026-08-11', name: 'AIRCRAFT OWNERS & PILOTS ASSN (AOPA)' },
      ],
      pacSide: [
        { giver: pilots, amount: 5000, date: '2026-03-24' },
        { giver: pilots, amount: 5000, date: '2026-07-21' },
        { giver: owners, amount: 2500, date: '2026-08-05' },
      ],
    });
    expect(found).toEqual([
      { giver: pilots, recipient, amount: 5000, date: '2026-07-27' },
      { giver: owners, recipient, amount: 2500, date: '2026-08-11' },
    ]);
  });

  it("picks between gifts that both fit by the PAC's registered name", () => {
    const spacex = 'C00411116';
    const names = {
      [pilots]: 'AIR LINE PILOTS ASSOCIATION PAC',
      [spacex]: 'SPACE EXPLORATION TECHNOLOGIES CORP. PAC',
    };
    const found = nameFromPacReports({
      recipient,
      named: [],
      unnamed: [
        { amount: 5000, date: '2026-07-27', name: "AIR LINE PILOTS ASSOC. INT'L PAC" },
        { amount: 5000, date: '2026-07-28', name: 'SPACE EXPLORATION TECHNOLOGIES CORP PAC' },
      ],
      pacSide: [
        { giver: pilots, amount: 5000, date: '2026-07-21' },
        { giver: spacex, amount: 5000, date: '2026-07-22' },
      ],
      nameOf: id => names[id],
    });
    expect(found).toEqual([
      { giver: pilots, recipient, amount: 5000, date: '2026-07-27' },
      { giver: spacex, recipient, amount: 5000, date: '2026-07-28' },
    ]);
  });

  it('leaves a line out when no name clearly picks one PAC', () => {
    const found = nameFromPacReports({
      recipient,
      named: [],
      unnamed: [{ amount: 5000, date: '2026-07-27', name: 'PILOTS PAC' }],
      pacSide: [
        { giver: pilots, amount: 5000, date: '2026-07-21' },
        { giver: owners, amount: 5000, date: '2026-07-22' },
      ],
      nameOf: id =>
        id === pilots
          ? 'AIR LINE PILOTS ASSOCIATION PAC'
          : 'AIRCRAFT OWNERS AND PILOTS ASSOCIATION PAC',
    });
    expect(found).toEqual([]);
  });

  it('leaves a line out when two PACs gave the same amount near its date', () => {
    const found = nameFromPacReports({
      recipient,
      named: [],
      unnamed: [{ amount: 5000, date: '2026-07-27' }],
      pacSide: [
        { giver: pilots, amount: 5000, date: '2026-07-21' },
        { giver: owners, amount: 5000, date: '2026-07-25' },
      ],
    });
    expect(found).toEqual([]);
  });

  it('leaves both lines out when two could take the same gift', () => {
    const found = nameFromPacReports({
      recipient,
      named: [],
      unnamed: [
        { amount: 5000, date: '2026-07-20' },
        { amount: 5000, date: '2026-07-27' },
      ],
      pacSide: [{ giver: pilots, amount: 5000, date: '2026-07-21' }],
    });
    expect(found).toEqual([]);
  });

  it('never takes a gift already listed with its ID, a different amount, or one weeks apart', () => {
    const found = nameFromPacReports({
      recipient,
      named: [{ giver: pilots, amount: 5000, date: '2026-07-22' }],
      unnamed: [
        { amount: 5000, date: '2026-07-27' },
        { amount: 2000, date: '2026-08-11' },
        { amount: 1000, date: '2026-09-30' },
        { amount: -1000, date: '2026-07-21' },
      ],
      pacSide: [
        { giver: pilots, amount: 5000, date: '2026-07-21' },
        { giver: owners, amount: 2500, date: '2026-08-05' },
        { giver: owners, amount: 1000, date: '2026-08-05' },
      ],
    });
    expect(found).toEqual([]);
  });
});
