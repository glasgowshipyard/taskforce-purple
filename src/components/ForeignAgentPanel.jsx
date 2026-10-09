// Donors linked to registered foreign agents (#60): people personally
// registered with the Justice Department to work for foreign clients, told
// apart from people who only work at a firm that has foreign clients.
import React from 'react';
import { usd } from '../lib/people.js';

const faraUrl = reg =>
  `https://efile.fara.gov/ords/fara/f?p=1381:200:::NO:RP,200:P200_REG_NUMBER:${reg}`;

const titleCase = s =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s,'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function Clients({ firm }) {
  if (!firm.clientCount) {
    return null;
  }
  const governments = (firm.clients || []).filter(c => c.government).length;
  return (
    <p className="pac-list-sub">
      {firm.clientCount === 1 ? 'One foreign client' : `${firm.clientCount} foreign clients`}
      {firm.countries?.length ? `, in ${firm.countries.map(titleCase).join(', ')}` : ''}
      {governments ? `. ${governments} of those shown are governments or government bodies` : ''}.
    </p>
  );
}

export default function ForeignAgentPanel({ member }) {
  const total = member.faraEmployerTotal || 0;
  if (total <= 0) {
    return null;
  }
  const firms = member.faraFirms || [];
  // Members graded before the register was matched: the old, employer-only line
  if (member.faraAgentTotal === null || member.faraAgentTotal === undefined) {
    return (
      <div className="panel">
        <h3>Donors at foreign-agent firms</h3>
        <p style={{ color: 'var(--ink-2)' }}>
          <strong style={{ color: 'var(--ink)' }}>{usd(total)}</strong> came from people who work at
          firms registered with the Justice Department to represent foreign clients. Most of them
          aren&apos;t registered agents themselves.
        </p>
      </div>
    );
  }
  const agents = member.faraAgentTotal || 0;
  const staff = Math.max(0, total - agents);
  const agentFirms = firms.filter(f => f.agentAmount > 0);
  return (
    <div className={`panel${agents > 0 ? ' panel-alert' : ''}`}>
      <h3>Foreign agents</h3>
      {agents > 0 ? (
        <>
          <p style={{ color: 'var(--ink-2)' }}>
            <strong style={{ color: 'var(--ink)' }}>{usd(agents)}</strong> came from people who are
            personally registered with the Justice Department to work for foreign clients.
          </p>
          <ul className="pac-list" style={{ marginTop: 12 }}>
            {agentFirms.map(f => (
              <li key={f.registrationNumber}>
                {(f.agents || []).map(a => (
                  <div className="pac-list-top" key={a.name}>
                    <span className="name">
                      {titleCase(a.name)}
                      <span className="muted"> · {f.name}</span>
                    </span>
                    <span className="leader" aria-hidden="true" />
                    <strong>{usd(a.amount)}</strong>
                  </div>
                ))}
                <Clients firm={f} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ color: 'var(--ink-2)' }}>
          None of these donors is personally registered as a foreign agent.
        </p>
      )}
      {staff > 0 && (
        <>
          <p style={{ color: 'var(--ink-2)', marginTop: 14 }}>
            <strong style={{ color: 'var(--ink)' }}>{usd(staff)}</strong> came from people who work
            at firms that represent foreign clients, but who aren&apos;t registered agents
            themselves. Large law and lobbying firms often have a few foreign clients among many.
          </p>
          <ul className="pac-list" style={{ marginTop: 10 }}>
            {firms.slice(0, 6).map(f => (
              <li key={f.registrationNumber}>
                <div className="pac-list-top">
                  <a
                    className="name"
                    href={faraUrl(f.registrationNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {f.name}
                  </a>
                  <span className="leader" aria-hidden="true" />
                  <strong>{usd(f.amount - (f.agentAmount || 0))}</strong>
                </div>
                <Clients firm={f} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
