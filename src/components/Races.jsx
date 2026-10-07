import React, { useMemo, useState } from 'react';
import { TaskForceAPI } from '../lib/api.js';
import { STATE_ABBREVIATIONS } from '../../workers/shared-constants.js';
import MoneyTrail from './MoneyTrail.jsx';

// The 2026 races (ROADMAP Phase E): everyone on November's ballot for
// Congress who files with the FEC, graded the same way as sitting members.

const STATE_NAMES = Object.fromEntries(
  Object.entries(STATE_ABBREVIATIONS).map(([name, abbr]) => [abbr, name])
);
const PARTY = {
  DEM: 'Democratic',
  REP: 'Republican',
  LIB: 'Libertarian',
  GRE: 'Green',
  IND: 'Independent',
  NNE: 'No party',
  NPA: 'No party',
  UN: 'Unaffiliated',
};
const party = p => PARTY[p] || p || 'Party not given';
const usd = n => (n === null || n === undefined ? '—' : TaskForceAPI.formatCurrency(Math.round(n)));
const pct = (part, whole) =>
  part === null || part === undefined || !whole ? '—' : `${Math.round((part / whole) * 100)}%`;

function CandidateCard({ c, open, onToggle }) {
  return (
    <div className={`rounded-lg border p-4 ${open ? 'border-slate-500' : 'border-gray-200'}`}>
      <div className="flex items-center gap-3">
        <div
          className={`w-12 h-12 flex-shrink-0 rounded-full flex items-center justify-center text-xl font-bold ${TaskForceAPI.getTierColor(c.tier)}`}
        >
          {c.tier ? TaskForceAPI.getTierBadgeLabel(c.tier) : '–'}
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{c.name}</div>
          <div className="text-xs text-gray-600">
            {party(c.party)}
            {/* A sitting member as Congress lists them, not the FEC's own
                incumbent flag, which can be out of date */}
            {c.bioguideId && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                In office now
              </span>
            )}
          </div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-gray-500">Raised</dt>
          <dd className="font-semibold">{usd(c.totalRaised)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">From small donors</dt>
          <dd className="font-semibold">{pct(c.smallDonors, c.totalRaised)}</dd>
        </div>
        <div>
          <dt className="text-gray-500">From PACs</dt>
          <dd className="font-semibold">{pct(c.pac, c.totalRaised)}</dd>
        </div>
      </dl>
      {c.evidenceChecked === false && (
        <p className="mt-2 text-xs text-amber-800">Still being double-checked against the FEC.</p>
      )}
      {!c.tier && (
        <p className="mt-2 text-xs text-gray-600">
          Not graded: no campaign committee we can grade for this election yet.
        </p>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="mt-3 text-sm font-medium text-purple-700 hover:underline"
      >
        {open ? 'Hide where the money comes from' : 'Where the money comes from'}
      </button>
    </div>
  );
}

export default function Races({ data }) {
  const states = useMemo(
    () =>
      [...new Set((data?.races || []).map(r => r.state))].sort((a, b) =>
        (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b)
      ),
    [data]
  );
  const [selected, setSelected] = useState(states[0] || '');
  const [open, setOpen] = useState(null);
  const races = (data?.races || []).filter(r => r.state === selected);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900">The races this November</h2>
        <p className="mt-2 text-sm text-gray-700">
          Everyone running for Congress on November&apos;s ballot who reports their money to the
          FEC, graded the same way as the people in office now: who pays for their campaign, and
          whether a few big donors could call the shots.
        </p>
        <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="race-state">
          State
        </label>
        <select
          id="race-state"
          value={selected}
          onChange={e => {
            setSelected(e.target.value);
            setOpen(null);
          }}
          className="mt-1 block w-full sm:w-72 rounded-md border-gray-300 border p-2 text-sm"
        >
          {states.map(s => (
            <option key={s} value={s}>
              {STATE_NAMES[s] || s}
            </option>
          ))}
        </select>
      </div>

      {races.map(r => {
        const openHere = r.candidates.find(c => `${r.key}:${c.candidateId}` === open);
        return (
          <section key={r.key} className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900">
              {STATE_NAMES[r.state] || r.state}: {r.label}
            </h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {r.candidates.map(c => {
                const id = `${r.key}:${c.candidateId}`;
                return (
                  <CandidateCard
                    key={c.candidateId}
                    c={c}
                    open={open === id}
                    onToggle={() => setOpen(open === id ? null : id)}
                  />
                );
              })}
            </div>
            {openHere && (
              <div className="mt-4">
                <MoneyTrail
                  member={{
                    bioguideId: openHere.bioguideId || openHere.candidateId,
                    gradeBasis: 'all-committees',
                  }}
                  loadDetail={
                    openHere.bioguideId
                      ? undefined
                      : () => TaskForceAPI.fetchCandidateDetail(openHere.candidateId)
                  }
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
