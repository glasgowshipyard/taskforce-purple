import { describe, expect, it } from 'vitest';
import {
  selectVehicles,
  classifyTransfers,
  combineVehicleTotals,
  isMembersOwnFund,
  largestCandidateRecipient,
  donorCommitteeIds,
  committeeSignature,
} from './person-funding.js';

const t = (receipts, unitem, item, pac = 0, out = 0) => ({
  receipts,
  individual_unitemized_contributions: unitem,
  individual_itemized_contributions: item,
  other_political_committee_contributions: pac,
  transfers_to_affiliated_committee: out,
});

describe('selectVehicles', () => {
  it("keeps the member's campaign, joint fund and leadership PAC active this cycle", () => {
    const v = selectVehicles(
      [
        { committee_id: 'C1', designation: 'P', cycles: [2026] },
        { committee_id: 'C2', designation: 'J', cycles: [2026] },
        { committee_id: 'C3', designation: 'J', cycles: [2010] },
        { committee_id: 'C4', designation: 'D', cycles: [2026] },
        { committee_id: 'C5', designation: 'U', cycles: [2026] },
      ],
      2026
    );
    expect(v.map(x => [x.committeeId, x.role])).toEqual([
      ['C1', 'campaign'],
      ['C2', 'joint'],
      ['C4', 'leadership'],
    ]);
  });
});

describe('classifyTransfers', () => {
  const money = [{ committeeId: 'C1' }, { committeeId: 'C4' }];
  const row = (sender, amount, designation = 'J', extra = {}) => ({
    contributor_id: sender,
    contribution_receipt_amount: amount,
    contributor: { designation, name: sender },
    ...extra,
  });

  it('nets transfers between the member own money vehicles', () => {
    expect(classifyTransfers(money, [row('C4', 5000, 'D')]).internal).toBe(5000);
  });

  it('treats every joint fund alike - registered or not - as money received', () => {
    const r = classifyTransfers(money, [row('C2', 139554), row('C9', 1449000), row('C9', 1467)]);
    expect(r.internal).toBe(0);
    expect(r.jfcs).toEqual([
      { committeeId: 'C2', name: 'C2', received: 139554 },
      { committeeId: 'C9', name: 'C9', received: 1450467 },
    ]);
  });

  it('ignores memo rows and non-JFC senders such as party committees', () => {
    const r = classifyTransfers(money, [
      row('C2', 99, 'J', { memo_code: 'X' }),
      row('NRCC', 5000, 'U'),
    ]);
    expect(r).toEqual({ internal: 0, jfcs: [] });
  });
});

describe('isMembersOwnFund', () => {
  it('a fund registered under the member is theirs, whatever it passed on', () => {
    expect(isMembersOwnFund({ registered: true, received: 1, totals: t(1, 0, 0, 0, 100) })).toBe(
      true
    );
  });
  it("a leader's fund is theirs when they are its largest candidate recipient, even at 6% of its transfers", () => {
    // GROW THE MAJORITY: $79.8M passed on, $5.0M to the Speaker, rest to the party
    const fund = {
      received: 5033964,
      largestCandidateRecipient: 'C1',
      totals: t(95770596, 0, 0, 0, 79837455),
    };
    expect(isMembersOwnFund(fund, ['C1'])).toBe(true);
    expect(isMembersOwnFund({ ...fund, largestCandidateRecipient: 'C77' }, ['C1'])).toBe(false);
  });
  it('without disbursement data, falls back to receiving at least half', () => {
    expect(isMembersOwnFund({ received: 1450467, totals: t(5e6, 0, 0, 0, 1500419) })).toBe(true);
    expect(isMembersOwnFund({ received: 21200, totals: t(5e6, 0, 0, 0, 900000) })).toBe(false);
  });
});

describe('largestCandidateRecipient', () => {
  it('ignores party committees and memo rows', () => {
    const row = (id, amount, type = 'H', extra = {}) => ({
      recipient_committee_id: id,
      disbursement_amount: amount,
      recipient_committee: { committee_type: type },
      ...extra,
    });
    expect(
      largestCandidateRecipient([
        row('NRCC', 70000000, 'Y'),
        row('C1', 5000000),
        row('C2', 1000000),
        row('C3', 9000000, 'H', { memo_code: 'X' }),
      ])
    ).toBe('C1');
  });
});

describe('combineVehicleTotals', () => {
  it('grades on what the member received: a fund counts by its transfers, split by its mix', () => {
    const r = combineVehicleTotals(
      [
        {
          committeeId: 'C1',
          role: 'campaign',
          name: 'C',
          totals: t(2465830, 1411327, 808796, 33000),
        },
      ],
      {
        internal: 0,
        jfcs: [
          {
            committeeId: 'C2',
            name: 'VICTORY FUND',
            registered: true,
            received: 250000,
            totals: t(2614409, 0, 2582517, 0, 2156831),
          },
        ],
      }
    );
    // the fund's money is already inside the campaign's receipts
    expect(r.totalRaised).toBe(2465830);
    expect(r.largeDonorDonations).toBeCloseTo(808796 + 250000 * (2582517 / 2614409));
    const fund = r.committees.find(c => c.committeeId === 'C2');
    expect(fund.passedElsewhere).toBeCloseTo(2156831 - 250000);
    expect(fund.ownFund).toBe(true);
    // disclosure: everything raised in the member's name
    expect(r.raisedInName).toBeCloseTo(2465830 + (2614409 - 250000));
    expect(r.invariantsHold).toBe(true);
  });

  it('nets money moved between the member own vehicles', () => {
    const r = combineVehicleTotals(
      [
        { committeeId: 'C1', role: 'campaign', name: 'A', totals: t(6511960, 0, 0) },
        { committeeId: 'C6', role: 'campaign', name: 'B', totals: t(897390, 0, 0) },
      ],
      { internal: 730000, jfcs: [] }
    );
    expect(r.totalRaised).toBe(6511960 + 897390 - 730000);
  });

  it('can never net more money than was raised', () => {
    const r = combineVehicleTotals(
      [{ committeeId: 'C1', role: 'campaign', name: 'A', totals: t(100, 50, 50) }],
      {
        internal: 1e9,
        jfcs: [],
      }
    );
    expect(r.totalRaised).toBeGreaterThanOrEqual(0);
  });
});

describe('donorCommitteeIds', () => {
  it('pools donors from money vehicles and the member own funds, not shared funds', () => {
    const ids = donorCommitteeIds({
      committees: [
        { committeeId: 'C1', role: 'campaign' },
        { committeeId: 'C2', role: 'joint', ownFund: true },
        { committeeId: 'C8', role: 'joint', ownFund: false },
        { committeeId: 'C4', role: 'leadership' },
      ],
    });
    expect(ids).toEqual(['C1', 'C2', 'C4']);
    expect(committeeSignature(['C4', 'C1'])).toBe('C1,C4');
  });
});
