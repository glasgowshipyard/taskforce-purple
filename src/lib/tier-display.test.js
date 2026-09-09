import { describe, expect, it } from 'vitest';
import { TaskForceAPI } from './api.js';

// Every tier the scorer can emit must have display handling. Missing entries
// are silent failures: getTierColor falls back to grey, and a tier absent
// from MembersList's tierOrder makes the sort comparator return NaN, which
// leaves Array.sort behaviour undefined for the entire list (2026-07-24).
const TIERS_EMITTED_BY_SCORER = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'N/A', 'DISPUTED'];

// Mirrors the map in src/components/MembersList.jsx
const tierOrder = { S: 8, A: 7, B: 6, C: 5, D: 4, E: 3, F: 2, 'N/A': 1, DISPUTED: 0 };

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
  it('DISPUTED is ringfenced', () => {
    expect(TaskForceAPI.isRingfenced('DISPUTED')).toBe(true);
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
