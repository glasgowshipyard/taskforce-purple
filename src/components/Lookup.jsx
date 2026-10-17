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
import { STATES, stateByCode } from '../lib/states.js';

const prepared = new Map();
async function districtsIn(codes) {
  const all = [];
  for (const code of codes) {
    if (!prepared.has(code)) {
      const file = await geoFiles.state(code);
      prepared.set(code, file ? prepareState(file) : []);
    }
    all.push(...prepared.get(code));
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
 * let the same form sit in the dark hero or on a light page.
 */
export default function Lookup({
  onFound,
  submitLabel = 'Find my representatives',
  idPrefix = 'lookup',
}) {
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(null);
  const [choices, setChoices] = useState(null);
  const [pickState, setPickState] = useState(false);

  const reset = () => {
    setStatus(null);
    setChoices(null);
    setPickState(false);
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
      const parts = parseZipEntry(zips?.[z]);
      if (parts.length === 0) {
        setStatus(
          `ZIP code ${z} wasn't found. Some ZIP codes only cover PO boxes or a single building. You can use your location instead, or choose your state.`
        );
        setPickState(true);
      } else if (parts.length === 1) {
        onFound({ state: parts[0].state, district: parts[0].district });
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
      const found = codes.length ? locate(await districtsIn(codes), lon, lat) : null;
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
        onFound(parseDistrict(found.key));
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
        {pickState && (
          <div className="choices">
            <label className="sr-only" htmlFor={`${idPrefix}-state`}>
              Your state
            </label>
            <select
              id={`${idPrefix}-state`}
              className="state-select"
              defaultValue=""
              onChange={e => e.target.value && onFound({ state: e.target.value, district: null })}
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
