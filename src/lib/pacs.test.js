import { describe, expect, it } from 'vitest';
import { PAC_TYPES, pacRows, pacType } from './pacs.js';

describe('pacType', () => {
  it('names each kind from the FEC codes', () => {
    expect(pacType('O', 'U')).toBe('super');
    expect(pacType('Q', 'D')).toBe('politician');
    expect(pacType('Q', 'B')).toBe('lobbyist');
    expect(pacType('V', 'U')).toBe('hybrid');
    expect(pacType('P', 'P')).toBe('campaign');
    expect(pacType('Q', 'U')).toBe('group');
    expect(pacType(null, null)).toBe('group');
  });

  it('the kinds that count more heavily match the grading', () => {
    const heavier = Object.entries(PAC_TYPES)
      .filter(([, t]) => t.heavier)
      .map(([k]) => k);
    expect(heavier.sort()).toEqual(['lobbyist', 'politician', 'super']);
  });
});

describe('pacRows', () => {
  // Sara Jacobs' stored rows (2026-10-08): her own cheques were mixed in as
  // "Candidate Committee" rows with no committee ID
  const rows = [
    {
      pacName: 'JACOBS, SARA',
      amount: 400000,
      contributorId: null,
      committee_type: 'P',
      designation: 'P',
    },
    {
      pacName: 'JACOBS, SARA',
      amount: 260000,
      contributorId: null,
      committee_type: 'P',
      designation: 'P',
    },
    {
      pacName: 'SUGAR PAC',
      amount: 5000,
      contributorId: 'C1',
      committee_type: 'Q',
      designation: 'B',
    },
    {
      pacName: 'SUGAR PAC',
      amount: 5000,
      contributorId: 'C1',
      committee_type: 'Q',
      designation: 'B',
    },
    {
      pacName: 'UNION FUND',
      amount: 5000,
      contributorId: 'C2',
      committee_type: 'Q',
      designation: 'U',
    },
  ];

  it("leaves out the candidate's own money and adds up each PAC", () => {
    const out = pacRows(rows);
    expect(out.map(r => r.name)).toEqual(['SUGAR PAC', 'UNION FUND']);
    expect(out[0]).toMatchObject({ amount: 10000, type: 'lobbyist', weight: 1.5 });
    expect(out[1]).toMatchObject({ amount: 5000, type: 'group', weight: 1 });
  });
});
