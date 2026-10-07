// One person's full receipt: a sitting member, or a candidate on the ballot.
import React, { useMemo, useState } from 'react';
import { ExternalLink, Share2 } from 'lucide-react';
import ShareDialog from '../components/ShareDialog.jsx';
import { Barcode, Evidence, MoneyLines, PowerBar, Skeleton, Stamp } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { classifyOrganization, foreignInterestFor, sectorInfo } from '../lib/donor-taxonomy.js';
import { CYCLE_LABEL } from '../lib/election.js';
import {
  gradeInfo,
  isIdentityUnverified,
  isLetter,
  isRingfenced,
  withArticle,
} from '../lib/grades.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import {
  concentration,
  count,
  displayName,
  gradedFigures,
  moneyLines,
  partyName,
  roleTitle,
  seatLabel,
  stateName,
  usd,
  usdShort,
} from '../lib/people.js';
import { Link, racePath } from '../lib/router.js';

const ROLE = {
  campaign: 'Campaign',
  leadership: 'Leadership PAC',
  joint: 'Joint fund',
};

// What each kind of committee is for, without FEC jargon (#32)
function describe(c) {
  if (c.role === 'campaign') {
    return 'Pays for running for the seat.';
  }
  if (c.role === 'leadership') {
    return "Money handed on to other politicians' campaigns, which builds loyalty and influence.";
  }
  if (c.ownFund) {
    return 'Lets one donor write a single check far above the limit for a candidate, which is then split across several committees. Legal.';
  }
  return 'Shared with other politicians and party committees. Counted here only for what it sent this person.';
}

const fecCommitteeUrl = (id, cycle) => `https://www.fec.gov/data/committee/${id}/?cycle=${cycle}`;
const faraUrl = reg =>
  `https://efile.fara.gov/ords/fara/f?p=1381:200:::NO:RP,200:P200_REG_NUMBER:${reg}`;
const dateText = d =>
  d
    ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

// A note reads "C00123456: The FEC's ..."; show the committee's name
function evidenceNote(note, committees) {
  const [id, ...rest] = note.split(': ');
  const c = committees.find(x => x.committeeId === id);
  return rest.length ? `${c ? c.name : id}: ${rest.join(': ')}.` : note;
}

// How this PAC share compares with the rest of Congress
function pacStanding(share, members) {
  const shares = members
    .filter(m => isLetter(m.tier))
    .map(m => gradedFigures(m))
    .filter(f => f.totalRaised > 0)
    .map(f => f.pacMoney / f.totalRaised);
  if (shares.length < 50) {
    return null;
  }
  const below = shares.filter(s => s < share).length / shares.length;
  if (below >= 0.6) {
    return `more than ${Math.round(below * 100)}% of Congress`;
  }
  if (below <= 0.4) {
    return 'less than most of Congress';
  }
  return 'about the middle of Congress';
}

function topPacs(contributions = []) {
  const byName = new Map();
  for (const p of contributions) {
    const name = p.pacName || 'Unnamed committee';
    byName.set(name, (byName.get(name) || 0) + (p.amount || 0));
  }
  return [...byName]
    .map(([name, amount]) => ({ name, amount }))
    .filter(p => p.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
}

// A candidate in races:list, in the shape the page reads for a member
function candidateRecord(c) {
  return {
    bioguideId: c.candidateId,
    name: c.name,
    party: c.party,
    state: stateName(c.state),
    district: c.office === 'H' ? Number(c.district) : null,
    chamber: c.office === 'S' ? 'Senate' : 'House',
    tier: c.tier,
    evidenceChecked: c.evidenceChecked,
    totalRaised: c.totalRaised,
    grassrootsDonations: c.smallDonors,
    largeDonorDonations: c.largeDonors,
    pacMoney: c.pac,
    nakamotoCoefficient: c.nakamoto,
    uniqueDonors: c.uniqueDonors,
  };
}

function findRace(races, pred) {
  for (const r of races?.races || []) {
    const c = r.candidates.find(pred);
    if (c) {
      return { race: r, candidate: c };
    }
  }
  return null;
}

function ConcentrationBars({ n, of }) {
  const many = of ? Math.max(0, of - n) : null;
  return (
    <>
      <div
        className="conc"
        role="img"
        aria-label={`Half the money: ${count(n)} donors.${many !== null ? ` The other half: ${count(many)} donors.` : ''}`}
      >
        <div className="conc-few">
          {n <= 80 ? (
            Array.from({ length: n }, (_, i) => <span key={i} />)
          ) : (
            <span
              style={{
                background:
                  'repeating-linear-gradient(90deg, var(--gold) 0 2px, transparent 2px 4px)',
              }}
            />
          )}
        </div>
        <div className="conc-many" />
      </div>
      <div className="conc-key">
        <span>
          {count(n)} {n === 1 ? 'donor' : 'donors'} · half the money
        </span>
        {many !== null && <span>{count(many)} donors · the other half</span>}
      </div>
    </>
  );
}

export default function Member({ id, kind = 'member' }) {
  const isCandidate = kind === 'candidate';
  const list = useAsync(() => api.members(), []);
  const races = useAsync(() => api.races().catch(() => null), []);
  const detail = useAsync(
    () => (isCandidate ? api.candidateDetail(id) : api.memberDetail(id)).catch(() => null),
    [id, kind]
  );
  const [sharing, setSharing] = useState(false);

  const members = list.data?.members || [];
  const inRace = useMemo(
    () => findRace(races.data, c => (isCandidate ? c.candidateId === id : c.bioguideId === id)),
    [races.data, id, isCandidate]
  );
  const base = isCandidate
    ? inRace && candidateRecord(inRace.candidate)
    : members.find(m => m.bioguideId === id);
  const d = detail.data;
  const m = base || d?.member ? { ...(base || {}), ...(d?.member || {}) } : null;
  if (m && isCandidate) {
    // The detail's record carries FEC codes; the page reads words
    m.state = m.state?.length === 2 ? stateName(m.state) : m.state;
    m.chamber = m.chamber || (inRace?.race.office === 'S' ? 'Senate' : 'House');
  }

  const name = m ? displayName(m.name) : '';
  useTitle(name || null);

  const loading = !m && (list.loading || detail.loading || (isCandidate && races.loading));
  if (loading) {
    return (
      <div className="wrap section">
        <Skeleton height={20} width={260} />
        <Skeleton height={80} width="60%" style={{ marginTop: 16 }} />
        <Skeleton height={420} style={{ marginTop: 32 }} />
      </div>
    );
  }
  if (!m) {
    return (
      <div className="wrap section">
        <h1 className="display display-l">We can&apos;t find that receipt</h1>
        <p className="lede" style={{ marginTop: 16 }}>
          The link may be old. <Link to="/congress">Look them up in all of Congress</Link>.
        </p>
      </div>
    );
  }

  const g = gradeInfo(m.tier);
  const f = gradedFigures(m);
  const unverified = isIdentityUnverified(m.tier);
  const withheld = isRingfenced(m.tier);
  const hasMoney = f.totalRaised > 0 && !withheld;
  const lines = hasMoney ? moneyLines(f) : [];
  const conc = unverified
    ? null
    : concentration({
        nakamotoCoefficient: d?.nakamotoCoefficient ?? m.nakamotoCoefficient,
        uniqueDonors: d?.uniqueDonors ?? m.uniqueDonors,
      });
  const trail = d?.moneyTrail;
  const committees = trail ? [...trail.committees].sort((a, b) => b.raised - a.raised) : [];
  const smallPct = lines.find(l => l.key === 'small')?.pct ?? 0;
  const pacPct = lines.find(l => l.key === 'pac')?.pct ?? 0;
  const seat = isCandidate ? `Candidate · ${seatLabel(m)}` : seatLabel(m);
  const title = isCandidate ? 'Candidate' : roleTitle(m);
  const checked = d?.evidence?.checked ?? m.evidenceChecked ?? null;
  const gradedOn = dateText(d?.collectedAt || m.gradedAt);
  const canShare = isLetter(m.tier) && hasMoney;
  const headline = conc
    ? `${count(conc.n)} ${conc.n === 1 ? 'person' : 'people'} gave half the big-check money.`
    : `${smallPct}% came from small donors.`;
  const standing = hasMoney ? pacStanding(f.pacMoney / f.totalRaised, members) : null;
  const passedOn = committees
    .filter(c => c.role === 'joint' && c.ownFund)
    .reduce((s, c) => s + (c.passedElsewhere || 0), 0);

  const shareUrl = `${window.location.origin}${isCandidate ? `/candidate/${encodeURIComponent(id)}` : `/member/${encodeURIComponent(id)}`}`;
  const shareText = `${name}'s campaign money, graded ${g.mark}: ${g.name}. ${headline}`;
  const card = {
    id,
    name,
    title: isCandidate
      ? 'Candidate'
      : { Senator: 'Sen.', Representative: 'Rep.', Delegate: 'Del.' }[title] || title,
    tier: m.tier,
    lines,
    total: usdShort(f.totalRaised),
    headline: conc
      ? `${count(conc.n)} ${conc.n === 1 ? 'person' : 'people'} gave half the big money.`
      : `${smallPct}% from small donors.`,
    sub: conc?.of
      ? `Out of ${count(conc.of)} donors the FEC lists by name. Who pays yours?`
      : 'Who pays yours?',
    host: window.location.host,
    cycleLabel: CYCLE_LABEL,
  };

  return (
    <>
      <div className="wrap">
        <div className="member-head">
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow crumbs" style={{ marginBottom: 12 }}>
              {isCandidate ? (
                <Link to="/ballot">Your ballot</Link>
              ) : (
                <Link to="/congress">All of Congress</Link>
              )}{' '}
              / {seat} · {partyName(m.party)}
            </p>
            <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 8vw, 112px)' }}>
              {name}
            </h1>
          </div>
          <div className="row">
            {canShare && (
              <button type="button" className="btn btn-dark" onClick={() => setSharing(true)}>
                <Share2 size={20} aria-hidden="true" /> Share this receipt
              </button>
            )}
            {inRace && (
              <Link to={racePath(inRace.race.key)} className="btn btn-outline">
                Compare the race
              </Link>
            )}
          </div>
        </div>

        {unverified || !hasMoney ? (
          <div className="member-layout">
            <div
              className="panel"
              style={{
                display: 'flex',
                gap: 24,
                alignItems: 'center',
                flexWrap: 'wrap',
                maxWidth: 820,
              }}
            >
              <Stamp tier={m.tier} size={110} />
              <div style={{ flex: '1 1 300px' }}>
                <h2 style={{ fontSize: 22, marginBottom: 8 }}>{g.name}</h2>
                <p>{g.meaning}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="member-layout">
            <div className="member-slip-col">
              <div className="slip print-in">
                <p className="slip-title">TASK FORCE PURPLE</p>
                <p className="slip-sub">RECEIPT · {CYCLE_LABEL} ELECTION CYCLE</p>
                <p className="small muted slip-to">
                  Paid to: {name}, {seatLabel(m)}
                  {committees.length > 1 && (
                    <>
                      <br />
                      Through {committees.length} committees
                    </>
                  )}
                </p>
                <div className="tear" style={{ marginTop: 18 }} />
                <MoneyLines lines={lines} value={l => usd(l.amount)} />
                <div className="tear" style={{ marginTop: 6 }} />
                <p className="slip-total">
                  <span>TOTAL</span>
                  <span>{usd(f.totalRaised)}</span>
                </p>
                <div style={{ marginTop: 18 }}>
                  <PowerBar lines={lines} height={18} />
                </div>
                <p style={{ marginTop: 22 }}>
                  <Evidence checked={checked} long />
                </p>
                {gradedOn && (
                  <p className="fine" style={{ marginTop: 8 }}>
                    Graded {gradedOn}
                  </p>
                )}
                <Barcode id={id} />
              </div>
              <div className="slip-stamp">
                <Stamp tier={m.tier} size={124} rot={-11} animate delay={0.45} />
              </div>
            </div>

            <div className="member-main">
              <div className="headline dark on-dark">
                <p className="eyebrow">The headline</p>
                <p
                  className="display"
                  style={{ marginTop: 12, fontSize: 'clamp(40px, 6vw, 84px)', lineHeight: 0.9 }}
                >
                  {headline}
                </p>
                {conc && (
                  <>
                    <p className="lede">
                      {conc.of
                        ? `${name} has ${count(conc.of)} donors the FEC lists by name (it names anyone giving over $200). ${conc.n === 1 ? 'One of them' : `${count(conc.n)} of them`} supplied half of that money. The other ${count(conc.of - conc.n)} supplied the rest.`
                        : `Half of the big-check money came from ${count(conc.n)} donors.`}
                    </p>
                    <ConcentrationBars n={conc.n} of={conc.of} />
                  </>
                )}
              </div>

              <section aria-labelledby="why-title">
                <h2 id="why-title" className="display display-m" style={{ marginBottom: 8 }}>
                  Why {withArticle(g.mark)}
                </h2>
                <p style={{ marginBottom: 16, color: 'var(--ink-2)' }}>{g.meaning}</p>
                <div className="facts">
                  <div className="fact">
                    <b>{smallPct}%</b>
                    <p>from small donors giving under $200.</p>
                  </div>
                  <div className="fact">
                    <b>{pacPct}%</b>
                    <p>from PACs{standing ? `, ${standing}` : ''}.</p>
                  </div>
                  {conc && (
                    <div className="fact">
                      <b>{count(conc.n)}</b>
                      <p>
                        {conc.n === 1 ? 'person holds' : 'people hold'} half the big-check money.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <section aria-labelledby="trail-title">
                <h2 id="trail-title" className="display display-m" style={{ marginBottom: 6 }}>
                  Follow the money
                </h2>
                {trail ? (
                  <>
                    <p style={{ marginBottom: 16, color: 'var(--ink-2)' }}>
                      Everything raised in {name}&apos;s name: {usd(trail.raisedInName)} through{' '}
                      {committees.length} {committees.length === 1 ? 'committee' : 'committees'}.
                      {passedOn > 0 &&
                        ` ${usd(passedOn)} of it went through their own joint funds on to other committees.`}{' '}
                      Each one links to its FEC filings.
                    </p>
                    <ul className="trail">
                      {committees.map(c => {
                        const own = c.role === 'joint' ? c.toMember || 0 : c.raised;
                        return (
                          <li key={c.committeeId}>
                            <a
                              href={fecCommitteeUrl(c.committeeId, trail.cycle)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span className="trail-top">
                                <span style={{ fontWeight: 700 }}>
                                  {c.name}{' '}
                                  <ExternalLink
                                    size={14}
                                    aria-label="(opens the FEC's page)"
                                    style={{ display: 'inline', verticalAlign: '-1px' }}
                                  />
                                </span>
                                <span className="mono" style={{ fontWeight: 600 }}>
                                  {usd(own)}
                                  {c.role === 'joint' ? ' to them' : ''}
                                </span>
                              </span>
                              <span
                                className="small muted"
                                style={{ display: 'block', marginTop: 4 }}
                              >
                                <strong>{ROLE[c.role] || 'Committee'}.</strong> {describe(c)}
                              </span>
                              <span className="trail-bar" aria-hidden="true">
                                <span
                                  style={{
                                    width: `${Math.max(1, Math.round((own / (trail.raisedInName || 1)) * 100))}%`,
                                  }}
                                />
                              </span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : (
                  <p className="notice">
                    We couldn&apos;t map all of {name}&apos;s committees in the FEC&apos;s records
                    yet, so these figures cover one committee only.
                  </p>
                )}
              </section>

              <div className="panels">
                {d?.topDonors?.length > 0 && (
                  <div className="panel">
                    <h3>Biggest donors</h3>
                    <ol className="ranked">
                      {d.topDonors.slice(0, 10).map((p, i) => (
                        <li key={`${p.name}-${i}`}>
                          <span className="muted">{i + 1}.</span>
                          <span className="name">
                            {p.name}
                            {p.state ? ` (${p.state})` : ''}
                          </span>
                          <span className="leader" aria-hidden="true" />
                          <strong>{usd(p.amount)}</strong>
                        </li>
                      ))}
                    </ol>
                    <p className="fine" style={{ marginTop: 12 }}>
                      Each person&apos;s gifts added up across every committee above. Public FEC
                      records.
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {m.topConduits?.length > 0 && (
                    <div className="panel">
                      <h3>Who bundled it</h3>
                      {m.earmarkedIndividualTotal > 0 && (
                        <p style={{ marginBottom: 12, color: 'var(--ink-2)' }}>
                          <strong style={{ color: 'var(--ink)' }}>
                            {usd(m.earmarkedIndividualTotal)}
                          </strong>{' '}
                          of the money from people arrived in bundles: organizations collected it
                          and passed it on.
                        </p>
                      )}
                      <ul className="ranked">
                        {m.topConduits.slice(0, 6).map(c => {
                          const foreign = foreignInterestFor(c.name);
                          return (
                            <li key={c.name}>
                              <span className="name">
                                {c.name}
                                <span
                                  className="muted"
                                  style={{ fontFamily: 'var(--body)', fontSize: 12 }}
                                >
                                  {' '}
                                  ·{' '}
                                  {foreign
                                    ? `${foreign.country} interest`
                                    : sectorInfo(classifyOrganization(c.name)).label}
                                </span>
                              </span>
                              <span className="leader" aria-hidden="true" />
                              <strong>{usdShort(c.amount)}</strong>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {m.faraEmployerTotal > 0 && (
                    <div className="panel panel-alert">
                      <h3>Foreign-agent connected</h3>
                      <p style={{ color: 'var(--ink-2)' }}>
                        <strong style={{ color: 'var(--ink)' }}>{usd(m.faraEmployerTotal)}</strong>{' '}
                        from people who work at firms registered with the Justice Department as
                        agents of foreign governments or interests. Legal, disclosed, and now
                        visible.
                      </p>
                      {m.faraFirms?.length > 0 && (
                        <ul className="ranked" style={{ marginTop: 12 }}>
                          {m.faraFirms.slice(0, 6).map(firm => (
                            <li key={firm.registrationNumber}>
                              <a
                                className="name"
                                href={faraUrl(firm.registrationNumber)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {firm.name}
                              </a>
                              <span className="leader" aria-hidden="true" />
                              <strong>{usd(firm.amount)}</strong>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                {m.pacContributions?.length > 0 && (
                  <div className="panel">
                    <h3>Biggest PACs</h3>
                    <ol className="ranked">
                      {topPacs(m.pacContributions).map((p, i) => (
                        <li key={p.name}>
                          <span className="muted">{i + 1}.</span>
                          <span className="name">{p.name}</span>
                          <span className="leader" aria-hidden="true" />
                          <strong>{usd(p.amount)}</strong>
                        </li>
                      ))}
                    </ol>
                    <p className="fine" style={{ marginTop: 12 }}>
                      Super PAC, leadership PAC and lobbyist money weighs more against the grade.
                    </p>
                  </div>
                )}
              </div>

              <section
                className="panel"
                aria-labelledby="about-title"
                style={{ background: 'transparent' }}
              >
                <h2 id="about-title" style={{ fontSize: 18, marginBottom: 8 }}>
                  About these numbers
                </h2>
                {checked === false && (
                  <p className="fine">
                    <strong>Being double-checked.</strong> This grade comes from the FEC&apos;s bulk
                    download, which holds over 99% of the records. We&apos;re checking every record
                    against the FEC&apos;s own; if anything was missing, the grade may shift a
                    little.
                  </p>
                )}
                {checked === true && (
                  <p className="fine">
                    <strong>Checked.</strong> Every record behind this grade matches the FEC&apos;s
                    own.
                  </p>
                )}
                {(d?.evidence?.notes || []).map(n => (
                  <p className="fine" key={n}>
                    <strong>Note:</strong> {evidenceNote(n, committees)}
                  </p>
                ))}
                <p className="fine">
                  <strong>How we count:</strong> money moved between someone&apos;s own committees
                  is counted once. Money a joint fund sent them is split by that fund&apos;s own mix
                  of small donors, big checks and PACs.{' '}
                  {f.allCommittees
                    ? 'This grade counts every committee above.'
                    : 'This grade counts their campaign committee only, for now.'}
                </p>
              </section>
            </div>
          </div>
        )}
      </div>

      {canShare && (
        <section className="share-band band on-dark">
          <div className="wrap">
            <p
              className="display display-l"
              style={{ flex: '1 1 480px', fontSize: 'clamp(32px, 4vw, 52px)' }}
            >
              Your neighbors don&apos;t know this yet.
            </p>
            <button
              type="button"
              className="btn btn-big btn-light"
              onClick={() => setSharing(true)}
            >
              <Share2 size={22} aria-hidden="true" /> Share this receipt
            </button>
          </div>
        </section>
      )}

      {canShare && (
        <ShareDialog
          open={sharing}
          onClose={() => setSharing(false)}
          card={card}
          url={shareUrl}
          text={shareText}
          filename={`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-grade.png`}
        />
      )}
    </>
  );
}
