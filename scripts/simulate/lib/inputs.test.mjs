// The simulation's extra donor measures on a tiny made-up file.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBulk } from '../../refresh/lib/bulk.mjs';
import { memberDonorShape, pacExtras } from './inputs.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tfp-sim-'));
let sub = 0;
const row = (committee, name, employer, amount, type = '15', other = '') =>
  [
    committee,
    'N',
    'Q1',
    'P',
    '1',
    type,
    'IND',
    name,
    'CITY',
    'DC',
    '20006',
    employer,
    'X',
    '01152026',
    String(amount),
    other,
    `T${++sub}`,
    '1',
    '',
    '',
    String(sub),
  ].join('|');
const itcont = join(dir, 'itcont.txt');
writeFileSync(
  itcont,
  [
    // A member's campaign: four donors who net above $0, one who nets below
    row('C00000001', 'ADAMS, ANN', 'A', 3000),
    row('C00000001', 'BROWN, BEN', 'B', 1000),
    row('C00000001', 'CRUZ, CAL', 'C', 500),
    row('C00000001', 'DIAZ, DEE', 'D', 100),
    row('C00000001', 'DIAZ, DEE', 'D', -300),
    row('C00000001', 'EVANS, EVE', 'E', 100),
    row('C00000001', 'EVANS, EVE', 'E', 50),
    // A company PAC: one employer written two ways
    row('C00000099', 'XU, XAN', 'Lockheed Martin', 3000),
    row('C00000099', 'YATES, YVE', 'LOCKHEED MARTIN CORP.', 1000),
    row('C00000099', 'ZANE, ZED', 'LOCKHEED MARTIN', 500),
    // Earmarked gifts: through a committee that directs them, and through a platform
    row('C00000002', 'FOX, FAY', 'F', 2000, '15E', 'C00000077'),
    row('C00000002', 'GRAY, GUS', 'G', 500, '15E', 'C00401224'),
    row('C00000002', 'HILL, HAL', 'H', 100),
  ].join('\n')
);

describe('simulation donor measures', () => {
  it("a member's donors who net above $0, the biggest donors' money, and capped money", async () => {
    const bulk = await loadBulk(itcont, ['C00000001']);
    const s = await memberDonorShape(bulk, ['C00000001'], 1);
    expect(s.donors).toBe(4); // Diaz nets -200: left out
    expect(s.total).toBe(4650);
    expect(s.nakamoto).toBe(1); // Adams alone holds half of 4,650
    expect(s.topLive).toBe(3000);
    expect(s.topPositive).toBe(3000);
    expect(s.capped).toEqual({ 500: 1650, 1000: 2650, 2000: 3650 });
    // A joint fund that passed on a tenth of its money: its gifts at a tenth
    const w = await memberDonorShape(bulk, ['C00000001'], 1, { C00000001: 0.1 });
    expect(w.total).toBe(465);
    expect(w.donors).toBe(4);
  });

  it('gifts directed by a committee leave the donor test; platform gifts stay', async () => {
    const bulk = await loadBulk(itcont, ['C00000002']);
    expect((await memberDonorShape(bulk, ['C00000002'], 1)).total).toBe(2600);
    const s = await memberDonorShape(bulk, ['C00000002'], 1, null, { platforms: ['C00401224'] });
    expect(s.total).toBe(600);
    expect(s.donors).toBe(2);
    expect(s.directedOut).toEqual({ C00000077: 2000 });
  });

  it("a PAC's capped money and its top employer's share", async () => {
    const db = await loadBulk(itcont, ['C00000000']);
    const p = (await pacExtras(db, itcont, ['C00000099'])).get('C00000099');
    expect(p.capped).toEqual({ 500: 1500, 1000: 2500, 2000: 3500 });
    expect(p.topEmployer).toBe('LOCKHEED MARTIN');
    expect(p.topEmployerShare).toBeCloseTo(3500 / 4500, 4);
  });
});
