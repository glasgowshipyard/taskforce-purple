import { describe, expect, it } from 'vitest';
import { seatsFrom } from './seats.mjs';

const person = (id, term) => ({ id: { bioguide: id }, terms: [term] });

describe('who holds each seat (2026-11-04)', () => {
  it('keys House members by district and senators up this cycle by state', () => {
    const seats = seatsFrom(
      [
        person('H1', { type: 'rep', state: 'PA', district: 1 }),
        person('H2', { type: 'rep', state: 'AK', district: 0 }),
        // Class 2 is up in 2026; class 1 and 3 aren't (a class 3 special's
        // seat is held by its appointed senator, the race's incumbent)
        person('S2', { type: 'sen', state: 'TX', class: 2 }),
        person('S1', { type: 'sen', state: 'TX', class: 1 }),
        person('S3', { type: 'sen', state: 'OH', class: 3 }),
      ],
      2026
    );
    expect(seats).toEqual({ 'H-PA-01': 'H1', 'H-AK-00': 'H2', 'S-TX': 'S2' });
  });
});
