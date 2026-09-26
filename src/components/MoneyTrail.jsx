import React, { useEffect, useState } from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import { TaskForceAPI } from '../lib/api.js';

// Plain-English description of each kind of committee (#32). A reader should
// not need to know FEC jargon to see what each one is for.
function describe(c) {
  if (c.role === 'campaign') {
    return 'Pays for their own election.';
  }
  if (c.role === 'leadership') {
    return "Money they hand out to other politicians' campaigns, which builds loyalty and influence.";
  }
  if (c.ownFund) {
    return 'Their own fund: lets one donor write a single cheque far above the legal limit for a candidate, which is then split across several committees. Legal.';
  }
  return 'Shared with other politicians and party committees. Counted here only for what it sent them.';
}

const ROLE_LABEL = {
  campaign: 'Campaign',
  leadership: 'Leadership PAC',
  joint: 'Joint fundraising fund',
};

const usd = n => TaskForceAPI.formatCurrency(Math.round(n || 0));
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const fecCommitteeUrl = (id, cycle) => `https://www.fec.gov/data/committee/${id}/?cycle=${cycle}`;

export default function MoneyTrail({ member }) {
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setDetail(null);
    TaskForceAPI.fetchMemberDetail(member.bioguideId)
      .then(d => {
        if (!cancelled) {
          setDetail(d);
          setState('ready');
        }
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [member.bioguideId]);

  if (state === 'loading') {
    return (
      <div className="mb-6 p-4 rounded-lg border border-gray-200 text-sm text-gray-500">
        Loading where this member&apos;s money comes from…
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return null;
  }

  const trail = detail.moneyTrail;
  if (!trail) {
    return (
      <div className="mb-6 p-4 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-600">
        <span className="font-semibold text-gray-800">Where the money comes from: </span>
        we haven&apos;t mapped this member&apos;s other committees (joint fundraising funds,
        leadership PACs) yet. Our scan reaches every member within about three weeks; until then the
        figures here cover their campaign committee only.
      </div>
    );
  }

  const committees = [...trail.committees].sort((a, b) => b.raised - a.raised);
  const campaignRaised = committees
    .filter(c => c.role === 'campaign')
    .reduce((s, c) => s + c.raised, 0);
  const passedOn = committees
    .filter(c => c.role === 'joint' && c.ownFund)
    .reduce((s, c) => s + (c.passedElsewhere || 0), 0);
  const poolIds = detail.donorPoolCommitteeIds || [];
  const donorsCoverAll = detail.personLevel && poolIds.length > 1;
  const gradeAll = member.gradeBasis === 'all-committees';

  return (
    <div className="mb-6 p-6 rounded-lg border-2 border-slate-300 bg-white">
      <div className="flex items-center space-x-2 mb-2">
        <Landmark className="w-5 h-5 text-slate-700" />
        <h3 className="font-semibold text-slate-900">Where the money comes from</h3>
      </div>

      <p className="text-sm text-gray-800">
        Raised in their name this cycle:{' '}
        <span className="font-bold">{usd(trail.raisedInName)}</span> through{' '}
        <span className="font-bold">{committees.length}</span>{' '}
        {committees.length === 1 ? 'committee' : 'committees'}.
        {committees.length > 1 && (
          <>
            {' '}
            Their campaign committee handles{' '}
            <span className="font-bold">{pct(campaignRaised, trail.raisedInName)}</span> of it.
          </>
        )}
      </p>
      {passedOn > 0 && (
        <p className="text-sm text-gray-800 mt-1">
          <span className="font-bold">{usd(passedOn)}</span> raised through their own joint funds
          was passed on to other committees — still money donors gave to a fund in their name.
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <th className="py-2 pr-3">Committee</th>
              <th className="py-2 pr-3 text-right">Raised</th>
              <th
                className="py-2 pr-3 text-right"
                title="Share of the money that came in cheques of $2,000 or more (FEC size breakdown)"
              >
                $2,000+ cheques
              </th>
              <th className="py-2 text-right">Sent to them</th>
            </tr>
          </thead>
          <tbody>
            {committees.map(c => (
              <tr key={c.committeeId} className="border-b last:border-0 align-top">
                <td className="py-2 pr-3">
                  <a
                    href={fecCommitteeUrl(c.committeeId, trail.cycle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-slate-900 hover:underline inline-flex items-center gap-1"
                  >
                    {c.name}
                    <ExternalLink className="w-3 h-3 text-gray-400" />
                  </a>
                  <div className="text-xs text-gray-500">
                    <span className="font-semibold">{ROLE_LABEL[c.role]}.</span> {describe(c)}
                  </div>
                </td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{usd(c.raised)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">
                  {c.bigCheques === null || c.bigCheques === undefined
                    ? '—'
                    : pct(c.bigCheques, c.raised)}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {c.role === 'joint' ? usd(c.toMember) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail.topDonors?.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold text-slate-900">
            Largest donors{' '}
            {donorsCoverAll ? 'across all their committees' : 'to their campaign committee'}
          </h4>
          <p className="text-xs text-gray-500 mb-2">
            Each person&apos;s gifts added together. Public FEC records.
          </p>
          <ol className="text-sm space-y-1">
            {detail.topDonors.slice(0, 10).map((d, i) => (
              <li key={`${d.name}-${i}`} className="flex justify-between gap-3">
                <span className="text-gray-800">
                  {i + 1}. {d.name}
                  {d.state ? <span className="text-gray-500"> ({d.state})</span> : null}
                </span>
                <span className="font-semibold whitespace-nowrap">{usd(d.amount)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-5 pt-4 border-t text-xs text-gray-600 space-y-1">
        <p>
          <span className="font-semibold">This grade counts </span>
          {gradeAll
            ? 'money from all of these committees.'
            : 'only their campaign committee for now. The donors of their other committees are still being collected; the grade updates when that finishes.'}
        </p>
        <p>
          <span className="font-semibold">How we count: </span>
          money moved between their own committees is counted once. Money a joint fund sent them is
          split by that fund&apos;s own mix of small donors, large donors and PACs. Every committee
          name links to its FEC filings, so you can check any figure yourself.
          {trail.fetchedAt && (
            <> Committee data as of {new Date(trail.fetchedAt).toLocaleDateString()}.</>
          )}
        </p>
      </div>
    </div>
  );
}
