// One person's full receipt: a sitting member, or a candidate on the ballot.
import React, { useMemo, useState } from 'react';
import { ChevronDown, ExternalLink, Share2 } from 'lucide-react';
import FeedbackDialog from '../components/FeedbackDialog.jsx';
import ForeignAgentPanel from '../components/ForeignAgentPanel.jsx';
import PacPanel from '../components/PacPanel.jsx';
import ShareDialog from '../components/ShareDialog.jsx';
import MoneyGraph from '../components/MoneyGraph.jsx';
import {
  Barcode,
  Evidence,
  Flag,
  Section,
  MoneyLines,
  Skeleton,
  Stamp,
} from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { classifyOrganization, sectorInfo } from '../lib/donor-taxonomy.js';
import { CYCLE_LABEL } from '../lib/election.js';
import {
  bigDonorLine,
  explainGrade,
  moneyStrips,
  peopleSentence,
  placementLine,
} from '../lib/explain.js';
import { gradeInfo, isLetter, isRingfenced, withArticle } from '../lib/grades.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { lightHandlers, useLight } from '../lib/light.js';
import {
  displayName,
  gradedFigures,
  moneyLines,
  partyName,
  roleTitle,
  seatLabel,
  stateCode,
  stateName,
  usd,
  usdShort,
} from '../lib/people.js';
import { stateByCode } from '../lib/states.js';
import { peoplePowerInfluence } from '../../workers/tier-calculation.js';
import { Link, racePath } from '../lib/router.js';

const PART_LABEL = { people: 'People', power: 'Power', influence: 'Influence' };

const ROLE = {
  campaign: 'Campaign committee',
  leadership: 'Leadership PAC',
  joint: 'Joint fundraising committee',
};

// What each kind of committee is for, without FEC jargon (#32)
function describe(c) {
  if (c.role === 'campaign') {
    return 'The main committee for their own election campaign.';
  }
  if (c.role === 'leadership') {
    return "A PAC that gives money to other politicians' campaigns, which can earn goodwill and influence.";
  }
  if (c.ownFund) {
    return 'Lets a donor write one large check, above the usual limit for a single candidate, which is then split among several committees. This is legal. It raises money for this person, so everything it raised is part of their money.';
  }
  return "Run mainly for other politicians or a party. The money it passed to this person comes from them, so it's Influence.";
}

const fecCommitteeUrl = (id, cycle) => `https://www.fec.gov/data/committee/${id}/?cycle=${cycle}`;
const dateText = d =>
  d
    ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

// A note reads "C00123456: The FEC's ..."; show the committee's name
// Both figures are the FEC's own, so the grade can be checked and the note
// still stand: say so, so they don't read as contradicting each other
function evidenceNote(note, committees) {
  const [id, ...rest] = note.split(': ');
  const c = committees.find(x => x.committeeId === id);
  const m = /differs from the sum of its own records by (\$[\d,.]+)/.exec(rest.join(': '));
  if (m) {
    return `For ${c ? c.name : id}, the FEC's summary total and the sum of its own individual records differ by ${m[1]}. Both numbers come from the FEC. Every record is checked, so the gap is in the FEC's own figures.`;
  }
  return rest.length ? `${c ? c.name : id}: ${rest.join(': ')}.` : note;
}

// Where the big money came from, by the donors' states (owner and Craig,
// 2026-10-13: donors aren't named). The top four states, then the rest, and
// the member's own state called out. `rows`: [{ state, amount }].
function stateShares(rows, home) {
  const named = (rows || []).filter(r => r.amount > 0);
  const total = named.reduce((t, r) => t + r.amount, 0);
  if (!(total > 0)) {
    return null;
  }
  const share = a => (a / total) * 100;
  const text = a => (share(a) < 1 ? 'under 1%' : `${Math.round(share(a))}%`);
  const known = named.filter(r => stateByCode[r.state]).sort((a, b) => b.amount - a.amount);
  const top = known.slice(0, 4);
  const rest = total - top.reduce((t, r) => t + r.amount, 0);
  const out = top.map(r => ({
    label: stateName(r.state),
    home: r.state === home,
    share: share(r.amount),
    text: text(r.amount),
  }));
  if (rest > 0) {
    out.push({
      label: top.length ? 'Everywhere else' : 'All states',
      home: false,
      share: share(rest),
      text: text(rest),
    });
  }
  const homeAmount = named.find(r => r.state === home)?.amount || 0;
  const homeName = stateByCode[home] ? stateName(home) : null;
  const sentence = homeName
    ? `${homeAmount > 0 ? text(homeAmount).replace(/^under/, 'Under') : 'None'} of the big money came from ${homeName}, their home state.`
    : null;
  return { rows: out, sentence };
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

export default function Member({ id, kind = 'member' }) {
  const isCandidate = kind === 'candidate';
  const list = useAsync(() => api.members(), []);
  const races = useAsync(() => api.races().catch(() => null), []);
  const detail = useAsync(
    () => (isCandidate ? api.candidateDetail(id) : api.memberDetail(id)).catch(() => null),
    [id, kind]
  );
  const [sharing, setSharing] = useState(false);
  const [flagging, setFlagging] = useState(false);
  // The kind of money lit up in the graph and the "Why" steps together: the
  // one under the pointer, else the one whose step is open (the steps are an
  // accordion). Lit strips breathe; nothing else does (owner, 2026-10-17)
  const [hoverKey, setHoverKey] = useLight();
  const [openStep, setOpenStep] = useState(null);
  const litKey = hoverKey || openStep;
  const lit = { key: litKey, breathing: Boolean(litKey) };
  const toggleStep = key => setOpenStep(k => (k === key ? null : key));

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
  // The same title as the pre-built page (scripts/site/pages.mjs), so
  // search engines that run the page see one title
  const titlePeople =
    m && isLetter(m.tier) ? (m.peoplePowerInfluence?.people ?? d?.grade?.score ?? null) : null;
  useTitle(
    name
      ? Number.isFinite(titlePeople)
        ? `Who funds ${name}? ${m.tier}: ${Math.round(titlePeople)}% from people`
        : `Who funds ${name}?`
      : null
  );

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
        <h1 className="display display-l">We couldn&apos;t find that page</h1>
        <p className="lede" style={{ marginTop: 16 }}>
          The link may be out of date. You can <Link to="/congress">search all of Congress</Link>{' '}
          instead.
        </p>
      </div>
    );
  }

  const g = gradeInfo(m.tier, m.withheldReason);
  const f = gradedFigures(m);
  const withheld = isRingfenced(m.tier);
  const hasMoney = f.totalRaised > 0 && !withheld;
  const lines = hasMoney ? moneyLines(f) : [];
  const ownPct = lines.find(l => l.key === 'own')?.pct ?? 0;
  // FINAL-3's working, in dollars (workers/grading.js gradeMemberFinal3)
  const final3 = d?.grade?.detail?.method === 'final-3' ? d.grade.detail : null;
  const ppi = hasMoney ? (m.peoplePowerInfluence ?? peoplePowerInfluence(final3)) : null;
  const score = d?.grade?.score ?? m.individualFundingPercent;
  const trail = d?.moneyTrail;
  const committees = trail ? [...trail.committees].sort((a, b) => b.raised - a.raised) : [];
  const seat = isCandidate ? `Candidate · ${seatLabel(m)}` : seatLabel(m);
  const title = isCandidate ? 'Candidate' : roleTitle(m);
  const checked = d?.evidence?.checked ?? m.evidenceChecked ?? null;
  const gradedOn = dateText(d?.collectedAt || m.gradedAt);
  const canShare = isLetter(m.tier) && hasMoney;
  // One figure for "from people" everywhere on the page: People, the score
  const sentence = hasMoney && isLetter(m.tier) ? peopleSentence(ppi ? ppi.people : score) : null;
  const placement = isLetter(m.tier)
    ? placementLine(
        score,
        members
          .filter(x => isLetter(x.tier) && Number.isFinite(x.individualFundingPercent))
          .map(x => x.individualFundingPercent)
      )
    : null;
  const why = hasMoney ? explainGrade({ tier: m.tier, grade: d?.grade, name }) : null;
  const fewest =
    final3?.reliable && final3.fewestHoldingHalf
      ? bigDonorLine(final3.fewestHoldingHalf, final3.donors, {
          // "just" when the concentration cost People money (some is Power)
          just: (ppi?.power ?? 0) > 0,
        })
      : null;
  const states = hasMoney ? stateShares(d?.bigByState, stateCode(m.state)) : null;
  const passedOn = committees
    .filter(c => c.role === 'joint' && c.ownFund)
    .reduce((s, c) => s + (c.passedElsewhere || 0), 0);

  const shareUrl = `${window.location.origin}${isCandidate ? `/candidate/${encodeURIComponent(id)}` : `/member/${encodeURIComponent(id)}`}`;
  const shareText =
    `${name} gets ${withArticle(g.mark)} (${g.name}) for where their campaign money comes from. ${sentence || ''}`.trim();
  const card = {
    id,
    name,
    title: isCandidate
      ? 'Candidate'
      : { Senator: 'Sen.', Representative: 'Rep.', Delegate: 'Del.' }[title] || title,
    tier: m.tier,
    lines,
    ppi,
    total: usdShort(f.totalRaised),
    headline: sentence || '',
    sub: placement ? `${placement}.` : '',
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
              )}
            </p>
            <h1 className="display display-xl" style={{ fontSize: 'clamp(48px, 8vw, 112px)' }}>
              {name}
            </h1>
            <p className="member-meta">
              {partyName(m.party)} · {seat}
            </p>
          </div>
          <div className="row">
            {canShare && (
              <button type="button" className="btn btn-dark" onClick={() => setSharing(true)}>
                <Share2 size={20} aria-hidden="true" /> Share
              </button>
            )}
            {inRace && (
              <Link to={racePath(inRace.race.key)} className="btn btn-outline">
                Compare the candidates
              </Link>
            )}
          </div>
        </div>

        {!hasMoney ? (
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
                <p className="flag-line">
                  <button type="button" className="link-button" onClick={() => setFlagging(true)}>
                    Something wrong here?
                  </button>
                </p>
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
                      Across {committees.length} committees
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
              <section className="member-summary" aria-label={`Grade ${g.mark}, ${g.name}`}>
                <div className="member-verdict">
                  {sentence && <p className="member-sentence">{sentence}</p>}
                  {placement && <p className="placement">{placement}</p>}
                  <p className="flag-line">
                    <button type="button" className="link-button" onClick={() => setFlagging(true)}>
                      Something wrong with this grade?
                    </button>
                  </p>
                </div>
                {ppi && (
                  <div className="member-graph">
                    <MoneyGraph
                      ppi={ppi}
                      tier={m.tier}
                      showKey
                      strips={why ? moneyStrips(final3) : null}
                      light={lit}
                      onLight={setHoverKey}
                      onPick={key => setOpenStep(key)}
                      showToggle
                    />
                  </div>
                )}
              </section>

              <div className="folds">
                {why && (
                  <Section title={`Why ${withArticle(g.mark)}`}>
                    {/* The summary first, then where each part came from */}
                    {why.steps
                      .filter(step => step.key === 'result')
                      .map(step => (
                        <div key={step.key} className={`why-summary tone-${step.tone}`}>
                          <h3>{step.title}</h3>
                          <p>{step.text}</p>
                        </div>
                      ))}
                    <p className="fold-intro">{why.intro}</p>
                    <ol className="why-steps">
                      {why.steps
                        .filter(step => step.key !== 'result')
                        .map((step, k) => {
                          const isOpen = openStep === step.key;
                          const linked = step.split.length > 0;
                          return (
                            <li
                              key={step.key}
                              className={`why-step tone-${step.tone}${lit.key === step.key ? ' is-lit' : ''}${isOpen ? ' is-open' : ''}`}
                              {...(linked ? lightHandlers(step.key, setHoverKey) : {})}
                            >
                              <h3 className="why-head">
                                <button
                                  type="button"
                                  aria-expanded={isOpen}
                                  aria-controls={`why-${step.key}`}
                                  onClick={() => toggleStep(step.key)}
                                  onFocus={e =>
                                    linked &&
                                    e.currentTarget.matches(':focus-visible') &&
                                    setHoverKey(step.key)
                                  }
                                  onBlur={() => linked && setHoverKey(null)}
                                >
                                  <span className="why-num" aria-hidden="true">
                                    {k + 1}
                                  </span>
                                  <span className="why-title">{step.title}</span>
                                  <ChevronDown
                                    className="why-chevron"
                                    size={20}
                                    aria-hidden="true"
                                  />
                                </button>
                              </h3>
                              <div
                                className="why-panel"
                                id={`why-${step.key}`}
                                inert={isOpen ? undefined : ''}
                              >
                                <div className="why-panel-inner">
                                  {linked && (
                                    <p className="why-split">
                                      {step.split.map(s => (
                                        <span key={s.part} className={`split-chip is-${s.part}`}>
                                          {s.v}% {PART_LABEL[s.part]}
                                        </span>
                                      ))}
                                    </p>
                                  )}
                                  <p>{step.text}</p>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                    </ol>
                    <p className="fine" style={{ marginTop: 14 }}>
                      <Link to="/how">How grades work</Link>
                    </p>
                  </Section>
                )}

                {ownPct >= 5 && (
                  <Section title="Their own money">
                    <p>
                      {name} put {usd(f.ownMoney)} of their own money into this campaign: {ownPct}%
                      of everything raised. Candidates can spend as much of their own money as they
                      like. We leave it out of the grade, because it doesn&apos;t make them depend
                      on anyone.
                      {f.ownRepaid > 0 &&
                        ` Their campaign has paid ${usd(f.ownRepaid)} back to them.`}
                    </p>
                  </Section>
                )}

                {(fewest || states) && (
                  <Section title="Who gave the big money">
                    {fewest && <p className="fold-lead">{fewest}</p>}
                    {states && (
                      <>
                        <p style={{ margin: '14px 0 12px' }}>{states.sentence}</p>
                        <ul className="share-list">
                          {states.rows.map(r => (
                            <li key={r.label} className={r.home ? 'is-home' : undefined}>
                              <span>
                                {r.label}
                                {r.home ? ' (home state)' : ''}
                              </span>
                              <span className="share-bar" aria-hidden="true">
                                <span style={{ width: `${Math.max(1, r.share)}%` }} />
                              </span>
                              <strong>{r.text}</strong>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p className="fine" style={{ marginTop: 12 }}>
                      Big donations are over $200. Each donor is placed by the address on their FEC
                      records. We don&apos;t list donors by name.
                    </p>
                  </Section>
                )}

                <PacPanel member={m} name={name} pacMoney={f.pacMoney} />

                {m.topConduits?.length > 0 && (
                  <Section title="Bundled donations">
                    {m.earmarkedIndividualTotal > 0 && (
                      <p style={{ marginBottom: 12, color: 'var(--ink-2)' }}>
                        <strong style={{ color: 'var(--ink)' }}>
                          {usd(m.earmarkedIndividualTotal)}
                        </strong>{' '}
                        of the donations from individuals came in through organizations that collect
                        donations and pass them on, such as online fundraising platforms.
                      </p>
                    )}
                    <ul className="ranked">
                      {m.topConduits.slice(0, 6).map(c => (
                        <li key={c.name}>
                          <span className="name">
                            {c.name}{' '}
                            {c.country ? (
                              <span className="pac-chip has-flag">
                                <Flag country={c.country} /> Country-focused: {c.country}
                              </span>
                            ) : (
                              <span
                                className="muted"
                                style={{ fontFamily: 'var(--body)', fontSize: 12 }}
                              >
                                · {sectorInfo(classifyOrganization(c.name)).label}
                              </span>
                            )}
                          </span>
                          <span className="leader" aria-hidden="true" />
                          <strong>{usdShort(c.amount)}</strong>
                        </li>
                      ))}
                    </ul>
                    <p className="fine" style={{ marginTop: 12 }}>
                      &ldquo;Country-focused&rdquo; means the group behind it tells the IRS, on its
                      own Form 990, that it exists to advance a particular country&apos;s interests
                      or its relationship with the United States.
                    </p>
                  </Section>
                )}

                <Section title="Where the money was raised">
                  {trail ? (
                    <>
                      <p style={{ marginBottom: 16, color: 'var(--ink-2)' }}>
                        {name} raised {usd(trail.raisedInName)} through{' '}
                        {committees.length === 1
                          ? 'one committee'
                          : `${committees.length} committees`}
                        .
                        {passedOn > 0 &&
                          ` ${usd(passedOn)} of that went through ${name}'s joint fundraising committee and on to other committees.`}{' '}
                        Click a committee to see its filings on the FEC website.
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
                                      aria-label="(opens on fec.gov)"
                                      style={{ display: 'inline', verticalAlign: '-1px' }}
                                    />
                                  </span>
                                  <span className="mono" style={{ fontWeight: 600 }}>
                                    {usd(own)}
                                    {c.role === 'joint' ? ' received' : ''}
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
                      We haven&apos;t matched all of {name}&apos;s committees in the FEC&apos;s
                      records yet, so these figures only cover one committee.
                    </p>
                  )}
                </Section>

                {m.faraEmployerTotal > 0 && (
                  <Section title="Foreign agents">
                    <ForeignAgentPanel member={m} />
                  </Section>
                )}

                <Section title="About these numbers">
                  {checked === false && (
                    <p className="fine">
                      <strong>Still being checked.</strong> This grade is based on the FEC&apos;s
                      bulk data files, which contain over 99% of the records. We&apos;re now
                      checking each donation against the FEC&apos;s own records. If anything turns
                      out to be missing, the grade could change slightly.
                    </p>
                  )}
                  {checked === true && (
                    <p className="fine">
                      <strong>Checked.</strong> Every donation behind this grade matches the
                      FEC&apos;s own records.
                    </p>
                  )}
                  {(d?.evidence?.notes || []).map(n => (
                    <p className="fine" key={n}>
                      <strong>Note:</strong> {evidenceNote(n, committees)}
                    </p>
                  ))}
                  <p className="fine">
                    <strong>Adding it up:</strong> Money moved between someone&apos;s own committees
                    is added only once. Money received from a joint fundraising committee is split
                    into small donations, big donations and PACs in the same proportions as that
                    committee&apos;s own fundraising.{' '}
                    {f.allCommittees
                      ? 'This grade includes all of the committees listed above.'
                      : 'For now, this grade only includes their campaign committee.'}
                  </p>
                </Section>
              </div>
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
              Share {name}&apos;s grade
            </p>
            <button
              type="button"
              className="btn btn-big btn-light"
              onClick={() => setSharing(true)}
            >
              <Share2 size={22} aria-hidden="true" /> Share
            </button>
          </div>
        </section>
      )}

      <FeedbackDialog
        open={flagging}
        onClose={() => setFlagging(false)}
        kind="flag"
        member={{ id, name }}
      />

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
