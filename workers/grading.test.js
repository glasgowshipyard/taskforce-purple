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
