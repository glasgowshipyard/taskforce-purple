import { describe, expect, it } from 'vitest';
import { BOOST_FLOOR, BOOST_HELD, boostedSentence, isBoosted, timesOver } from './outside.js';

describe('BOOSTED (2026-10-25)', () => {
  it('only when the help is bigger than their whole campaign', () => {
    expect(isBoosted({ for: 2_000_001, against: 0 }, 2_000_000)).toBe(true);
    expect(isBoosted({ for: 2_000_000, against: 0 }, 2_000_000)).toBe(false);
    expect(isBoosted(null, 0)).toBe(false);
  });

  it('never from money spent against them', () => {
    expect(isBoosted({ for: 0, against: 90_000_000 }, 1_000_000)).toBe(false);
  });

  it('not for a flyer: help under the 48-hour reporting line', () => {
    expect(isBoosted({ for: BOOST_FLOOR - 1, against: 0 }, 0)).toBe(false);
    expect(isBoosted({ for: BOOST_FLOOR, against: 0 }, 0)).toBe(true);
  });

  it('says it in whole dollars, and never rounds up the times over', () => {
    expect(timesOver({ for: 12_100_000 }, 1_900_000)).toBe(6);
    expect(timesOver({ for: 3_000_000 }, 2_000_000)).toBeNull();
    expect(boostedSentence({ for: 12_100_000 }, 1_900_000)).toBe(
      'Outside groups spent $12,100,000 to help them: more than 6 times what their own campaign raised.'
    );
    expect(boostedSentence({ for: 3_000_000 }, 2_000_000)).toBe(
      'Outside groups spent $3,000,000 to help them: more than their own campaign raised ($2,000,000).'
    );
    expect(boostedSentence({ for: 50_000 }, 0)).toMatch(/has reported raising nothing\.$/);
    expect(boostedSentence({ for: 100 }, 1_000)).toBeNull();
  });
});

describe('a held stamp', () => {
  it('is never shown for someone whose own figures are under review', () => {
    BOOST_HELD.X000002 = 'figures under review';
    try {
      expect(isBoosted({ for: 904_424 }, 60_556, 'X000002')).toBe(false);
      expect(boostedSentence({ for: 904_424 }, 60_556, 'X000002')).toBeNull();
      expect(isBoosted({ for: 904_424 }, 60_556, 'X000001')).toBe(true);
    } finally {
      delete BOOST_HELD.X000002;
    }
  });
});
