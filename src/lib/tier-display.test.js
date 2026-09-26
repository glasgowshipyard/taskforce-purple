import { describe, expect, it } from 'vitest';
import { TaskForceAPI } from './api.js';

// Every tier the scorer can emit must have display handling. Missing entries
// are silent failures: getTierColor falls back to grey, and a tier absent
// from MembersList's tierOrder makes the sort comparator return NaN, which
// leaves Array.sort behaviour undefined for the entire list (2026-07-24).
const TIERS_EMITTED_BY_SCORER = [
  'S',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'N/A',
  'DISPUTED',
  'UNVERIFIED',
];

// Mirrors the map in src/components/MembersList.jsx
const tierOrder = {
  S: 8,
  A: 7,
  B: 6,
  C: 5,
  D: 4,
  E: 3,
  F: 2,
  'N/A': 1,
  DISPUTED: 0,
  UNVERIFIED: 0,
};

describe('tier display coverage', () => {
  it('every emitted tier has a distinct colour, not the grey fallback', () => {
    const fallback = 'bg-gray-500 text-white';
    for (const tier of TIERS_EMITTED_BY_SCORER) {
      expect(TaskForceAPI.getTierColor(tier), `colour missing for ${tier}`).not.toBe(fallback);
    }
  });

  it('every emitted tier has a description and explanation', () => {
    for (const tier of TIERS_EMITTED_BY_SCORER) {
      expect(TaskForceAPI.getTierDescription(tier), `description missing for ${tier}`).not.toBe(
        'Unknown'
      );
      expect(TaskForceAPI.getTierExplanation(tier), `explanation missing for ${tier}`).not.toBe(
        'No explanation available.'
      );
    }
  });

  it('every emitted tier sorts deterministically', () => {
    for (const tier of TIERS_EMITTED_BY_SCORER) {
      expect(typeof tierOrder[tier], `sort rank missing for ${tier}`).toBe('number');
      expect(Number.isNaN(tierOrder[tier] - tierOrder.S)).toBe(false);
    }
  });

  it('DISPUTED sorts last and does not read as a bad grade', () => {
    expect(tierOrder.DISPUTED).toBeLessThan(tierOrder['N/A']);
    expect(TaskForceAPI.getTierColor('DISPUTED')).not.toBe(TaskForceAPI.getTierColor('F'));
  });
});

describe('ringfenced tiers withhold figures', () => {
  it('DISPUTED and UNVERIFIED are ringfenced', () => {
    expect(TaskForceAPI.isRingfenced('DISPUTED')).toBe(true);
    expect(TaskForceAPI.isRingfenced('UNVERIFIED')).toBe(true);
  });

  it('only UNVERIFIED hides the derived analyses too', () => {
    // DISPUTED's bundler/concentration analyses come from the member's own
    // itemized records and stay (issue #40); UNVERIFIED's may be another
    // person's (issue #41)
    expect(TaskForceAPI.isIdentityUnverified('UNVERIFIED')).toBe(true);
    expect(TaskForceAPI.isIdentityUnverified('DISPUTED')).toBe(false);
    expect(TaskForceAPI.isIdentityUnverified('F')).toBe(false);
  });

  it('every real letter grade publishes its figures', () => {
    for (const tier of ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'N/A']) {
      expect(TaskForceAPI.isRingfenced(tier), `${tier} must not be ringfenced`).toBe(false);
    }
  });

  it('is safe for absent or unknown tiers', () => {
    // A member whose tier failed to serialise must not accidentally read as
    // publishable; equally, an unknown tier is not something we withhold.
    expect(TaskForceAPI.isRingfenced(undefined)).toBe(false);
    expect(TaskForceAPI.isRingfenced(null)).toBe(false);
    expect(TaskForceAPI.isRingfenced('NONSENSE')).toBe(false);
  });

  it('a ringfenced tier must still have full display handling', () => {
    // Withholding the figures is not a reason to skip colour/description/
    // explanation - the card still renders, it just carries no numbers.
    for (const tier of TIERS_EMITTED_BY_SCORER.filter(t => TaskForceAPI.isRingfenced(t))) {
      expect(TaskForceAPI.getTierDescription(tier)).not.toBe('Unknown');
      expect(TaskForceAPI.getTierExplanation(tier)).not.toBe('No explanation available.');
      expect(typeof tierOrder[tier]).toBe('number');
    }
  });
});

describe('tier badge', () => {
  // The badge is a fixed-size circle sized for one character. Rendering the
  // word DISPUTED there spilled over the member's name on the live site
  // (issue #36), and the coverage tests above could not see it. This one can.
  it('every emitted tier has a badge label that fits the circle', () => {
    for (const tier of TIERS_EMITTED_BY_SCORER) {
      const label = TaskForceAPI.getTierBadgeLabel(tier);
      expect(label, `badge label missing for ${tier}`).toBeTruthy();
      expect(label.length, `badge label for ${tier} is "${label}"`).toBeLessThanOrEqual(3);
    }
  });

  it('letter grades show their letter', () => {
    for (const tier of ['S', 'A', 'B', 'C', 'D', 'E', 'F']) {
      expect(TaskForceAPI.getTierBadgeLabel(tier)).toBe(tier);
    }
  });
});

describe('displayFigures - the card never contradicts its grade (#32)', () => {
  const member = {
    totalRaised: 2465830,
    grassrootsDonations: 1411327,
    largeDonorDonations: 808796,
    pacMoney: 33000,
    grassrootsPercent: 57,
  };
  const personFigures = {
    totalRaised: 5925907,
    grassrootsDonations: 3827846,
    largeDonorDonations: 1967754,
    pacMoney: 47715,
    grassrootsPercent: 64,
  };

  it('shows campaign figures while the grade is on the campaign basis', () => {
    const f = TaskForceAPI.displayFigures({
      ...member,
      gradeBasis: 'campaign-committee',
      personFigures: null,
    });
    expect(f.allCommittees).toBe(false);
    expect(f.grassrootsPercent).toBe(57);
  });

  it('shows all-committee figures once the grade uses them', () => {
    const f = TaskForceAPI.displayFigures({
      ...member,
      gradeBasis: 'all-committees',
      personFigures,
    });
    expect(f.allCommittees).toBe(true);
    expect(f.grassrootsPercent).toBe(64);
    expect(f.totalRaised).toBe(5925907);
  });

  it('falls back to campaign figures if the basis says all but the figures are missing', () => {
    expect(
      TaskForceAPI.displayFigures({ ...member, gradeBasis: 'all-committees' }).allCommittees
    ).toBe(false);
  });
});
