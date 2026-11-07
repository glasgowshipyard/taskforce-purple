import { describe, expect, it } from 'vitest';
import { givenToMembers, pacsCsv, sponsorGapsCsv } from './downloads.mjs';

const pacs = {
  C00000001: {
    name: 'Union PAC',
    orgType: 'L',
    connectedOrg: 'A UNION',
    sponsor: { group: 'people', reason: 'A labor organization (LMRDA).' },
    peopleTest: { elected: true, evidence: 'Covered by the LMRDA.' },
  },
  C00000002: {
    name: 'Widget Co PAC',
    orgType: '',
    connectedOrg: 'WIDGET CO',
    sponsor: { group: 'business', reason: 'A company.' },
  },
  C00000003: {
    name: 'Lone PAC',
    orgType: '',
    connectedOrg: 'NONE',
    sponsor: { group: 'nosponsor' },
  },
};
const shares = new Map([
  ['C00000001', 0.8],
  ['C00000002', 0.5],
]);

describe('the PAC tables for download (#67, #70)', () => {
  const given = givenToMembers([
    [
      'M1',
      [
        { id: 'C00000001', amount: 5000 },
        { id: 'C00000002', amount: 1000 },
      ],
    ],
    [
      'M2',
      [
        { id: 'C00000001', amount: 2500 },
        { id: 'C00000003', amount: 0 },
      ],
    ],
  ]);

  it('adds up what each PAC gave, and to how many members', () => {
    expect(given.get('C00000001')).toMatchObject({ given: 7500 });
    expect(given.get('C00000001').members.size).toBe(2);
    expect(given.has('C00000003')).toBe(false);
  });

  it('lists every PAC with who it answers to and what counted as people money', () => {
    const [head, union, widget] = pacsCsv(pacs, shares, given).trim().split('\n');
    expect(head.split(',').slice(0, 7)).toEqual([
      'committee_id',
      'name',
      'answers_to',
      'people_share_pct',
      'given_to_members',
      'counted_as_people',
      'members_given_to',
    ]);
    expect(union).toMatch(
      /^C00000001,Union PAC,Run by their members,80,7500,6000,2,A UNION,a labor organization,/
    );
    expect(union).toContain('Covered by the LMRDA.');
    // A business counts nothing, whatever its own donors' share
    expect(widget).toMatch(
      /^C00000002,Widget Co PAC,Businesses,50,1000,0,1,WIDGET CO,,A company\.,,/
    );
  });

  it('lists the PACs naming a sponsor with no sponsor type (#70)', () => {
    const rows = sponsorGapsCsv(pacs, given).trim().split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      'C00000002,Widget Co PAC,WIDGET CO,1000,https://www.fec.gov/data/committee/C00000002/'
    );
  });
});
