// The 2026 general election. Candidates file their last reports before it on
// 22 October (FEC pre-general, 12G); the races job publishes from the 23rd.
export const ELECTION_DAY = new Date(2026, 10, 3);
export const ELECTION_DAY_TEXT = 'Tuesday, November 3';
// A label that's true before the election and after it (owner, 2026-10-23:
// nothing on the site about events still to come)
export const ELECTION_LABEL = '2026 election · Tuesday, November 3';
// An election cycle's names, from its even end year (2026 -> "2025–26",
// "’26"). Each member's are from the cycle their grade is on (gradeCycle),
// so the labels move with the New Year rollover (REBUILD_SPEC §9)
export const DEFAULT_CYCLE = 2026;
export const cycleLabel = (cycle = DEFAULT_CYCLE) => `${cycle - 1}–${String(cycle).slice(2)}`;
export const cycleShort = (cycle = DEFAULT_CYCLE) => `’${String(cycle).slice(2)}`;
export const CYCLE_LABEL = cycleLabel();
// The cycle in a corner of a member's graph
export const CYCLE_SHORT = cycleShort();

export function daysUntilElection(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((ELECTION_DAY - today) / 86400000);
}
