import { describe, expect, it } from 'vitest';
import {
  crosswalkIdsFor,
  isVerifiedIdentity,
  heldOffice,
  selectPrimaryCandidate,
  activeCandidates,
} from './fec-identity.js';
import { FEC_CROSSWALK } from './fec-crosswalk.js';

// Real cases from the 2026-09-26 audit (issue #41). Each cached mapping on
// the left was a different person; the crosswalk must reject it.
const WRONG_PERSON_CASES = [
  { bioguide: 'R000614', cached: 'S0TX00266', correct: 'H8TX21307' }, // -> WEST, ROYCE
  { bioguide: 'M001235', cached: 'S4WV00159', correct: 'H4WV02205' }, // -> CAPITO
  { bioguide: 'M001226', cached: 'S6NJ00289', correct: 'H2NJ08232' }, // -> father's Senate cttee
  { bioguide: 'M001153', cached: 'S0AK00063', correct: 'S4AK00099' }, // -> father
  { bioguide: 'F000450', cached: 'H0NC06225', correct: 'H4NC05146' }, // -> FOXX, RHONDA
];

describe('crosswalk file', () => {
  it('covers the whole of Congress', () => {
    const entries = Object.values(FEC_CROSSWALK);
    expect(entries.length).toBeGreaterThanOrEqual(530);
    expect(entries.filter(ids => ids.length > 0).length).toBeGreaterThanOrEqual(520);
  });

  it('holds well-formed FEC candidate IDs only', () => {
    for (const ids of Object.values(FEC_CROSSWALK)) {
      for (const id of ids) {
        expect(id).toMatch(/^[HSP][0-9A-Z]{8}$/);
      }
    }
  });
});

describe('isVerifiedIdentity', () => {
  it.each(WRONG_PERSON_CASES)('rejects the audited wrong mapping for $bioguide', c => {
    expect(isVerifiedIdentity(c.bioguide, c.cached)).toBe(false);
    expect(isVerifiedIdentity(c.bioguide, c.correct)).toBe(true);
  });

  it('rejects a missing candidate ID', () => {
    expect(isVerifiedIdentity('R000614', null)).toBe(false);
    expect(isVerifiedIdentity('R000614', undefined)).toBe(false);
  });

  it('rejects everything for a member with no recorded FEC identity', () => {
    const crosswalk = { X000001: [] };
    expect(crosswalkIdsFor('X000001', crosswalk)).toEqual([]);
    expect(isVerifiedIdentity('X000001', 'H0XX00000', crosswalk)).toBe(false);
    expect(isVerifiedIdentity('NOT_IN_TABLE', 'H0XX00000', crosswalk)).toBe(false);
  });
});

describe('heldOffice', () => {
  it('reads the chamber', () => {
    expect(heldOffice({ chamber: 'House' })).toBe('H');
    expect(heldOffice({ chamber: 'House of Representatives' })).toBe('H');
    expect(heldOffice({ chamber: 'Senate' })).toBe('S');
  });

  it('falls back to district when chamber is missing', () => {
    expect(heldOffice({ district: 4 })).toBe('H');
    expect(heldOffice({})).toBe('S');
  });
});

describe('selectPrimaryCandidate', () => {
  // Shapes taken from a live /candidates/search/ response for a House
  // member running for Senate in 2026
  const house = { candidate_id: 'H6MN02131', office: 'H', active_through: 2026 };
  const senate = { candidate_id: 'S6MN00499', office: 'S', active_through: 2026 };

  it('picks the record for the office currently held', () => {
    expect(selectPrimaryCandidate([senate, house], 'H')).toBe(house);
    expect(selectPrimaryCandidate([house, senate], 'S')).toBe(senate);
  });

  it('prefers the most recently active record for the same office', () => {
    const oldRun = { candidate_id: 'H2MD04315', office: 'H', active_through: 2012 };
    const current = { candidate_id: 'H2MD04232', office: 'H', active_through: 2026 };
    expect(selectPrimaryCandidate([oldRun, current], 'H')).toBe(current);
  });

  it('falls back to the most recent record when none matches the office', () => {
    expect(selectPrimaryCandidate([senate], 'H')).toBe(senate);
  });

  it('returns null with nothing to choose from', () => {
    expect(selectPrimaryCandidate([], 'H')).toBeNull();
    expect(selectPrimaryCandidate(null, 'H')).toBeNull();
  });
});

describe('activeCandidates', () => {
  const pc = (cycles, designation = 'P') => ({ designation, cycles });

  it('returns every campaign filing in the cycle - both, for a House member running for Senate', () => {
    const house = { candidate_id: 'H1', principal_committees: [pc([2024, 2026])] };
    const senate = { candidate_id: 'S1', principal_committees: [pc([2026])] };
    const oldBid = { candidate_id: 'S2', principal_committees: [pc([2010])] };
    expect(activeCandidates([house, senate, oldBid], 2026).map(c => c.candidate_id)).toEqual([
      'H1',
      'S1',
    ]);
  });

  it('ignores non-authorized committees', () => {
    const c = { candidate_id: 'H1', principal_committees: [pc([2026], 'J')] };
    expect(activeCandidates([c], 2026)).toEqual([]);
  });
});
