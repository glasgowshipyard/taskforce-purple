import { describe, expect, it } from 'vitest';
import { stateByName } from '../../../src/lib/states.js';
import { wikiSeats } from './ballot.mjs';
import { applyResults, keepResults, winnerIn } from './results.mjs';

// A results row as Wikipedia gives it once the race is called
const TICK =
  '<span typeof="mw:File"><span><img alt="Green tick" src="x.png" /></span></span><span style="display:none">Y</span>';
const page = rows => `<h2 id="Alabama">Alabama</h2><table class="wikitable sortable"><tbody>
  <tr><th>District</th><th>Member</th><th>Status</th><th>Candidates</th></tr>
  ${rows
    .map(
      ([label, cands]) =>
        `<tr><th>${label}</th><td>x</td><td>Incumbent re-elected</td><td><ul>${cands
          .map(
            ([name, party, won]) =>
              `<li><span>▌</span>${won ? TICK : ''}<b>${name}</b> (${party})</li>`
          )
          .join('')}</ul></td></tr>`
    )
    .join('')}
  </tbody></table>`;

const race = (key, ...names) => ({
  key,
  office: 'H',
  state: 'AL',
  candidates: names.map((name, i) => ({ candidateId: `H6AL0000${i}`, name })),
});

describe('who won', () => {
  it("reads Wikipedia's tick, without the hidden sort letter", () => {
    const [s] = wikiSeats(
      page([
        [
          'Alabama&#160;1',
          [
            ['Jerry Carl', 'Republican', true],
            ['Clyde Jones Jr.', 'Democratic'],
          ],
        ],
      ]),
      'H'
    );
    expect(s.candidates).toEqual([
      { name: 'Jerry Carl', party: 'Republican', won: true },
      { name: 'Clyde Jones Jr.', party: 'Democratic' },
    ]);
  });

  it('matches the winner inside their own race only', () => {
    const r = race('H-AL-02', 'Figures, Shomari', 'Rhett Marques');
    expect(winnerIn(r, 'Shomari Figures').name).toBe('Figures, Shomari');
    expect(winnerIn(r, 'Rhett Marques').name).toBe('Rhett Marques');
    expect(winnerIn(r, 'Someone Else')).toBeNull();
    // Two candidates the name could be: no winner
    expect(winnerIn(race('H-AL-03', 'Smith, John', 'Smith, Jane'), 'J. Smith')).toBeNull();
  });

  it('marks called races, keeps a result the page drops, and replaces a changed one', () => {
    const races = [
      race('H-AL-01', 'Jerry Carl', 'Clyde Jones Jr.'),
      race('H-AL-02', 'Figures, Shomari', 'Rhett Marques'),
      race('H-AL-03', 'Rogers, Mike D.', 'Other Person'),
    ];
    const first = applyResults(
      races,
      [
        {
          office: 'H',
          revid: 1,
          seats: wikiSeats(
            page([
              [
                'Alabama&#160;1',
                [
                  ['Jerry Carl', 'Republican', true],
                  ['Clyde Jones Jr.', 'Democratic'],
                ],
              ],
              [
                'Alabama&#160;2',
                [
                  ['Shomari Figures', 'Democratic', true],
                  ['Rhett Marques', 'Republican'],
                ],
              ],
              [
                'Alabama&#160;3',
                [
                  ['Mike Rogers', 'Republican'],
                  ['Other Person', 'Democratic'],
                ],
              ],
            ]),
            'H'
          ),
        },
      ],
      stateByName,
      2026
    );
    expect(first.marked.map(m => m.key)).toEqual(['H-AL-01', 'H-AL-02']);
    expect(first.races[1].result).toEqual({ winner: 'Shomari Figures', revid: 1 });
    expect(first.races[1].candidates.map(c => Boolean(c.won))).toEqual([true, false]);
    expect(first.races[2].result).toBeUndefined();

    // A later version: Alabama 1's tick gone (mid-edit), Alabama 2's moved
    const later = applyResults(
      first.races,
      [
        {
          office: 'H',
          revid: 2,
          seats: wikiSeats(
            page([
              [
                'Alabama&#160;1',
                [
                  ['Jerry Carl', 'Republican'],
                  ['Clyde Jones Jr.', 'Democratic'],
                ],
              ],
              [
                'Alabama&#160;2',
                [
                  ['Shomari Figures', 'Democratic'],
                  ['Rhett Marques', 'Republican', true],
                ],
              ],
            ]),
            'H'
          ),
        },
      ],
      stateByName,
      2026
    );
    expect(later.marked).toEqual([]);
    expect(later.replaced).toEqual([
      { key: 'H-AL-02', winner: 'Rhett Marques', before: 'Shomari Figures' },
    ]);
    expect(later.races[0].result).toEqual({ winner: 'Jerry Carl', revid: 1 });
    expect(later.races[1].candidates.map(c => Boolean(c.won))).toEqual([false, true]);
  });

  it('reports a tick that fits no candidate, and does not mark it', () => {
    const r = applyResults(
      [race('H-AL-01', 'Jerry Carl', 'Clyde Jones Jr.')],
      [
        {
          office: 'H',
          revid: 1,
          seats: wikiSeats(page([['Alabama&#160;1', [['Nobody Here', 'Independent', true]]]]), 'H'),
        },
      ],
      stateByName,
      2026
    );
    expect(r.unmatched).toEqual([{ key: 'H-AL-01', name: 'Nobody Here' }]);
    expect(r.races[0].result).toBeUndefined();
  });

  it("marks a race from a call read by hand, which wins over Wikipedia's tick", () => {
    const races = [
      race('H-AL-01', 'Jerry Carl', 'Clyde Jones Jr.'),
      race('H-AL-02', 'Figures, Shomari', 'Rhett Marques'),
    ];
    const source = 'https://apnews.com/projects/elections-2026/alabama-us-house-results/#2';
    const r = applyResults(
      races,
      [
        {
          office: 'H',
          revid: 1,
          seats: wikiSeats(
            page([
              [
                'Alabama&#160;1',
                [
                  ['Jerry Carl', 'Republican', true],
                  ['Clyde Jones Jr.', 'Democratic'],
                ],
              ],
            ]),
            'H'
          ),
        },
      ],
      stateByName,
      2026,
      {
        'H-AL-02': { winner: 'Shomari Figures', by: 'AP', source },
        'H-AL-09': { winner: 'Nobody', by: 'AP', source },
      }
    );
    expect(r.races[0].result).toEqual({ winner: 'Jerry Carl', revid: 1 });
    expect(r.races[1].result).toEqual({ winner: 'Shomari Figures', by: 'AP', source });
    expect(r.races[1].candidates[0].won).toBe(true);
    expect(r.unknown).toEqual([{ label: 'H-AL-09', name: 'Nobody' }]);
  });

  it('a rebuilt races list keeps the published results', () => {
    const before = {
      races: [
        {
          ...race('H-AL-01', 'Jerry Carl', 'Clyde Jones Jr.'),
          result: { winner: 'Jerry Carl', revid: 1 },
          candidates: [
            { candidateId: 'H6AL00000', name: 'Jerry Carl', won: true },
            { candidateId: 'H6AL00001', name: 'Clyde Jones Jr.' },
          ],
        },
      ],
    };
    const [kept] = keepResults([race('H-AL-01', 'Jerry Carl', 'Clyde Jones Jr.')], before);
    expect(kept.result).toEqual({ winner: 'Jerry Carl', revid: 1 });
    expect(kept.candidates[0].won).toBe(true);
    // The winner no longer in the race: nothing kept
    const [gone] = keepResults(
      [{ ...race('H-AL-01'), candidates: [{ candidateId: 'H6AL00001', name: 'Clyde Jones Jr.' }] }],
      before
    );
    expect(gone.result).toBeUndefined();
  });
});
