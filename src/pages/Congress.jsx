// All of Congress: every member's stamp, searchable and filterable. The
// filters live in the address, so a filtered view can be shared.
import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PowerBar, Skeleton, Stamp } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { GRADES, LETTERS, gradeInfo, isIdentityUnverified, isRingfenced } from '../lib/grades.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import {
  count,
  displayName,
  gradedFigures,
  moneyLines,
  partyName,
  seatLabel,
} from '../lib/people.js';
import { Link, memberPath, navigate } from '../lib/router.js';

const PAGE = 60;
const SORTS = {
  best: 'Most people-funded first',
  worst: 'Least people-funded first',
  raised: 'Most money raised',
  name: 'Name',
};

function readParams(search) {
  const p = new URLSearchParams(search);
  const grade = p.get('grade');
  const chamber = p.get('chamber');
  return {
    grade: LETTERS.includes(grade) ? grade : null,
    chamber: chamber === 'house' || chamber === 'senate' ? chamber : null,
    q: p.get('q') || '',
    sort: SORTS[p.get('sort')] ? p.get('sort') : 'best',
  };
}

function writeParams(next) {
  const p = new URLSearchParams();
  if (next.q) {
    p.set('q', next.q);
  }
  if (next.chamber) {
    p.set('chamber', next.chamber);
  }
  if (next.grade) {
    p.set('grade', next.grade);
  }
  if (next.sort !== 'best') {
    p.set('sort', next.sort);
  }
  const s = p.toString();
  navigate(`/congress${s ? `?${s}` : ''}`, { replace: true, keepScroll: true });
}

function Row({ m }) {
  const f = gradedFigures(m);
  const withheld = isRingfenced(m.tier);
  const lines = !withheld && f.totalRaised > 0 ? moneyLines(f) : null;
  const n = isIdentityUnverified(m.tier) ? null : m.nakamotoCoefficient;
  return (
    <li>
      <Link to={memberPath(m.bioguideId)} className="member-row">
        <Stamp tier={m.tier} size={58} word={false} rot={-6} />
        <span className="member-row-body">
          <span className="member-row-name">{displayName(m.name)}</span>
          <span className="count-line">
            {seatLabel(m)} · {partyName(m.party)}
          </span>
          {lines && <PowerBar lines={lines} />}
          <span className="count-line">
            {withheld
              ? gradeInfo(m.tier, m.withheldReason).name
              : n > 0
                ? `Half the big-donation money from ${n === 1 ? 'one person' : `${count(n)} people`}`
                : gradeInfo(m.tier, m.withheldReason).name}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function Congress({ search }) {
  useTitle('All of Congress');
  const members = useAsync(() => api.members(), []);
  const params = readParams(search);
  const [shown, setShown] = useState(PAGE);
  const set = change => {
    setShown(PAGE);
    writeParams({ ...params, ...change });
  };

  const list = useMemo(() => {
    const all = members.data?.members || [];
    const q = params.q.trim().toLowerCase();
    const out = all.filter(
      m =>
        (!params.grade || m.tier === params.grade) &&
        (!params.chamber || m.chamber.toLowerCase() === params.chamber) &&
        (!q ||
          displayName(m.name).toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.state.toLowerCase().includes(q) ||
          (m.party || '').toLowerCase().includes(q))
    );
    const rank = m => GRADES[m.tier]?.rank ?? -1;
    const pct = m => {
      const f = gradedFigures(m);
      return f.totalRaised > 0
        ? (f.grassrootsDonations + (f.largeDonorDonations || 0)) / f.totalRaised
        : 0;
    };
    const byName = (a, b) => displayName(a.name).localeCompare(displayName(b.name));
    const sorters = {
      best: (a, b) => rank(b) - rank(a) || pct(b) - pct(a) || byName(a, b),
      worst: (a, b) => {
        // Withheld grades aren't bad grades: they go last either way
        const ra = rank(a) <= 0 ? 99 : rank(a);
        const rb = rank(b) <= 0 ? 99 : rank(b);
        return ra - rb || pct(a) - pct(b) || byName(a, b);
      },
      raised: (a, b) => gradedFigures(b).totalRaised - gradedFigures(a).totalRaised,
      name: byName,
    };
    return out.sort(sorters[params.sort]);
  }, [members.data, params.q, params.grade, params.chamber, params.sort]);

  return (
    <div className="wrap section">
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            {members.data ? `${members.data.members.length} members` : 'Congress'}
          </p>
          <h1 className="display display-l">All of Congress</h1>
        </div>
        <p>
          Every senator, representative and non-voting delegate, graded on where their campaign
          money comes from. You can search by name, state or party.
        </p>
      </div>

      <div className="filters">
        <label className="sr-only" htmlFor="congress-q">
          Search by name, state or party
        </label>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <Search
            size={20}
            aria-hidden="true"
            style={{ position: 'absolute', left: 14, top: 16, color: 'var(--muted)' }}
          />
          <input
            id="congress-q"
            className="input"
            type="search"
            placeholder="Name, state or party"
            value={params.q}
            onChange={e => set({ q: e.target.value })}
            style={{ paddingLeft: 44 }}
          />
        </div>
        <div className="seg" role="group" aria-label="Chamber">
          {[
            [null, 'Both'],
            ['house', 'House'],
            ['senate', 'Senate'],
          ].map(([v, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={params.chamber === v}
              onClick={() => set({ chamber: v })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grade-chips" role="group" aria-label="Grade">
          {LETTERS.map(l => (
            <button
              key={l}
              type="button"
              className="grade-chip"
              style={{ '--g': GRADES[l].color }}
              aria-pressed={params.grade === l}
              aria-label={`Grade ${l}, ${GRADES[l].name}`}
              onClick={() => set({ grade: params.grade === l ? null : l })}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Sort
          <select
            className="input"
            style={{ width: 'auto', minHeight: 48 }}
            value={params.sort}
            onChange={e => set({ sort: e.target.value })}
          >
            {Object.entries(SORTS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {members.loading && (
        <div className="member-rows">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={96} />
          ))}
        </div>
      )}
      {members.error && (
        <p className="notice notice-warn">
          <strong>We couldn&apos;t load Congress just now.</strong> Check your connection and
          reload.
        </p>
      )}
      {members.data && (
        <>
          <p className="count-line" role="status" style={{ marginBottom: 12 }}>
            {list.length === 0
              ? 'No members match. Try removing a filter.'
              : `Showing ${Math.min(shown, list.length)} of ${list.length}`}
            {params.grade && ` · grade ${params.grade}, ${GRADES[params.grade].name}`}
          </p>
          <ul className="member-rows">
            {list.slice(0, shown).map(m => (
              <Row key={m.bioguideId} m={m} />
            ))}
          </ul>
          {shown < list.length && (
            <p style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setShown(s => s + PAGE)}
              >
                Show {Math.min(PAGE, list.length - shown)} more
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
