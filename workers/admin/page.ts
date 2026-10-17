// The /admin pages as HTML, drawn by the API worker (served on
// taskforcepurple.com/admin through functions/admin). Plain HTML and forms, a
// few lines of script for local times: nothing to build, nothing to load.

import { FLAG_REASONS, SUGGESTION_KINDS, issueUrl, type Row } from './feedback';

const SITE = 'https://taskforcepurple.com';
const REPO = 'https://github.com/glasgowshipyard/taskforce-purple';
const LETTERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

export function escapeHtml(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const time = (iso: string | null | undefined) =>
  iso
    ? `<time datetime="${escapeHtml(iso)}">${escapeHtml(iso.slice(0, 16).replace('T', ' '))} UTC</time>`
    : '—';

// Times in the reader's own zone, once the page has loaded
const LOCAL_TIME_SCRIPT = `document.querySelectorAll('time[datetime]').forEach(function(t){var d=new Date(t.dateTime);if(!isNaN(d)){t.textContent=d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}});`;

const STYLE = `
:root{color-scheme:light dark;--paper:#f2f1ec;--sheet:#fffefa;--ink:#15131c;--soft:#55525e;--line:#dddad2;--purple:#5b21b6;--bad:#b4233c;--good:#0b7a5c;--warn:#8a5a00}
@media (prefers-color-scheme:dark){:root{--paper:#141219;--sheet:#1c1a22;--ink:#ece9f3;--soft:#a29eac;--line:#34313d;--purple:#c4b5fd;--bad:#f6836d;--good:#34d3a6;--warn:#e9b824}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 64px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:28px;margin:0}h2{font-size:20px;margin:36px 0 10px}h3{font-size:16px;margin:0}
a{color:var(--purple)}.soft{color:var(--soft);font-size:14px}
.card{background:var(--sheet);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
.problem{border-left:6px solid var(--bad)}.allclear{border-left:6px solid var(--good)}
.fix{margin:6px 0 0;color:var(--soft);font-size:14px}
.row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline}
.chip{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--line);color:var(--ink);white-space:nowrap}
.chip.flag{background:#fbe3dd;color:#8f2a1a}.chip.idea{background:#e5ddfb;color:#3b1a85}.chip.bug{background:#fde7c4;color:#7a4b00}
.note{white-space:pre-wrap;margin:8px 0 0}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
form.inline{display:inline}
button,.button{font:inherit;font-size:14px;font-weight:600;padding:7px 12px;border-radius:8px;border:1px solid var(--ink);background:var(--sheet);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-block}
button.primary{background:var(--ink);color:var(--sheet)}
input{font:inherit;padding:10px 12px;border:2px solid var(--ink);border-radius:10px;background:var(--sheet);color:var(--ink);width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.stat b{display:block;font-size:26px}
.tiers{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.tiers span{min-width:52px;text-align:center;padding:4px 6px;border:1px solid var(--line);border-radius:8px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}
.scroll{overflow-x:auto}
ul.links{margin:0;padding-left:20px}
.good{color:var(--good);font-weight:700}.bad{color:var(--bad);font-weight:700}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main><script>${LOCAL_TIME_SCRIPT}</script></body></html>`;
}

export function loginPage(message?: string): string {
  return page(
    'Admin · Task Force Purple',
    `<header><h1>Task Force Purple admin</h1><a href="${SITE}/">Back to the site</a></header>
<form method="post" action="/admin/login" class="card" style="max-width:420px;display:grid;gap:10px;margin-top:20px">
<label for="key"><b>Admin key</b></label>
<input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
<button class="primary" type="submit">Open the admin panel</button>
${message ? `<p class="bad" style="margin:0">${escapeHtml(message)}</p>` : ''}
</form>`
  );
}

export interface Member {
  bioguideId: string;
  name: string;
  tier: string;
  evidenceChecked?: boolean | null;
  individualFundingPercent?: number | null;
}

export interface Health {
  ok: boolean;
  problems: { id: string; message: string; fix?: string }[];
  notes: string[];
}

export interface GradeChange {
  bioguide_id: string;
  changed_at: string;
  old_tier: string | null;
  new_tier: string | null;
}

export interface Dashboard {
  health: Health;
  open: Row[];
  handled: Row[];
  members: Member[];
  listLastUpdated: string | null;
  lastRun: {
    run_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
  } | null;
  d1RowsToday: number | null;
  d1RowsReadToday: number | null;
  d1SizeBytes: number | null;
  changes: GradeChange[];
}

// "Sara Jacobs" from "Jacobs, Sara": the list's names are last-name first
function displayName(raw: string | undefined): string {
  if (!raw || !raw.includes(',')) {
    return raw ?? '';
  }
  const [last, ...rest] = raw.split(',').map(s => s.trim());
  const given = rest
    .join(' ')
    .replace(/\b(Jr\.?|Sr\.?|II|III|IV)\s*$/i, '')
    .trim();
  const nick = given.match(/["“]([^"”]+)["”]/);
  const first = nick
    ? nick[1]
    : given
        .split(/\s+/)
        .filter(w => w && !/^[A-Z]\.?$/.test(w))
        .join(' ');
  return [first, last].filter(Boolean).join(' ');
}

const statusButton = (row: Row, status: string, label: string, primary = false) =>
  `<form class="inline" method="post" action="/admin/item/${row.id}/${status}"><button${primary ? ' class="primary"' : ''} type="submit">${label}</button></form>`;

function itemCard(row: Row, byId: Map<string, Member>, handled = false): string {
  const member = row.member_id ? byId.get(row.member_id) : undefined;
  const name = member ? displayName(member.name) : row.member_id;
  const head =
    row.kind === 'flag'
      ? `<span class="chip flag">Grade flag</span> <b>${escapeHtml(FLAG_REASONS[row.reason as keyof typeof FLAG_REASONS] ?? row.reason)}</b>
         · <a href="${SITE}/${/^[A-Z]\d{6}$/.test(row.member_id ?? '') ? 'member' : 'candidate'}/${encodeURIComponent(row.member_id ?? '')}">${escapeHtml(name)}</a>${member ? ` <span class="soft">(${escapeHtml(member.tier)})</span>` : ''}`
      : `<span class="chip ${escapeHtml(row.reason)}">${escapeHtml(SUGGESTION_KINDS[row.reason as keyof typeof SUGGESTION_KINDS]?.label ?? 'Suggestion')}</span>`;
  const actions = handled
    ? statusButton(row, 'open', 'Reopen')
    : `<a class="button" href="${escapeHtml(issueUrl(row, member ? displayName(member.name) : null))}" target="_blank" rel="noopener">Make an issue</a>
       ${statusButton(row, 'done', 'Done', true)}${statusButton(row, 'binned', 'Bin')}`;
  return `<div class="card">
<div class="row"><div>${head}</div><span class="soft">${time(row.at)}${handled ? ` · ${escapeHtml(row.status)}` : ''}</span></div>
${row.text ? `<p class="note">${escapeHtml(row.text)}</p>` : ''}
${row.page ? `<p class="soft" style="margin:6px 0 0">Sent from <a href="${SITE}${escapeHtml(row.page)}">${escapeHtml(row.page)}</a></p>` : ''}
<div class="actions">${actions}</div>
</div>`;
}

export function dashboardPage(d: Dashboard): string {
  const byId = new Map(d.members.map(m => [m.bioguideId, m]));
  const flags = d.open.filter(r => r.kind === 'flag');
  const suggestions = d.open.filter(r => r.kind === 'suggestion');
  const graded = d.members.filter(m => LETTERS.includes(m.tier));
  const tiers = LETTERS.map(
    l => `<span><b>${l}</b> ${graded.filter(m => m.tier === l).length}</span>`
  ).join('');
  const withheld = d.members.length - graded.length;
  const unchecked = graded.filter(m => m.evidenceChecked === false).length;

  const health = d.health.problems.length
    ? d.health.problems
        .map(
          p =>
            `<div class="card problem"><b>${escapeHtml(p.message)}</b>${p.fix ? `<p class="fix"><b>Proposed fix:</b> ${escapeHtml(p.fix)}</p>` : ''}</div>`
        )
        .join('')
    : '<div class="card allclear"><b class="good">All clear.</b> Nothing needs you.</div>';

  const run = d.lastRun;
  const changes = d.changes.length
    ? `<div class="scroll"><table><thead><tr><th>Member</th><th>Change</th><th>When</th></tr></thead><tbody>${d.changes
        .map(c => {
          const m = byId.get(c.bioguide_id);
          return `<tr><td><a href="${SITE}/member/${encodeURIComponent(c.bioguide_id)}">${escapeHtml(m ? displayName(m.name) : c.bioguide_id)}</a></td><td>${escapeHtml(c.old_tier ?? '–')} → ${escapeHtml(c.new_tier ?? '–')}</td><td>${time(c.changed_at)}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : '<p class="soft">No grade changes recorded yet.</p>';

  return page(
    'Admin · Task Force Purple',
    `<header><h1>Task Force Purple admin</h1>
<div class="row"><a href="${SITE}/">The site</a><form class="inline" method="post" action="/admin/logout"><button type="submit">Log out</button></form></div></header>

<h2>Needs you</h2>
${health}

<h2 id="flags">Grade flags · ${flags.length} open</h2>
${flags.length ? flags.map(r => itemCard(r, byId)).join('') : '<p class="soft">No open flags. Visitors flag a grade from the link on each member page.</p>'}

<h2 id="suggestions">Suggestions · ${suggestions.length} open</h2>
${suggestions.length ? suggestions.map(r => itemCard(r, byId)).join('') : '<p class="soft">No open suggestions. Visitors send them from “Suggest something” in the footer.</p>'}

<h2>The grades</h2>
<div class="grid">
<div class="card stat"><span class="soft">Graded</span><b>${graded.length}</b><div class="tiers">${tiers}</div></div>
<div class="card stat"><span class="soft">Still being checked</span><b>${unchecked}</b><span class="soft">${withheld} withheld (under review or unconfirmed)</span></div>
<div class="card stat"><span class="soft">Site data last changed</span><b style="font-size:18px">${time(d.listLastUpdated)}</b></div>
<div class="card stat"><span class="soft">Last refresh run</span><b style="font-size:18px">${run ? `${escapeHtml(run.status)}` : 'none yet'}</b><span class="soft">${run ? `${escapeHtml(run.run_id)} · ${time(run.finished_at ?? run.started_at)}` : ''}</span></div>
</div>
<h3 style="margin-top:16px">Recent grade changes</h3>
${changes}

<h2>Budgets today (UTC)</h2>
<div class="grid">
<div class="card stat"><span class="soft">D1 rows written</span><b>${(d.d1RowsToday ?? 0).toLocaleString('en-US')}</b><span class="soft">The refresh job stops at 85,000; D1 refuses at 100,000 (whole account)</span></div>
<div class="card stat"><span class="soft">D1 rows read</span><b>${(d.d1RowsReadToday ?? 0).toLocaleString('en-US')}</b><span class="soft">The job stops at 3M; D1 refuses at 5M (whole account)</span></div>
<div class="card stat"><span class="soft">Results database</span><b>${d.d1SizeBytes ? `${Math.round(d.d1SizeBytes / 1e6)} MB` : '—'}</b><span class="soft">of D1's 500 MB</span></div>
</div>
${d.health.notes.length ? `<ul class="soft">${d.health.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}

<h2>Handy links</h2>
<ul class="links">
<li><a href="${REPO}/actions/workflows/refresh.yml">Refresh runs</a> and <a href="${REPO}/actions/workflows/races.yml">Races runs</a> (GitHub Actions)</li>
<li><a href="${REPO}/issues?q=is%3Aopen+label%3Asystem-alert">Open system alerts</a> · <a href="${REPO}/issues">All issues</a></li>
<li><a href="https://taskforce-purple-api.dev-a4b.workers.dev/api/health">/api/health</a> (the same checks as “Needs you”, as JSON)</li>
<li><a href="${REPO}/blob/main/RUNBOOK.md">RUNBOOK</a> · <a href="${REPO}/blob/main/IMPLEMENTATION_STATUS.md">Status log</a></li>
<li><a href="https://dash.cloudflare.com/">Cloudflare dashboard</a></li>
</ul>

<h2>Recently dealt with</h2>
${d.handled.length ? d.handled.map(r => itemCard(r, byId, true)).join('') : '<p class="soft">Nothing yet.</p>'}`
  );
}
