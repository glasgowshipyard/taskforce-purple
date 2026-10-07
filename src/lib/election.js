// The 2026 general election. Candidates file their last reports before it on
// 22 October (FEC pre-general, 12G); the races job publishes the next day.
export const ELECTION_DAY = new Date(2026, 10, 3);
export const ELECTION_DAY_TEXT = 'Tuesday, November 3';
export const RACES_ARRIVE_TEXT = 'October 23';
export const CYCLE_LABEL = '2025–26';

export function daysUntilElection(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((ELECTION_DAY - today) / 86400000);
}
