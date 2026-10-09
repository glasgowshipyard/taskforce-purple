import { describe, expect, it } from 'vitest';
import { gradeMember } from './grading.js';

const member = {
  bioguideId: 'X000001',
  name: 'Test, Member',
  totalRaised: 1000000,
  grassrootsDonations: 600000,
  largeDonorDonations: 300000,
  grassrootsPercent: 60,
  pacMoney: 100000,
  partyMoney: 0,
};
const personFunding = {
  totalRaised: 3000000,
  grassrootsDonations: 1200000,
  largeDonorDonations: 1500000,
  grassrootsPercent: 40,
  pacMoney: 300000,
  partyMoney: 0,
  invariantsHold: true,
};
const analysis = reconciliation => ({ personLevel: true, personFunding, reconciliation });

describe('gradeMember: grade basis and evidence', () => {
  it('grades on all committees once every record is checked', () => {
    const g = gradeMember(member, analysis({ ok: true }));
    expect(g.gradeBasis).toBe('all-committees');
    expect(g.evidenceChecked).toBe(true);
    expect(g.personFigures.totalRaised).toBe(3000000);
  });

  it('grades on all committees from the bulk files while the check is pending', () => {
    const g = gradeMember(member, analysis({ ok: false, pending: true }));
    expect(g.gradeBasis).toBe('all-committees');
    expect(g.evidenceChecked).toBe(false);
    expect(g.personFigures.totalRaised).toBe(3000000);
  });

  it('a check that failed falls back to the campaign committee', () => {
    const g = gradeMember(member, analysis({ ok: false }));
    expect(g.gradeBasis).toBe('campaign-committee-rechecking');
    expect(g.evidenceChecked).toBeNull();
    expect(g.personFigures).toBeNull();
  });

  it('without person-level figures, the campaign committee', () => {
    const g = gradeMember(member, null);
    expect(g.gradeBasis).toBe('campaign-committee');
    expect(g.evidenceChecked).toBeNull();
  });

  it('pending and checked grades are identical apart from the flag', () => {
    const a = gradeMember(member, analysis({ ok: true }));
    const b = gradeMember(member, analysis({ ok: false, pending: true }));
    expect({ ...b, evidenceChecked: true }).toEqual(a);
  });
});

describe("gradeMember: a candidate's own money (#59, #62)", () => {
  // Shaped like Sara Jacobs' 2026 figures: half her money is her own
  const jacobs = {
    totalRaised: 1867293,
    grassrootsDonations: 153583,
    largeDonorDonations: 528678,
    pacMoney: 245165,
    partyMoney: 0,
    grassrootsPercent: 8,
    invariantsHold: true,
  };
  const own = { contributions: 929347, loans: 0, repaid: 0 };
  // Her donor analysis, so the full grading path runs
  const grade = pf =>
    gradeMember(
      { ...member, fecIdentityVerified: true },
      {
        personLevel: true,
        personFunding: pf,
        reconciliation: { ok: true },
        uniqueDonors: 339,
        nakamotoCoefficient: 34,
        totalAmount: 528678,
      }
    );

  it('is left out of the grade, so it neither helps nor hurts', () => {
    const without = grade(jacobs);
    const withOwn = grade({ ...jacobs, ownMoney: own });
    // The grade is worked out on the money from others only
    expect(withOwn.detail.rawIndividualFundingPercent).toBe(
      Math.round(((153583 + 528678) / (1867293 - 929347)) * 100)
    );
    expect(withOwn.individualFundingPercent).toBeGreaterThan(without.individualFundingPercent);
  });

  it('is kept in the figures, so the receipt can show it', () => {
    const g = grade({ ...jacobs, ownMoney: own });
    expect(g.personFigures.totalRaised).toBe(1867293);
    expect(g.personFigures.ownMoney).toEqual(own);
  });

  it('a member without own money is graded exactly as before', () => {
    const a = grade(jacobs);
    const b = grade({ ...jacobs, ownMoney: { contributions: 0, loans: 0, repaid: 0 } });
    expect(b).toEqual(a);
    expect(a.personFigures.ownMoney).toBeUndefined();
  });

  it("own money that doesn't fit inside the total withholds the grade (#62)", () => {
    // Shaped like Shri Thanedar's: $2.15M of loans against $390K net receipts
    const g = grade({
      totalRaised: 390276,
      grassrootsDonations: 18989,
      largeDonorDonations: 600204,
      pacMoney: 85500,
      partyMoney: 0,
      grassrootsPercent: 5,
      invariantsHold: true,
      ownMoney: { contributions: 300, loans: 2150000, repaid: 0 },
    });
    expect(g.tier).toBe('DISPUTED');
    expect(g.disputeReason).toBe('own-money-exceeds-receipts');
  });
});
