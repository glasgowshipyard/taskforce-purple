// Reference members (REBUILD_SPEC Stage 3): real grading inputs frozen from
// the live data (workers/fixtures/reference-members.json, made by
// scripts/verify/make-reference-fixtures.mjs). If one of these fails, a code
// change has moved a grade the owner has settled. Don't regenerate the
// fixture to make it pass: simulate the change across all members, agree it
// with the owner, then regenerate.

import { describe, expect, it } from 'vitest';
import fixture from './fixtures/reference-members.json';
import { gradeMember } from './grading.js';
import { publishedMember } from './member-store.js';

const m = fixture.members;

// Graded the way the refresh job grades: person level, identity looked up
const grade = (ref, reconciliation = { ok: true }) =>
  gradeMember(
    { ...ref.record, fecIdentityVerified: true },
    { ...ref.analysis, personLevel: true, personFunding: ref.personFunding, reconciliation }
  );

describe('reference members', () => {
  it('Sanders is graded as a movement donor base, S', () => {
    const g = grade(m.S000033);
    expect(g.tier).toBe('S');
    expect(g.detail.trustAnchorBasis).toBe('movement');
  });

  it('AOC: itemized money counts as support, not against her (ballroom principle), S', () => {
    const g = grade(m.O000172);
    expect(g.tier).toBe('S');
  });

  it('Pelosi is never graded on her campaign alone', () => {
    const ref = m.P000197;
    const g = grade(ref);
    expect(g.gradeBasis).toBe('all-committees');
    // The money graded is everything she received, not the campaign's share
    expect(g.personFigures.totalRaised).toBe(ref.personFunding.totalRaised);
    expect(ref.personFunding.totalRaised).toBeGreaterThan(ref.record.totalRaised * 2);
    expect(g.tier).toBe('B');
    // Provisional (grade first, confirm after): the same grade, marked
    const provisional = grade(ref, { ok: false, pending: true });
    expect(provisional.tier).toBe('B');
    expect(provisional.evidenceChecked).toBe(false);
  });

  it('every graded reference member keeps the grade it was frozen with', () => {
    for (const [id, ref] of Object.entries(m)) {
      if (!ref.personFunding) {
        continue;
      }
      const g = grade(ref);
      expect({ id, tier: g.tier, basis: g.gradeBasis }).toEqual({
        id,
        tier: ref.expected.tier,
        basis: ref.expected.gradeBasis,
      });
    }
  });

  it('nobody gets a letter grade unless their FEC identity is confirmed', () => {
    const ref = m.A000383;
    // Published from the stored record, as the site does for him
    expect(publishedMember({ ...ref.record, tier: 'F' }, null).tier).toBe('UNVERIFIED');
    // And graded directly, with an unconfirmed identity
    const g = gradeMember(
      { ...m.S000033.record, fecIdentityVerified: false },
      {
        ...m.S000033.analysis,
        personLevel: true,
        personFunding: m.S000033.personFunding,
        reconciliation: { ok: true },
      }
    );
    expect(g.tier).toBe('UNVERIFIED');
  });
});
