import { describe, expect, it } from 'vitest';
import { GRADES, gradeInfo, isIdentityUnverified, isRingfenced, withArticle } from './grades.js';
import { gradedFigures } from './people.js';

// Every tier the scorer can emit must have display handling. A missing entry
// is a silent failure: a fallback colour, or a sort that returns NaN and
// leaves Array.sort's order undefined for the whole list (2026-07-24).
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

describe('tier display coverage', () => {
  it('every emitted tier has its own entry: name, colours, meaning, sort rank', () => {
    for (const tier of TIERS_EMITTED_BY_SCORER) {
      const g = GRADES[tier];
      expect(g, `display entry missing for ${tier}`).toBeTruthy();
      expect(g.name).toBeTruthy();
      expect(g.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(g.light).toMatch(/^#[0-9A-F]{6}$/i);
      expect(g.meaning.length).toBeGreaterThan(20);
      expect(Number.isNaN(g.rank - GRADES.S.rank)).toBe(false);
    }
  });

  it('letter grades have distinct colours', () => {
    const colours = ['S', 'A', 'B', 'C', 'D', 'E', 'F'].map(t => GRADES[t].color);
    expect(new Set(colours).size).toBe(7);
  });

  it('withheld grades sort last and do not look like a bad grade', () => {
    expect(GRADES.DISPUTED.rank).toBeLessThan(GRADES['N/A'].rank);
    expect(GRADES.UNVERIFIED.rank).toBeLessThan(GRADES['N/A'].rank);
    expect(GRADES.DISPUTED.color).not.toBe(GRADES.F.color);
    expect(GRADES.UNVERIFIED.color).not.toBe(GRADES.F.color);
  });

  it('an unknown or missing tier still displays, as not graded', () => {
    for (const tier of [undefined, null, 'NONSENSE']) {
      const g = gradeInfo(tier);
      expect(g.name).toBe('Not graded');
      expect(g.mark).toBeTruthy();
    }
  });

  it('headings read naturally', () => {
    expect(withArticle('S')).toBe('an S');
    expect(withArticle('E')).toBe('an E');
    expect(withArticle('B')).toBe('a B');
  });
});

describe('ringfenced tiers withhold figures', () => {
  it('DISPUTED and UNVERIFIED are ringfenced', () => {
    expect(isRingfenced('DISPUTED')).toBe(true);
    expect(isRingfenced('UNVERIFIED')).toBe(true);
  });

  it('only UNVERIFIED hides the derived analyses too', () => {
    // DISPUTED's bundler/concentration analyses come from the member's own
    // itemized records and stay (issue #40); UNVERIFIED's may be another
    // person's (issue #41)
    expect(isIdentityUnverified('UNVERIFIED')).toBe(true);
    expect(isIdentityUnverified('DISPUTED')).toBe(false);
    expect(isIdentityUnverified('F')).toBe(false);
  });

  it('every real letter grade publishes its figures', () => {
    for (const tier of ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'N/A']) {
      expect(isRingfenced(tier), `${tier} must not be ringfenced`).toBe(false);
    }
  });

  it('is safe for absent or unknown tiers', () => {
    expect(isRingfenced(undefined)).toBe(false);
    expect(isRingfenced(null)).toBe(false);
    expect(isRingfenced('NONSENSE')).toBe(false);
  });
});

describe('the stamp', () => {
  // The stamp is a circle sized for one character. A word there spilled over
  // the member's name on the old site (issue #36).
  it('every emitted tier has a mark that fits the circle', () => {
    for (const tier of TIERS_EMITTED_BY_SCORER) {
      expect(gradeInfo(tier).mark.length, `mark for ${tier}`).toBeLessThanOrEqual(1);
    }
  });

  it('letter grades show their letter', () => {
    for (const tier of ['S', 'A', 'B', 'C', 'D', 'E', 'F']) {
      expect(gradeInfo(tier).mark).toBe(tier);
    }
  });
});

describe('gradedFigures - the page never contradicts its grade (#32)', () => {
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
    const f = gradedFigures({ ...member, gradeBasis: 'campaign-committee', personFigures: null });
    expect(f.allCommittees).toBe(false);
    expect(f.grassrootsPercent).toBe(57);
  });

  it('shows all-committee figures once the grade uses them', () => {
    const f = gradedFigures({ ...member, gradeBasis: 'all-committees', personFigures });
    expect(f.allCommittees).toBe(true);
    expect(f.grassrootsPercent).toBe(64);
    expect(f.totalRaised).toBe(5925907);
  });

  it('falls back to campaign figures if the basis says all but the figures are missing', () => {
    expect(gradedFigures({ ...member, gradeBasis: 'all-committees' }).allCommittees).toBe(false);
  });

  it('keeps "not collected" apart from zero', () => {
    expect(gradedFigures({ ...member, largeDonorDonations: null }).largeDonorDonations).toBeNull();
    expect(gradedFigures({ ...member, largeDonorDonations: 0 }).largeDonorDonations).toBe(0);
  });
});
