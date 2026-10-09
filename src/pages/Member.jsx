// One person's full receipt: a sitting member, or a candidate on the ballot.
import React, { useMemo, useState } from 'react';
import { ExternalLink, Share2 } from 'lucide-react';
import ForeignAgentPanel from '../components/ForeignAgentPanel.jsx';
import PacPanel from '../components/PacPanel.jsx';
import ShareDialog from '../components/ShareDialog.jsx';
import { Barcode, Evidence, MoneyLines, PowerBar, Skeleton, Stamp } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { classifyOrganization, foreignInterestFor, sectorInfo } from '../lib/donor-taxonomy.js';
import { CYCLE_LABEL } from '../lib/election.js';
import {
  concentrationVerdict,
  explainGrade,
  gradeBands,
  headlineFor,
  rankLine,
} from '../lib/explain.js';
import {
  GRADES,
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
  othersFigures,
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
    return 'Lets a donor write one large check, above the usual limit for a single candidate, which is then split among several committees. This is legal.';
  }
  return 'Shared with other politicians or party committees. We only count the money it passed to this person.';
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
    return `That's more than ${Math.round(below * 100)} out of every 100 members of Congress.`;
  }
  if (below <= 0.4) {
    return "That's less than most members of Congress.";
  }
  return "That's about average for Congress.";
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

// The grade scale, 0 to 100% people-funded, with this person's share from
// people and the share that counts after big donations from a few people are cut
function ScoreScale({ raw, score, shift, tier }) {
  const bands = gradeBands(shift);
  return (
    <figure className="scale">
      <div
        className="scale-track"
        role="img"
        aria-label={`${raw}% of the money came from people and ${score}% counts, which is grade ${tier}`}
      >
        {bands.map(b => (
          <span
            key={b.letter}
            className={`scale-band${b.letter === tier ? ' is-current' : ''}`}
            style={{
              left: `${b.from}%`,
              width: `${b.to - b.from}%`,
              '--g': GRADES[b.letter].color,
            }}
          >
            {b.letter}
          </span>
        ))}
        <span className="scale-raw" style={{ width: `${Math.min(100, raw)}%` }} />
        <span className="scale-score" style={{ width: `${Math.min(100, score)}%` }} />
      </div>
      <div className="scale-ticks" aria-hidden="true">
        {bands
          .filter(b => b.from > 0)
          .map(b => (
            <span key={b.letter} style={{ left: `${b.from}%` }}>
              {b.from}
            </span>
          ))}
      </div>
      <figcaption className="scale-key">
        <span>
          <i className="key-raw" aria-hidden="true" /> Donated by people: ${raw} of every $100
        </span>
        <span>
          <i className="key-score" aria-hidden="true" /> Counts toward the grade: ${score}
        </span>
      </figcaption>
    </figure>
  );
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
        <h1 className="display display-l">We couldn&apos;t find that page</h1>
        <p className="lede" style={{ marginTop: 16 }}>
          The link may be out of date. You can <Link to="/congress">search all of Congress</Link>{' '}
          instead.
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
  // The grade is worked out on the money from others: own money set aside (#59)
  const gradeLines = hasMoney ? moneyLines(othersFigures(f)) : [];
  const ownPct = lines.find(l => l.key === 'own')?.pct ?? 0;
  const conc = unverified
    ? null
    : concentration({
        nakamotoCoefficient: d?.nakamotoCoefficient ?? m.nakamotoCoefficient,
        uniqueDonors: d?.uniqueDonors ?? m.uniqueDonors,
      });
  const trail = d?.moneyTrail;
  const committees = trail ? [...trail.committees].sort((a, b) => b.raised - a.raised) : [];
  const smallPct = gradeLines.find(l => l.key === 'small')?.pct ?? 0;
  const pacPct = gradeLines.find(l => l.key === 'pac')?.pct ?? 0;
  const seat = isCandidate ? `Candidate · ${seatLabel(m)}` : seatLabel(m);
  const title = isCandidate ? 'Candidate' : roleTitle(m);
  const checked = d?.evidence?.checked ?? m.evidenceChecked ?? null;
  const gradedOn = dateText(d?.collectedAt || m.gradedAt);
  const canShare = isLetter(m.tier) && hasMoney;
  // Leads with the number; the non-breaking hyphen keeps "big-donation" on one line
  // Leads with whatever decided the grade, good or bad (#56)
  const lead = hasMoney
    ? headlineFor({ tier: m.tier, lines: gradeLines, grade: d?.grade, conc, name })
    : null;
  const headline = lead?.big ?? `${smallPct}% of the money came from small donations.`;
  const rank = isLetter(m.tier)
    ? rankLine(
        d?.grade?.score ?? m.individualFundingPercent,
        members
          .filter(x => isLetter(x.tier) && Number.isFinite(x.individualFundingPercent))
          .map(x => x.individualFundingPercent)
      )
    : null;
  const standing = hasMoney ? pacStanding(f.pacMoney / f.totalRaised, members) : null;
  const why = hasMoney
    ? explainGrade({ tier: m.tier, lines: gradeLines, grade: d?.grade, conc, name, ownPct })
    : null;
  const verdict = conc ? concentrationVerdict(d?.grade?.detail?.trustAnchorBasis) : null;
  const passedOn = committees
    .filter(c => c.role === 'joint' && c.ownFund)
    .reduce((s, c) => s + (c.passedElsewhere || 0), 0);

  const shareUrl = `${window.location.origin}${isCandidate ? `/candidate/${encodeURIComponent(id)}` : `/member/${encodeURIComponent(id)}`}`;
  const shareText = `${name} gets ${withArticle(g.mark)} (${g.name}) for where their campaign money comes from. ${headline.replace('\u2011', '-')}`;
  const card = {
    id,
    name,
    title: isCandidate
      ? 'Candidate'
      : { Senator: 'Sen.', Representative: 'Rep.', Delegate: 'Del.' }[title] || title,
    tier: m.tier,
    lines,
    total: usdShort(f.totalRaised),
    headline: headline.replace('\u2011', '-'),
    sub: conc?.of ? `Out of ${count(conc.of)} donors named in FEC records.` : '',
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
            {rank && <p className="rank-line">{rank}</p>}
            {ownPct >= 5 && (
              <p className="self-funded">
                <strong>Self-funded.</strong> {name} put {usd(f.ownMoney)} of their own money into
                this campaign: {ownPct}% of everything raised. Candidates can spend as much of their
                own money as they like. We leave it out of the grade, because it doesn&apos;t make
                them depend on anyone.
                {f.ownRepaid > 0 && ` Their campaign has paid ${usd(f.ownRepaid)} back to them.`}
              </p>
            )}
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
              <div className={`headline dark on-dark tone-${lead?.tone ?? 'neutral'}`}>
                <p className="eyebrow">{lead?.eyebrow ?? 'Big donations'}</p>
                <p
                  className="display"
                  style={{ marginTop: 12, fontSize: 'clamp(40px, 6vw, 84px)', lineHeight: 0.9 }}
                >
                  {headline}
                </p>
                {lead?.text && <p className="lede">{lead.text}</p>}
                {conc && lead?.showConc && (
                  <>
                    <ConcentrationBars n={conc.n} of={conc.of} />
                    {verdict && (
                      <p className={`verdict tone-${verdict.tone}`}>
                        <strong>{verdict.label}</strong> {verdict.text}
                      </p>
                    )}
                  </>
                )}
              </div>

              <section aria-labelledby="why-title">
                <h2 id="why-title" className="display display-m" style={{ marginBottom: 8 }}>
                  Why {withArticle(g.mark)}
                </h2>
                {why ? (
                  <>
                    <ScoreScale raw={why.raw} score={why.score} shift={why.shift} tier={m.tier} />
                    <ol className="why-steps">
                      {why.steps.map((step, k) => (
                        <li key={step.title} className={`why-step tone-${step.tone}`}>
                          <span className="why-num" aria-hidden="true">
                            {k + 1}
                          </span>
                          <div>
                            <h3>{step.title}</h3>
                            <p>{step.text}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {standing && pacPct > 0 && (
                      <p className="fine" style={{ marginTop: 12 }}>
                        ${pacPct} of every $100 came from PACs. {standing}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p style={{ marginBottom: 16, color: 'var(--ink-2)' }}>{g.meaning}</p>
                    <div className="facts">
                      <div className="fact">
                        <b>{smallPct}%</b>
                        <p>of the money came from small donors giving under $200.</p>
                      </div>
                      <div className="fact">
                        <b>{pacPct}%</b>
                        <p>came from PACs.{standing ? ` ${standing}` : ''}</p>
                      </div>
                      {conc && (
                        <div className="fact">
                          <b>{count(conc.n)}</b>
                          <p>
                            {conc.n === 1 ? 'donor gave' : 'donors gave'} half of the big-donation
                            money.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>

              <section aria-labelledby="trail-title">
                <h2 id="trail-title" className="display display-m" style={{ marginBottom: 6 }}>
                  Where the money was raised
                </h2>
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
                      Each person&apos;s donations are added up across all the committees above.
                      From public FEC records.
                    </p>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {m.topConduits?.length > 0 && (
                    <div className="panel">
                      <h3>Bundled donations</h3>
                      {m.earmarkedIndividualTotal > 0 && (
                        <p style={{ marginBottom: 12, color: 'var(--ink-2)' }}>
                          <strong style={{ color: 'var(--ink)' }}>
                            {usd(m.earmarkedIndividualTotal)}
                          </strong>{' '}
                          of the donations from individuals came in through organizations that
                          collect donations and pass them on, such as online fundraising platforms.
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
                  <ForeignAgentPanel member={m} />
                </div>
                <PacPanel member={m} name={name} pacMoney={f.pacMoney} />
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
                    <strong>Still being checked.</strong> This grade is based on the FEC&apos;s bulk
                    data files, which contain over 99% of the records. We&apos;re now checking each
                    donation against the FEC&apos;s own records. If anything turns out to be
                    missing, the grade could change slightly.
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
                  <strong>How we count:</strong> Money moved between someone&apos;s own committees
                  is only counted once. Money received from a joint fundraising committee is split
                  into small donations, big donations and PACs in the same proportions as that
                  committee&apos;s own fundraising.{' '}
                  {f.allCommittees
                    ? 'This grade includes all of the committees listed above.'
                    : 'For now, this grade only includes their campaign committee.'}
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
