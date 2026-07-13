import { describe, expect, it } from 'vitest';
import { classifyScheduleARow, normalizeConduitName, topConduits } from './schedule-a-classify.js';

// Fixtures modeled on real API responses (probed 2026-07-12)
const aipacConduitLump = {
  contribution_receipt_amount: 262500.0,
  line_number: '11AI',
  memo_code: 'X',
  memoed_subtotal: true,
  entity_type: 'PAC',
  contributor_name: 'AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC',
  memo_text: 'SEE ATTRIBUTION BELOW FOR ALL DONORS ABOVE ITEMIZATION THRESHOLD',
};

const earmarkedIndividual = {
  contribution_receipt_amount: 250.0,
  line_number: '11AI',
  memoed_subtotal: false,
  entity_type: 'IND',
  contributor_last_name: 'AVERILL',
  memo_text: '* EARMARKED CONTRIBUTION: SEE BELOW',
  conduit_committee_id: null,
};

const ordinaryIndividual = {
  contribution_receipt_amount: 500.0,
  line_number: '11AI',
  memoed_subtotal: false,
  entity_type: 'IND',
  contributor_last_name: 'SMITH',
  memo_text: null,
};

describe('classifyScheduleARow', () => {
  it('flags conduit memo lumps for attribution', () => {
    expect(classifyScheduleARow(aipacConduitLump)).toBe('conduit-memo');
  });

  it('treats org-entity conduit lumps the same as PACs', () => {
    expect(classifyScheduleARow({ ...aipacConduitLump, entity_type: 'ORG' })).toBe('conduit-memo');
  });

  it('keeps earmarked individuals countable but marked', () => {
    expect(classifyScheduleARow(earmarkedIndividual)).toBe('individual-earmarked');
  });

  it('passes ordinary individuals through', () => {
    expect(classifyScheduleARow(ordinaryIndividual)).toBe('individual');
  });

  it('skips memo rows that are not conduit lumps (e.g. individual JFC attributions)', () => {
    expect(
      classifyScheduleARow({
        contribution_receipt_amount: 1000,
        line_number: '12',
        memoed_subtotal: true,
        entity_type: 'IND',
        contributor_name: 'DOE, JANE',
      })
    ).toBe('memo');
  });

  it('routes non-memo committee rows away from donor totals', () => {
    expect(
      classifyScheduleARow({
        contribution_receipt_amount: 5000,
        line_number: '11C',
        memoed_subtotal: false,
        entity_type: 'PAC',
        contributor_name: 'SOME INDUSTRY PAC',
      })
    ).toBe('committee');
  });

  it('rejects zero and negative amounts', () => {
    expect(classifyScheduleARow({ ...ordinaryIndividual, contribution_receipt_amount: 0 })).toBe(
      'invalid'
    );
    expect(classifyScheduleARow({ ...ordinaryIndividual, contribution_receipt_amount: -50 })).toBe(
      'invalid'
    );
  });

  it('memo conduit rows without a contributor name are skipped, not attributed', () => {
    expect(classifyScheduleARow({ ...aipacConduitLump, contributor_name: null })).toBe('memo');
  });
});

describe('normalizeConduitName', () => {
  it('folds case, punctuation, and whitespace noise', () => {
    expect(normalizeConduitName('ActBlue')).toBe('ACTBLUE');
    expect(normalizeConduitName('AIPAC  PAC.')).toBe('AIPAC PAC');
  });

  it('does not conflate genuinely different names', () => {
    expect(normalizeConduitName('AIPAC PAC')).not.toBe(
      normalizeConduitName('AMERICAN ISRAEL PUBLIC AFFAIRS COMMITTEE PAC')
    );
  });
});

describe('topConduits', () => {
  it('ranks by amount and truncates', () => {
    const totals = {
      ACTBLUE: { amount: 90000, count: 900 },
      'AIPAC PAC': { amount: 262500, count: 3 },
      WINRED: { amount: 100, count: 2 },
    };
    const top = topConduits(totals, 2);
    expect(top.map(c => c.name)).toEqual(['AIPAC PAC', 'ACTBLUE']);
    expect(top[0].amount).toBe(262500);
  });
});
