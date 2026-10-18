// The filing calendar (#54, REBUILD_SPEC §8): campaign money only changes
// when committees file, so a refresh starts only after an FEC filing
// deadline that members file for, once the FEC has had a few days to
// process the reports. Pure: calendar.mjs does the fetching and starting.

// What a member's campaign files (House and Senate principal campaign
// committees): the quarterlies, the year-end, and the pre- and post-general
// in election years. Pre-primary and runoff reports are by state and come
// too late or too early to matter for a whole-Congress refresh
export const MEMBER_REPORTS = ['Q1', 'Q2', 'Q3', 'YE', '12G', '30G'];
// Days after a deadline before refreshing: reports filed on the day are in
// the FEC's data (and its bulk files) a day or two later
export const PROCESS_DAYS = 3;
// A deadline older than this is history: never refreshed for again
export const LOOKBACK_DAYS = 30;

const day = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
const addDays = (d, n) => new Date(day(d).getTime() + n * 86400000).toISOString().slice(0, 10);

/**
 * The deadline to refresh for today, or null: the latest member deadline at
 * least PROCESS_DAYS and at most LOOKBACK_DAYS ago that hasn't been handled.
 * `dates`: the FEC's reporting dates [{ report_type, due_date }];
 * `handled`: Set of 'YYYY-MM-DD TYPE' already refreshed for.
 * Returns { due: 'YYYY-MM-DD', type, key, reason }.
 */
export function dueDeadline(dates, today, handled = new Set()) {
  const latest = addDays(today, -PROCESS_DAYS);
  const earliest = addDays(today, -LOOKBACK_DAYS);
  const candidates = (dates || [])
    .filter(d => MEMBER_REPORTS.includes(d.report_type))
    .map(d => ({ due: String(d.due_date).slice(0, 10), type: d.report_type }))
    .filter(d => d.due <= latest && d.due >= earliest)
    .sort((a, b) => (a.due === b.due ? a.type.localeCompare(b.type) : b.due.localeCompare(a.due)));
  const next = candidates[0];
  if (!next) {
    return null;
  }
  const key = `${next.due} ${next.type}`;
  if (handled.has(key)) {
    return null;
  }
  return { ...next, key, reason: `calendar: ${next.type} reports due ${next.due}` };
}

/** The window of dates to ask the FEC for */
export const lookupWindow = today => ({
  min_due_date: addDays(today, -LOOKBACK_DAYS),
  max_due_date: addDays(today, -PROCESS_DAYS),
});
