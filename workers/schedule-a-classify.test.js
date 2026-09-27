import { describe, expect, it } from 'vitest';
import {
  classifyScheduleARow,
  countsAsItemizedIndividual,
  normalizeConduitName,
  topConduits,
} from './schedule-a-classify.js';

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

  it('rejects zero and unusable amounts', () => {
    expect(classifyScheduleARow({ ...ordinaryIndividual, contribution_receipt_amount: 0 })).toBe(
      'invalid'
    );
    expect(
      classifyScheduleARow({ ...ordinaryIndividual, contribution_receipt_amount: undefined })
    ).toBe('invalid');
  });

  // 2026-09-26: the FEC's itemized-individual total is exactly non-memo
  // line 11AI. Counting by entity type instead disagreed with it.
  it('counts a refund or correction on 11AI as a netting adjustment, as the FEC does', () => {
    expect(classifyScheduleARow({ ...ordinaryIndividual, contribution_receipt_amount: -250 })).toBe(
      'individual-adjustment'
    );
  });

  it('counts a non-person the FEC files as an individual contribution (a tribal nation on 11AI)', () => {
    const tribe = {
      contribution_receipt_amount: 3500,
      entity_type: 'ORG',
      line_number: '11AI',
      contributor_name: 'PECHANGA BAND OF INDIANS',
      memoed_subtotal: false,
    };
    expect(classifyScheduleARow(tribe)).toBe('individual');
  });

  it('does not count individual-looking rows on other lines (JFC transfers, other receipts)', () => {
    expect(classifyScheduleARow({ ...ordinaryIndividual, line_number: '12' })).toBe('committee');
    expect(classifyScheduleARow({ ...ordinaryIndividual, line_number: '15' })).toBe('committee');
  });

  it('treats either FEC memo flag as a memo', () => {
    expect(classifyScheduleARow({ ...ordinaryIndividual, memo_code: 'X' })).toBe('memo');
    expect(classifyScheduleARow({ ...ordinaryIndividual, memoed_subtotal: true })).toBe('memo');
  });

  it('falls back to entity type when a row has no line number', () => {
    expect(
      classifyScheduleARow({
        contribution_receipt_amount: 5000,
        memoed_subtotal: false,
        entity_type: 'PAC',
        contributor_name: 'SOME INDUSTRY PAC',
      })
    ).toBe('committee');
    expect(classifyScheduleARow({ ...ordinaryIndividual, line_number: undefined })).toBe(
      'individual'
    );
  });

  it('knows which classes count toward itemized individual money', () => {
    for (const c of ['individual', 'individual-earmarked', 'individual-adjustment']) {
      expect(countsAsItemizedIndividual(c)).toBe(true);
    }
    for (const c of ['invalid', 'memo', 'conduit-memo', 'committee']) {
      expect(countsAsItemizedIndividual(c)).toBe(false);
    }
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
