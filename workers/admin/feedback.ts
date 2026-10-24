// What visitors send in (owner, 2026-10-16; lifted from Let's Find Out's flags
// and suggestions): "Something wrong with this grade?" on a member's page,
// and "Suggest something" in the footer. Both go in one D1 table and are
// listed on /admin only; nothing is sent anywhere. A flag left unread for
// FLAG_WAIT_DAYS is a health problem (workers/health.js), so none sits unseen.
//
// Lean on D1: one row per item (a person flagging the same member again the
// same day replaces their flag), daily limits per person and for the site,
// and every lookup on an index (scripts/refresh/schema.sql).

import { sha256Hex } from './auth';
import type { Env } from './env';

export const FLAG_REASONS = {
  figures: 'The figures look wrong',
  person: 'Wrong person',
  outdated: 'Out of date',
  other: 'Something else',
} as const;
export type FlagReason = keyof typeof FLAG_REASONS;

/** What the sender says a suggestion is; the GitHub label its issue gets */
export const SUGGESTION_KINDS = {
  idea: { label: 'Idea', githubLabel: 'enhancement' },
  bug: { label: 'Bug', githubLabel: 'bug' },
  // "Something wrong with this race?" (who's on a ballot): read within the
  // same 3 days as a grade flag (workers/health.js)
  race: { label: 'Race', githubLabel: 'bug' },
  other: { label: 'Something else', githubLabel: null },
} as const;
export type SuggestionKind = keyof typeof SUGGESTION_KINDS;

export const MAX_TEXT = 1000;
const MIN_TEXT = 3;
const MAX_PAGE = 200;
export const DAILY_PER_PERSON = 10;
export const DAILY_SITE = 300;
const NEW_ISSUE = 'https://github.com/glasgowshipyard/taskforce-purple/issues/new';
const ISSUE_TITLE_LENGTH = 80;
// A member's Bioguide ID (A000370) or a candidate's FEC ID (H6CA12345)
const MEMBER_ID = /^[A-Z][A-Z0-9]{5,8}$/;

export type Item =
  | { kind: 'flag'; memberId: string; reason: FlagReason; text: string | null; page: string | null }
  | { kind: 'suggestion'; reason: SuggestionKind; text: string; page: string | null };

const has = (o: object, key: unknown): boolean =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(o, key);

function cleanText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_TEXT) : '';
}

function cleanPage(raw: unknown): string | null {
  return typeof raw === 'string' && raw.startsWith('/') ? raw.slice(0, MAX_PAGE) : null;
}

/**
 * What a form sent, checked: an Item, or the reason it can't be saved (in
 * words the form shows). "Something else" on a flag needs a note.
 */
export function readItem(kind: string, body: Record<string, unknown>): Item | string {
  const text = cleanText(body.text);
  const page = cleanPage(body.page);
  if (kind === 'flag') {
    if (typeof body.memberId !== 'string' || !MEMBER_ID.test(body.memberId)) {
      return 'Which member is this about? Reload the page and try again.';
    }
    if (!has(FLAG_REASONS, body.reason)) {
      return 'Pick what looks wrong.';
    }
    const reason = body.reason as FlagReason;
    if (reason === 'other' && text.length < MIN_TEXT) {
      return 'Tell us what looks wrong.';
    }
    return { kind, memberId: body.memberId, reason, text: text || null, page };
  }
  if (kind === 'suggestion') {
    if (text.length < MIN_TEXT) {
      return 'Write a few words first.';
    }
    const reason = has(SUGGESTION_KINDS, body.reason) ? (body.reason as SuggestionKind) : 'other';
    return { kind, reason, text, page };
  }
  return 'Unknown form.';
}

/**
 * The sender, for the daily limits only: their IP address hashed with the
 * day and the admin key, so it can't be turned back into the address and
 * changes every day.
 */
export async function whoFor(request: Request, env: Env, day: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return (await sha256Hex(`who|${day}|${ip}|${env.ADMIN_SECRET ?? ''}`)).slice(0, 32);
}

/** Saves it unless today's limits are reached; false when they are */
export async function saveItem(env: Env, item: Item, who: string, at: string): Promise<boolean> {
  const db = env.RESULTS_DB;
  if (!db) {
    throw new Error('the RESULTS_DB binding is missing');
  }
  const day = at.slice(0, 10);
  const counts = await db
    .prepare(
      'SELECT COUNT(*) AS site, COALESCE(SUM(who = ?2), 0) AS mine FROM feedback WHERE day = ?1'
    )
    .bind(day, who)
    .first<{ site: number; mine: number }>();
  if ((counts?.mine ?? 0) >= DAILY_PER_PERSON || (counts?.site ?? 0) >= DAILY_SITE) {
    return false;
  }
  if (item.kind === 'flag') {
    // Flagging the same member again the same day replaces the flag
    await db
      .prepare(
        `INSERT INTO feedback (kind, at, day, who, member_id, reason, text, page)
         VALUES ('flag', ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (member_id, who, day) WHERE kind = 'flag'
         DO UPDATE SET at = excluded.at, reason = excluded.reason, text = excluded.text,
           page = excluded.page, status = 'open'`
      )
      .bind(at, day, who, item.memberId, item.reason, item.text, item.page)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO feedback (kind, at, day, who, reason, text, page)
         VALUES ('suggestion', ?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(at, day, who, item.reason, item.text, item.page)
      .run();
  }
  return true;
}

export interface Row {
  id: number;
  kind: 'flag' | 'suggestion';
  at: string;
  member_id: string | null;
  reason: string;
  text: string | null;
  page: string | null;
  status: 'open' | 'done' | 'binned';
}

const COLUMNS = 'id, kind, at, member_id, reason, text, page, status';

/** Everything still open, newest first */
export async function openItems(env: Env): Promise<Row[]> {
  const rows = await env.RESULTS_DB?.prepare(
    `SELECT ${COLUMNS} FROM feedback WHERE status = 'open' ORDER BY at DESC LIMIT 200`
  ).all<Row>();
  return rows?.results ?? [];
}

/** The most recently dealt with, newest first */
export async function handledItems(env: Env, limit = 20): Promise<Row[]> {
  const db = env.RESULTS_DB;
  if (!db) {
    return [];
  }
  // One indexed read per status, merged: the index is on (status, at)
  const [done, binned] = await db.batch<Row>([
    db
      .prepare(`SELECT ${COLUMNS} FROM feedback WHERE status = 'done' ORDER BY at DESC LIMIT ?1`)
      .bind(limit),
    db
      .prepare(`SELECT ${COLUMNS} FROM feedback WHERE status = 'binned' ORDER BY at DESC LIMIT ?1`)
      .bind(limit),
  ]);
  return [...done.results, ...binned.results]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export const STATUSES = ['open', 'done', 'binned'] as const;
export type Status = (typeof STATUSES)[number];

export async function setStatus(env: Env, id: number, status: Status): Promise<void> {
  await env.RESULTS_DB?.prepare('UPDATE feedback SET status = ?2 WHERE id = ?1 AND status <> ?2')
    .bind(id, status)
    .run();
}

/** A new GitHub issue filled in from the item, for the admin to check and submit */
export function issueUrl(row: Row, memberName: string | null = null): string {
  const firstLine = (row.text ?? '').split('\n')[0];
  const short = (s: string) =>
    s.length > ISSUE_TITLE_LENGTH ? `${s.slice(0, ISSUE_TITLE_LENGTH - 1).trimEnd()}…` : s;
  const from = row.page ? ` from taskforcepurple.com${row.page}` : '';
  const params = new URLSearchParams();
  if (row.kind === 'flag') {
    const why = FLAG_REASONS[row.reason as FlagReason] ?? row.reason;
    params.set('title', short(`Grade flag: ${memberName ?? row.member_id}: ${why}`));
    params.set(
      'body',
      `${why}${row.text ? `\n\n${row.text}` : ''}\n\n---\nFlagged on taskforcepurple.com, ${row.at.slice(0, 10)}${from} (member ${row.member_id})`
    );
  } else {
    params.set('title', short(firstLine || 'Suggestion'));
    params.set(
      'body',
      `${row.text ?? ''}\n\n---\nSuggested on taskforcepurple.com, ${row.at.slice(0, 10)}${from}`
    );
    const label = SUGGESTION_KINDS[row.reason as SuggestionKind]?.githubLabel;
    if (label) {
      params.set('labels', label);
    }
  }
  return `${NEW_ISSUE}?${params}`;
}
