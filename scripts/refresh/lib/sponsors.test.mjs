import { describe, expect, it } from 'vitest';
import {
  buildIrsIndex,
  classifyPac,
  fecGroup,
  irsStatus,
  normalizeName,
  peopleTest,
  stripPacWords,
} from './sponsors.mjs';

const index = buildIrsIndex([
  { EIN: '361520690', NAME: 'NATIONAL ASSOCIATION OF REALTORS', SUBSECTION: '06' },
  {
    EIN: '521131735',
    NAME: 'AIR LINE PILOTS ASSOCIATION',
    SUBSECTION: '05',
    CLASSIFICATION: '3000',
  },
  {
    EIN: '421234567',
    NAME: 'NATIONAL PORK PRODUCERS COUNCIL',
    SUBSECTION: '05',
    CLASSIFICATION: '1000',
  },
  { EIN: '777777777', NAME: 'GAP INC', SUBSECTION: '03' },
  { EIN: '888888888', NAME: 'UNITED AIRLINES INC', SUBSECTION: '09' },
  { EIN: '541587464', NAME: 'AIR LINE PILOTS ASSOCIATION', SUBSECTION: '09' },
  { EIN: '530217164', NAME: 'AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE', SUBSECTION: '04' },
  { EIN: '111111111', NAME: 'AMERICAS CREDIT UNIONS', SUBSECTION: '06' },
  { EIN: '222222222', NAME: 'SAME NAME GROUP', SUBSECTION: '06' },
  { EIN: '333333333', NAME: 'SAME NAME GROUP', SUBSECTION: '04' },
  ...['ME', 'NH', 'VT', 'RI'].map(st => ({
    EIN: `4${st}`,
    NAME: 'AMERICAN ACADEMY OF FAMILY PHYSICIANS',
    SUBSECTION: '06',
  })),
  { EIN: '5CT', NAME: 'AMERICAN ACADEMY OF FAMILY PHYSICIANS', SUBSECTION: '04' },
  { EIN: '666666666', NAME: 'NATIONAL VENTURE CAPITAL ASSOCIATION', SUBSECTION: '06' },
]);

describe('sponsor sorting', () => {
  it('tidies names for exact matching', () => {
    expect(normalizeName("America's Credit Unions")).toBe('AMERICAS CREDIT UNIONS');
    expect(normalizeName('AMERICAN BANKERS ASSOCIATION (ABA)')).toBe(
      'AMERICAN BANKERS ASSOCIATION'
    );
    expect(normalizeName('Lockheed Martin Corporation')).toBe('LOCKHEED MARTIN');
    expect(
      stripPacWords('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE POLITICAL ACTION COMMITTEE')
    ).toBe('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE');
    expect(stripPacWords('EMPLOYEES OF NORTHROP GRUMMAN CORPORATION PAC')).toBe(
      'NORTHROP GRUMMAN CORPORATION'
    );
  });

  it('reads the IRS file: one kind, a union beside its benefit trust, or ambiguous', () => {
    expect(irsStatus(index, 'National Association of Realtors')).toMatchObject({
      status: 'matched',
      subsection: '06',
      group: 'business',
    });
    expect(irsStatus(index, 'AIR LINE PILOTS ASSOCIATION')).toMatchObject({
      status: 'matched',
      subsection: '05',
      group: 'people',
    });
    expect(irsStatus(index, 'SAME NAME GROUP').status).toBe('ambiguous');
    expect(irsStatus(index, 'NOBODY').status).toBe('unmatched');
    // 501(c)(5): the FEC's sponsor type tells a union from a producers' association
    expect(
      classifyPac(
        'C20',
        { designation: 'B', orgType: 'T', connectedOrg: 'NATIONAL PORK PRODUCERS COUNCIL' },
        index
      ).group
    ).toBe('business');
    expect(
      classifyPac(
        'C21',
        { designation: 'B', orgType: 'L', connectedOrg: 'AIR LINE PILOTS ASSOCIATION' },
        index
      ).group
    ).toBe('people');
    // A charity or a benefit trust can't sponsor a PAC: no match
    expect(irsStatus(index, 'GAP INC').status).toBe('unmatched');
    expect(irsStatus(index, 'UNITED AIRLINES, INC.').status).toBe('unmatched');
    // A national body and its chapters: most of the records settle it
    expect(irsStatus(index, 'AMERICAN ACADEMY OF FAMILY PHYSICIANS')).toMatchObject({
      status: 'majority',
      group: 'business',
    });
    expect(stripPacWords('NATIONAL VENTURE CAPITAL ASSOCIATION VENTUREPAC')).toBe(
      'NATIONAL VENTURE CAPITAL ASSOCIATION'
    );
  });

  it('sorts in order: politician, then the IRS over the FEC field, then the FEC, then the name', () => {
    expect(classifyPac('C1', { designation: 'D', orgType: 'L' }, index).group).toBe('politician');
    // The FEC says membership organization; the IRS says business league
    const realtors = classifyPac(
      'C2',
      { designation: 'B', orgType: 'M', connectedOrg: 'NATIONAL ASSOCIATION OF REALTORS' },
      index
    );
    expect(realtors).toMatchObject({ group: 'business', settledBy: 'IRS' });
    expect(fecGroup({ designation: 'B', orgType: 'M' })).toBe('people');
    // AIPAC: no connected organization named; matched on the PAC's own name
    expect(
      classifyPac(
        'C3',
        {
          name: 'AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE POLITICAL ACTION COMMITTEE',
          designation: 'B',
          orgType: 'M',
          connectedOrg: '',
        },
        index
      )
    ).toMatchObject({ group: 'people', settledBy: 'IRS' });
    expect(
      classifyPac(
        'C4',
        { designation: 'B', orgType: 'C', connectedOrg: 'LOCKHEED MARTIN CORPORATION' },
        index
      )
    ).toMatchObject({ group: 'business', settledBy: 'FEC' });
    expect(
      classifyPac('C5', { designation: 'B', orgType: 'L', connectedOrg: 'SOME LOCAL UNION' }, index)
        .group
    ).toBe('people');
    expect(
      classifyPac(
        'C6',
        { name: 'K&L GATES LLP POLITICAL ACTION COMMITTEE', designation: 'B' },
        index
      )
    ).toMatchObject({ group: 'business', settledBy: 'name' });
    expect(
      classifyPac('C7', { name: 'SOME CAUSE PAC', designation: 'U', connectedOrg: 'NONE' }, index)
        .group
    ).toBe('nosponsor');
    expect(classifyPac('C8', { designation: 'B', connectedOrg: 'A SOCIETY' }, index)).toMatchObject(
      { group: 'people', unsettled: true }
    );
    expect(classifyPac('C9', { type: 'Y' }, index).group).toBe('party');
  });

  it("the FEC committee record settles a member's PAC that isn't designated D", () => {
    expect(
      classifyPac(
        'C11',
        { name: 'SIX PAC', designation: 'U', connectedOrg: 'MILLER-MEEKS VICTORY FUND' },
        index,
        {},
        { sponsorCandidates: ['H8IA02043'] }
      )
    ).toMatchObject({ group: 'politician', settledBy: 'FEC record' });
    expect(
      classifyPac(
        'C12',
        { name: 'EMILYS LIST', designation: 'U', connectedOrg: 'WOMEN VOTE' },
        index
      ).group
    ).toBe('nosponsor');
  });

  it("a stated fact decides when the FEC and the IRS don't", () => {
    const facts = { C10: { group: 'business', fact: 'Ernst & Young LLP is an accounting firm.' } };
    expect(
      classifyPac(
        'C10',
        { name: 'ERNST & YOUNG POLITICAL ACTION COMMITTEE', designation: 'B' },
        index,
        facts
      )
    ).toMatchObject({ group: 'business', settledBy: 'stated fact' });
  });
});

describe('FINAL-2 sorting and the people test', () => {
  it('rule 6: filed as a company, BUSINESS whatever the IRS says', () => {
    expect(
      classifyPac(
        'C30',
        {
          designation: 'B',
          orgType: 'W',
          connectedOrg: 'AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE',
        },
        index
      )
    ).toMatchObject({ group: 'business', settledBy: 'FEC' });
  });

  it('rules 7 and 8: insurers, health plans, credit unions and producers are BUSINESS', () => {
    expect(
      classifyPac('C31', { name: 'BLUE CROSS BLUE SHIELD OF X PAC', orgType: 'L' }, index).group
    ).toBe('business');
    expect(
      classifyPac('C32', { name: 'SOME FEDERAL CREDIT UNION PAC', orgType: 'M' }, index).group
    ).toBe('business');
    expect(
      classifyPac('C33', { name: 'TEXAS FARM BUREAU AGFUND', orgType: 'M' }, index).group
    ).toBe('business');
  });

  it("rule 10: a sponsor that is a politician's committee, a party, or another committee", () => {
    const pac = connectedCommittees => ({
      name: 'SOME PAC',
      designation: 'U',
      connectedOrg: 'X',
      connectedCommittees,
    });
    expect(classifyPac('C34', pac([{ id: 'C1', name: 'X', designation: 'J' }]), index).group).toBe(
      'politician'
    );
    expect(classifyPac('C35', pac([{ id: 'C1', name: 'X', type: 'Y' }]), index).group).toBe(
      'party'
    );
    expect(
      classifyPac('C36', pac([{ id: 'C1', name: 'X', type: 'N', designation: 'U' }]), index).group
    ).toBe('nosponsor');
    // An organization's own spending-report ID (C9...) is the sponsor itself
    expect(
      classifyPac('C37', pac([{ id: 'C90000001', name: 'X', type: 'I' }]), index).group
    ).not.toBe('nosponsor');
  });

  it('the people test reads line 7a, or a stated fact', () => {
    const sorted = { irs: { ein: '111111111' } };
    const forms = {
      111111111: { found: true, name: 'A UNION', taxYear: 2024, members: true, elect: true },
      222222222: {
        found: true,
        name: 'AN ISSUE GROUP',
        taxYear: 2024,
        members: false,
        elect: false,
      },
    };
    expect(peopleTest('C40', sorted, forms).elected).toBe(true);
    expect(peopleTest('C41', { irs: { ein: '222222222' } }, forms).elected).toBe(false);
    expect(
      peopleTest('C42', {}, forms, { C42: { elected: true, fact: 'a union local' } })
    ).toMatchObject({
      elected: true,
    });
    expect(peopleTest('C43', {}, forms).elected).toBeNull();
    // A hand-identified EIN wins over the IRS match
    expect(peopleTest('C44', sorted, forms, { C44: { ein: '222222222' } }).elected).toBe(false);
  });
});
