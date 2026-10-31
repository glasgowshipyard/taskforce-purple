// Find your representatives: a ZIP code, or the location button inside the
// same box. Both are
// looked up in the browser against the Census Bureau's district files
// (src/lib/geo.js); neither is sent anywhere or remembered.
import React, { useState } from 'react';
import { ArrowRight, LocateFixed } from 'lucide-react';
import { geoFiles } from '../lib/api.js';
import {
  candidateStates,
  locate,
  normalizeZip,
  parseDistrict,
  parseZipEntry,
  prepareState,
} from '../lib/geo.js';
import { REDRAWN_2026 } from '../lib/redistricting.js';
import { STATES, stateByCode } from '../lib/states.js';

const prepared = new Map();
// `ballot`: a state whose lines changed for 2026 has its 2026 outlines
async function districtsIn(codes, ballot = false) {
  const all = [];
  for (const code of codes) {
    const lines2026 = ballot && Boolean(REDRAWN_2026[code]);
    const key = lines2026 ? `${code}@2026` : code;
    if (!prepared.has(key)) {
      const file = await (lines2026 ? geoFiles.state2026(code) : geoFiles.state(code));
      prepared.set(key, file ? prepareState(file) : []);
    }
    all.push(...prepared.get(key));
  }
  return all;
}

function districtName({ state, district }) {
  const name = stateByCode[state]?.name || state;
  return district ? `${name} district ${district}` : `${name} (one district for the whole state)`;
}

function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 10 * 60 * 1000,
    });
  });
}

/**
 * onFound({ state, district }) once we know where. `submitLabel` and `dark`
 * let the same form sit in the dark hero or on a light page. `ballot`: for
 * the 2026 races, where a state whose lines changed for this election
 * (lib/redistricting.js) can't be looked up from the older district files,
 * so the visitor finds their district on the state's own lookup and picks it.
 */
export default function Lookup({
  onFound,
  submitLabel = 'Find my representatives',
  idPrefix = 'lookup',
  ballot = false,
}) {
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);
  const [choices, setChoices] = useState(null);
  const [pickState, setPickState] = useState(false);
  const [redrawnState, setRedrawnState] = useState(null);

  const reset = () => {
    setStatus(null);
    setChoices(null);
    setPickState(false);
    setRedrawnState(null);
  };

  // A place found: unless this is for the races, its state's lines changed
  // for 2026 and it was found on the older lines (no 2026 match), where the
  // visitor picks their new district instead
  const arrive = (place, { lines2026 = false } = {}) => {
    if (ballot && REDRAWN_2026[place.state] && !lines2026) {
      reset();
      setRedrawnState(place.state);
      return;
    }
    onFound(place);
  };

  const byZip = async e => {
    e.preventDefault();
    reset();
    const z = normalizeZip(zip);
    if (!z) {
      setStatus('Enter a 5-digit ZIP code.');
      return;
    }
    setBusy('zip');
    try {
      const zips = await geoFiles.zips();
      let parts = parseZipEntry(zips?.[z]);
      // For the races, a ZIP code in a state whose lines changed: its 2026
      // districts (scripts/geo/build-geo-2026.mjs)
      let lines2026 = false;
      if (ballot && (parts.length === 0 || REDRAWN_2026[parts[0].state])) {
        const next = parseZipEntry((await geoFiles.zips2026())?.[z]);
        if (next.length) {
          parts = next;
          lines2026 = true;
        }
      }
      if (parts.length === 0) {
        setStatus(
          `ZIP code ${z} wasn't found. Some ZIP codes only cover PO boxes or a single building. You can use your location instead, or choose your state.`
        );
        setPickState(true);
      } else if (parts.length === 1) {
        arrive({ state: parts[0].state, district: parts[0].district }, { lines2026 });
      } else if (ballot && REDRAWN_2026[parts[0].state] && !lines2026) {
        arrive({ state: parts[0].state, district: null });
      } else {
        setStatus(
          `ZIP code ${z} is split between ${parts.length} congressional districts. Which one do you live in?`
        );
        setChoices(parts);
      }
    } catch {
      setStatus("The ZIP code list didn't load. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const byLocation = async () => {
    reset();
    setBusy('location');
    try {
      const pos = await position();
      const { longitude: lon, latitude: lat } = pos.coords;
      const index = await geoFiles.index();
      const codes = candidateStates(index, lon, lat);
      const found = codes.length ? locate(await districtsIn(codes, ballot), lon, lat) : null;
      if (!found) {
        setStatus(
          "That location isn't in a U.S. congressional district. You can enter a ZIP code or choose your state instead."
        );
        setPickState(true);
      } else if (found.near.length) {
        setStatus(
          "You're close to a district boundary, so it isn't clear which district you're in. Which one is yours?"
        );
        setChoices([found.key, ...found.near].map(parseDistrict));
      } else {
        arrive(parseDistrict(found.key), { lines2026: ballot });
      }
    } catch (err) {
      setStatus(
        err?.code === 1
          ? "Your browser didn't share your location. You can enter your ZIP code instead."
          : "Your location couldn't be found. You can enter your ZIP code instead."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="lookup">
      {/* One box (owner, 2026-10-16): the ZIP code, a location button inside
          it, and the button that finds them attached at the end */}
      <form className="lookup-form" onSubmit={byZip} noValidate>
        <label className="lookup-label" htmlFor={`${idPrefix}-zip`}>
          YOUR ZIP CODE
        </label>
        <div className="lookup-box">
          <input
            id={`${idPrefix}-zip`}
            className="zip-input"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="ZIP code"
            value={zip}
            onChange={e => setZip(e.target.value)}
          />
          <button
            type="button"
            className={`lookup-locate${busy === 'location' ? ' is-busy' : ''}`}
            onClick={byLocation}
            disabled={busy !== null}
            aria-label={busy === 'location' ? 'Finding you…' : 'Use my location'}
            title="Use my location"
          >
            <LocateFixed size={24} aria-hidden="true" />
          </button>
          <button
            type="submit"
            className="lookup-go"
            disabled={busy !== null}
            aria-label={busy === 'zip' ? 'Finding…' : submitLabel}
          >
            <span className="lookup-go-text" aria-hidden="true">
              {busy === 'zip' ? 'Finding…' : submitLabel}
            </span>
            <ArrowRight size={24} aria-hidden="true" />
          </button>
        </div>
      </form>
      <p className="lookup-privacy">
        Your district is looked up on your own device. Your ZIP code and location aren&apos;t sent
        anywhere.
      </p>

      <div className="lookup-status" role="status" aria-live="polite">
        {status && <p>{status}</p>}
        {choices && (
          <div className="choices">
            {choices.map((c, i) => (
              <button
                type="button"
                key={c.key}
                className="choice"
                onClick={() => onFound({ state: c.state, district: c.district })}
              >
                {districtName(c)}
                {c.share && c.share < 100 ? ` (${i === 0 ? 'most' : 'part'} of the ZIP code)` : ''}
              </button>
            ))}
          </div>
        )}
        {redrawnState && (
          <RedrawnPick
            state={redrawnState}
            idPrefix={idPrefix}
            onPick={district => onFound({ state: redrawnState, district })}
          />
        )}
        {pickState && (
          <div className="choices">
            <label className="sr-only" htmlFor={`${idPrefix}-state`}>
              Your state
            </label>
            <select
              id={`${idPrefix}-state`}
              className="state-select"
              defaultValue=""
              onChange={e => e.target.value && arrive({ state: e.target.value, district: null })}
            >
              <option value="" disabled>
                Choose your state
              </option>
              {[...STATES]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(s => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// A state whose lines changed for 2026: its official lookup, then its districts
function RedrawnPick({ state, idPrefix, onPick }) {
  const name = stateByCode[state]?.name || state;
  const { districts, lookup } = REDRAWN_2026[state];
  return (
    <>
      <p>
        {name}&apos;s district lines changed for this election, and this site couldn&apos;t find
        your new district from that. Find it with{' '}
        <a href={lookup} target="_blank" rel="noopener noreferrer">
          {name}&apos;s official voter lookup
        </a>
        , then choose it here.
      </p>
      <div className="choices">
        <label className="sr-only" htmlFor={`${idPrefix}-district`}>
          Your district
        </label>
        <select
          id={`${idPrefix}-district`}
          className="state-select"
          defaultValue=""
          onChange={e => e.target.value && onPick(Number(e.target.value))}
        >
          <option value="" disabled>
            Choose your district
          </option>
          {Array.from({ length: districts }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {name} district {i + 1}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
