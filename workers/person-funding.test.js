import { describe, expect, it } from 'vitest';
import {
  selectVehicles,
  classifyTransfers,
  combineVehicleTotals,
  vehicleSignature,
} from './person-funding.js';

// Shapes from live FEC responses, 2026 cycle (#32 trial, 2026-09-26)
const campaign = { committee_id: 'C1', designation: 'P', cycles: [2024, 2026], name: 'CAMPAIGN' };
const jfc = { committee_id: 'C2', designation: 'J', cycles: [2026], name: 'VICTORY FUND' };
const oldJfc = { committee_id: 'C3', designation: 'J', cycles: [2010], name: 'OLD FUND' };
const leadership = { committee_id: 'C4', designation: 'D', cycles: [2026], name: 'LEADERSHIP PAC' };
const unrelated = { committee_id: 'C5', designation: 'U', cycles: [2026], name: 'OTHER' };

describe('selectVehicles', () => {
  it('keeps the member own campaign, JFC and leadership PAC active this cycle', () => {
    const v = selectVehicles([campaign, jfc, oldJfc, leadership, unrelated, campaign], 2026);
    expect(v.map(x => [x.committeeId, x.role])).toEqual([
      ['C1', 'campaign'],
      ['C2', 'joint'],
      ['C4', 'leadership'],
    ]);
  });
});

describe('classifyTransfers', () => {
  const vehicles = [{ committeeId: 'C1' }, { committeeId: 'C2' }, { committeeId: 'C4' }];
  const row = (sender, amount, extra = {}) => ({
    contributor_id: sender,
    contribution_receipt_amount: amount,
    contributor: { designation: 'J', name: sender },
    ...extra,
  });

  it('nets transfers between the member own committees', () => {
    const t = classifyTransfers(vehicles, [row('C2', 139554), row('C2', 110871)]);
    expect(t.internal).toBeCloseTo(250425);
    expect(t.externalJfcs).toEqual([]);
  });

  it('surfaces a joint fund that is not registered under the member (found by its transfers)', () => {
    const t = classifyTransfers(vehicles, [row('C9', 5000000), row('C9', 905327)]);
    expect(t.internal).toBe(0);
    expect(t.externalJfcs).toEqual([{ committeeId: 'C9', name: 'C9', amount: 5905327 }]);
  });

  it('ignores memo rows and non-JFC senders such as party committees', () => {
    const t = classifyTransfers(vehicles, [
      row('C2', 999, { memo_code: 'X' }),
      row('NRCC', 5000, { contributor: { designation: 'U' } }),
    ]);
    expect(t.internal).toBe(0);
    expect(t.externalJfcs).toEqual([]);
  });
});

describe('combineVehicleTotals', () => {
  const totals = (receipts, unitem, item, pac = 0) => ({
    receipts,
    individual_unitemized_contributions: unitem,
    individual_itemized_contributions: item,
    other_political_committee_contributions: pac,
  });

  it('counts each dollar once: sums donor buckets, nets internal transfers from receipts', () => {
    const r = combineVehicleTotals(
      [
        {
          committeeId: 'C1',
          role: 'campaign',
          name: 'C',
          totals: totals(2465830, 1411327, 808796, 33000),
        },
        { committeeId: 'C2', role: 'joint', name: 'J', totals: totals(2614409, 0, 2582517) },
      ],
      { internal: 250425, externalJfcs: [] }
    );
    expect(r.totalRaised).toBeCloseTo(2465830 + 2614409 - 250425);
    expect(r.largeDonorDonations).toBeCloseTo(808796 + 2582517);
    expect(r.invariantsHold).toBe(true);
  });

  it('apportions money from an external JFC by that fund own composition', () => {
    const r = combineVehicleTotals(
      [{ committeeId: 'C1', role: 'campaign', name: 'C', totals: totals(1000000, 0, 0) }],
      {
        internal: 0,
        externalJfcs: [
          {
            committeeId: 'C9',
            name: 'F',
            amount: 400000,
            totals: totals(2000000, 1000000, 800000, 200000),
          },
        ],
      }
    );
    // 400k received from a fund that was 50% small, 40% itemized, 10% PAC
    expect(r.grassrootsDonations).toBeCloseTo(200000);
    expect(r.largeDonorDonations).toBeCloseTo(160000);
    expect(r.pacMoney).toBeCloseTo(40000);
    expect(r.totalRaised).toBe(1000000); // already inside the campaign's receipts
  });

  it('can never net more money than was raised', () => {
    const r = combineVehicleTotals(
      [{ committeeId: 'C1', role: 'campaign', name: 'C', totals: totals(100, 50, 50) }],
      { internal: 1e9, externalJfcs: [] }
    );
    expect(r.totalRaised).toBeGreaterThanOrEqual(0);
  });
});

describe('vehicleSignature', () => {
  it('is order-independent', () => {
    expect(vehicleSignature([{ committeeId: 'C2' }, { committeeId: 'C1' }])).toBe('C1,C2');
  });
});
