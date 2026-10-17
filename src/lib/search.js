// Searching the members list the way people type (an outside review,
// 2026-10-17: "Bernie Sanders" and "NM" found nobody). Every word typed has
// to match something about the member: the start of a word in their name,
// their initials ("AOC"), a common short form of their first name
// ("Bernie" for Bernard), their state's name or postal code, or their party.
// Accents and punctuation don't matter.
import { stateByName } from './states.js';
import { displayName, partyName } from './people.js';

// Official first name -> the short forms people use. Only well-known ones:
// a name that isn't here still matches by its first letters ("Bern")
const SHORT_FORMS = {
  abigail: ['abby'],
  albert: ['al'],
  alexander: ['alex'],
  alexandria: ['alex'],
  andrew: ['andy', 'drew'],
  anthony: ['tony'],
  barbara: ['barb'],
  benjamin: ['ben'],
  bernard: ['bernie'],
  catherine: ['cathy', 'kate', 'katie'],
  charles: ['chuck', 'charlie'],
  christopher: ['chris'],
  cynthia: ['cindy'],
  daniel: ['dan', 'danny'],
  deborah: ['debbie', 'deb'],
  donald: ['don'],
  douglas: ['doug'],
  edward: ['ed', 'eddie', 'ted'],
  elizabeth: ['liz', 'beth'],
  frederick: ['fred'],
  gerald: ['jerry'],
  gregory: ['greg'],
  henry: ['hank'],
  james: ['jim', 'jimmy'],
  jeffrey: ['jeff'],
  jerrold: ['jerry'],
  jonathan: ['jon'],
  joseph: ['joe'],
  katherine: ['kathy', 'kate', 'katie'],
  kathleen: ['kathy'],
  kenneth: ['ken'],
  kimberly: ['kim'],
  lawrence: ['larry'],
  margaret: ['maggie', 'peggy'],
  matthew: ['matt'],
  michael: ['mike'],
  mitchell: ['mitch'],
  nathaniel: ['nate'],
  nicholas: ['nick'],
  pamela: ['pam'],
  patricia: ['pat', 'patty'],
  patrick: ['pat'],
  raymond: ['ray'],
  rebecca: ['becky'],
  richard: ['rick', 'rich', 'dick'],
  robert: ['bob', 'bobby', 'rob'],
  ronald: ['ron'],
  samuel: ['sam'],
  stephen: ['steve'],
  steven: ['steve'],
  susan: ['sue'],
  theodore: ['ted'],
  thomas: ['tom', 'tommy'],
  timothy: ['tim'],
  william: ['bill', 'billy', 'will'],
  zachary: ['zach'],
};

// The directory as last seen (path and query), so a member page can lead
// back to it with the same search and filters (outside review, 2026-10-17)
export const LAST_DIRECTORY = 'tfp:last-directory';

/** Lower case, no accents, punctuation as spaces */
export const fold = text =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** What a member can be found by: words, initials, short forms, state code */
function searchKeys(m) {
  const name = fold(displayName(m.name));
  const words = new Set([...name.split(' '), ...fold(m.name).split(' ')].filter(Boolean));
  for (const w of [...words]) {
    for (const s of SHORT_FORMS[w] || []) {
      words.add(s);
    }
  }
  for (const w of fold(`${m.state} ${m.party} ${partyName(m.party)}`).split(' ')) {
    words.add(w);
  }
  const code = stateByName[m.state]?.code;
  return {
    words: [...words],
    initials: name
      .split(' ')
      .filter(w => w.length > 1)
      .map(w => w[0])
      .join(''),
    code: code ? code.toLowerCase() : null,
  };
}

const keyCache = new WeakMap();
const keysFor = m => {
  if (!keyCache.has(m)) {
    keyCache.set(m, searchKeys(m));
  }
  return keyCache.get(m);
};

/** How many of the typed words match the member (0 to all of them) */
export function matchCount(m, query) {
  const words = fold(query).split(' ').filter(Boolean);
  const k = keysFor(m);
  return words.filter(
    q => q === k.code || (q.length >= 3 && q === k.initials) || k.words.some(w => w.startsWith(q))
  ).length;
}

/**
 * The members matching every word typed; when none do, the ones matching
 * the most words, said so: { members, partial }.
 */
export function searchMembers(members, query) {
  const n = fold(query).split(' ').filter(Boolean).length;
  if (!n) {
    return { members, partial: false };
  }
  const scored = members.map(m => [m, matchCount(m, query)]);
  const all = scored.filter(([, c]) => c === n).map(([m]) => m);
  if (all.length || n === 1) {
    return { members: all, partial: false };
  }
  const best = Math.max(0, ...scored.map(([, c]) => c));
  return {
    members: best > 0 ? scored.filter(([, c]) => c === best).map(([m]) => m) : [],
    partial: best > 0,
  };
}
