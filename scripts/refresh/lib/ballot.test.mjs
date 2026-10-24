import { describe, expect, it } from 'vitest';
import { stateByName } from '../../../src/lib/states.js';
import {
  ballotField,
  matchSeat,
  nameFit,
  people,
  seatChanges,
  seatOf,
  wikiSeats,
} from './ballot.mjs';

const row = (candidateId, name, state, office, district, pcc, party = 'REP') => ({
  candidateId,
  name,
  party,
  year: '2026',
  state,
  office,
  district,
  ici: 'C',
  pcc,
});

describe("who's on November's ballot (2026-10-23)", () => {
  it('fits names in either order, by short forms and initials', () => {
    expect(nameFit('Nick LaLota', 'NICK, LALOTA')).toBe('full');
    expect(nameFit('Dan Sullivan', 'SULLIVAN, DANIEL J')).toBe('full');
    expect(nameFit('Ashley Hinson', 'ARENHOLZ, ASHLEY HINSON')).toBe('full');
    expect(nameFit('Debbie Wasserman Schultz', 'WASSERMAN SCHULTZ, DEBBIE')).toBe('full');
    expect(nameFit('Ro Khanna', 'KHANNA, ROHIT')).toBe('family');
    expect(nameFit('Ro Khanna', 'KHAN, AFZAL')).toBeNull();
  });

  it('tells two people of one name apart by middle initial', () => {
    const seat = people([
      row('S4AK00214', 'SULLIVAN, DAN', 'AK', 'S', '00', 'C00570994'),
      row('S6AK00326', 'SULLIVAN, DANIEL J', 'AK', 'S', '00', 'C00956326'),
    ]);
    const [s, j] = matchSeat([{ name: 'Dan S. Sullivan' }, { name: 'Dan J. Sullivan' }], seat);
    expect(s.person.candidateIds).toEqual(['S4AK00214']);
    expect(j.person.candidateIds).toEqual(['S6AK00326']);
  });

  it('counts one person with two FEC IDs once', () => {
    const seat = people([
      row('H2WI03130', 'COOKE, REBECCA', 'WI', 'H', '03', 'C00844993', 'DEM'),
      row('H4WI03169', 'COOKE, REBECCA', 'WI', 'H', '03', 'C00844993', 'DEM'),
    ]);
    expect(seat).toHaveLength(1);
    const [c] = matchSeat([{ name: 'Rebecca Cooke' }], seat);
    expect(c.person.candidateIds).toEqual(['H2WI03130', 'H4WI03169']);
  });

  it('leaves unclear and unregistered candidates unmatched', () => {
    const seat = people([
      row('H1', 'SMITH, JOHN', 'TX', 'H', '02', 'C1'),
      row('H2', 'SMITH, JANE', 'TX', 'H', '02', 'C2'),
    ]);
    const [smith, nobody] = matchSeat([{ name: 'J. Smith' }, { name: 'Ann Other' }], seat);
    expect(smith).toMatchObject({ person: null, fit: 'ambiguous' });
    expect(nobody).toMatchObject({ person: null, fit: 'none' });
  });

  it("reads Wikipedia's seats and candidates", () => {
    const html = `<h2 id="Alaska">Alaska</h2><table class="wikitable sortable"><tbody>
      <tr><th>District</th><th>Member</th><th>Status</th><th>Candidates</th></tr>
      <tr><th>Alaska&#160;at-large</th><td>Nick Begich III</td><td>Incumbent advanced</td>
      <td><ul><li><span>▌</span><a href="/wiki/x">Nick Begich III</a> (Republican)</li><li><span>▌</span>Bill Hill (Independent)</li></ul></td></tr>
      </tbody></table>`;
    const [s] = wikiSeats(html, 'H');
    expect(s.label).toBe('Alaska at-large');
    expect(s.candidates).toEqual([
      { name: 'Nick Begich III', party: 'Republican' },
      { name: 'Bill Hill', party: 'Independent' },
    ]);
    expect(seatOf('H', s.label, stateByName)).toEqual({ office: 'H', state: 'AK', district: '00' });
    // Class 3 in 2026 (a Class 2 year) is a special election
    expect(seatOf('S', 'Florida(Class 3)', stateByName, 2026)).toEqual({
      office: 'S',
      state: 'FL',
      district: '',
      special: true,
    });
    expect(seatOf('S', 'Alaska', stateByName, 2026)).toMatchObject({ state: 'AK', special: false });
    expect(seatOf('S', 'Arizona(Class 3)', stateByName, 2028)).toMatchObject({ special: false });
    expect(seatOf('H', 'U.S. Virgin Islands at-large', stateByName)?.state).toBe('VI');
  });

  it('flags a filer the list leaves out, and takes hand-checked matches', () => {
    const cn = [
      row('S2TX00106', 'CORNYN, JOHN SEN', 'TX', 'S', '00', 'C00369033'),
      row('S6TX00388', 'PAXTON, WARREN KENNETH JR.', 'TX', 'S', '00', 'C00900001'),
      row('S6FL00863', 'GILESPIE, NEIL JOSEPH', 'FL', 'S', '00', 'C00943399', 'NPA'),
    ];
    const seats = [
      {
        office: 'S',
        state: 'TX',
        district: '',
        candidates: [{ name: 'Ken Paxton', party: 'Republican' }],
      },
      {
        office: 'S',
        state: 'FL',
        district: '',
        candidates: [{ name: 'Neil Gillespie', party: 'Independent' }],
      },
    ];
    const [tx, fl] = ballotField({
      seats,
      cn,
      cycle: 2026,
      filers: new Set(['C00369033', 'C00900001']),
      resolved: { 'S-FL|Neil Gillespie': { candidateId: 'S6FL00863', why: 'spelling' } },
    });
    expect(tx.candidates[0].person.candidateIds).toEqual(['S6TX00388']);
    expect(tx.unlisted.map(p => p.pcc)).toEqual(['C00369033']);
    expect(fl.candidates[0]).toMatchObject({
      fit: 'checked',
      person: { candidateIds: ['S6FL00863'] },
    });
  });

  it('lists what changed on Wikipedia since the checked version', () => {
    const seat = (district, names) => ({
      office: 'H',
      state: 'TX',
      district,
      candidates: names.map(name => ({ name })),
    });
    const before = [seat('23', ['A One', 'B Two']), seat('24', ['C Three'])];
    const after = [seat('23', ['A One', 'Fake Person']), seat('24', ['C Three'])];
    expect(seatChanges(before, after)).toEqual([
      { key: 'H-TX-23', added: ['Fake Person'], removed: ['B Two'] },
    ]);
    expect(seatChanges(before, before)).toEqual([]);
  });
});
