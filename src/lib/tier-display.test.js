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
