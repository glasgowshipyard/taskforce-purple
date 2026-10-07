// Find your representatives: a ZIP code, or "use my location". Both are
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
  return district ? `${name} district ${district}` : `${name} (one seat for the whole state)`;
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
  submitLabel = 'Show me the receipts',
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
          `We don't have ${z} on file. Some ZIP codes are only for PO boxes or one building. Use your location instead, or pick your state:`
        );
        setPickState(true);
      } else if (parts.length === 1) {
        onFound({ state: parts[0].state, district: parts[0].district });
      } else {
        setStatus(`ZIP ${z} crosses a district line. Which part are you in?`);
        setChoices(parts);
      }
    } catch {
      setStatus("We couldn't load the ZIP code list. Check your connection and try again.");
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
          "That location isn't in a US congressional district. Try a ZIP code, or pick your state:"
        );
        setPickState(true);
      } else if (found.near.length) {
        setStatus("You're right by a district line. Which one is yours?");
        setChoices([found.key, ...found.near].map(parseDistrict));
      } else {
        onFound(parseDistrict(found.key));
      }
    } catch (err) {
      setStatus(
        err?.code === 1
          ? 'Location is turned off for this site. Enter your ZIP code instead.'
          : "We couldn't get your location. Enter your ZIP code instead."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="lookup">
      <form className="lookup-row" onSubmit={byZip} noValidate>
        <div className="lookup-field">
          <label htmlFor={`${idPrefix}-zip`}>YOUR ZIP CODE</label>
          <input
            id={`${idPrefix}-zip`}
            className="zip-input"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="00000"
            value={zip}
            onChange={e => setZip(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-big btn-purple" disabled={busy !== null}>
          {busy === 'zip' ? 'Finding…' : submitLabel}
          <ArrowRight size={22} aria-hidden="true" />
        </button>
        <span className="lookup-alt">
          <span className="lookup-or">or</span>
          <button
            type="button"
            className="btn btn-big btn-outline"
            onClick={byLocation}
            disabled={busy !== null}
          >
            <LocateFixed size={22} aria-hidden="true" />
            {busy === 'location' ? 'Finding you…' : 'Use my location'}
          </button>
        </span>
      </form>
      <p className="lookup-privacy">
        Looked up on your device. Your ZIP code and location are never sent anywhere.
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
                {c.share && c.share < 100 ? ` (${i === 0 ? 'most' : 'some'} of it)` : ''}
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
                Pick your state
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
