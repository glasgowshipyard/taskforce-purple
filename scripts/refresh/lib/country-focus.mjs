// The country label (owner and Craig, 2026-10-13): "Country-focused:
// <country>" on a committee whose sponsor's own Form 990 (Part III, its
// mission in its own words) says it exists to advance a specific country's
// interests or that country's relationship with the United States. One test
// for every country, from the IRS data only; no label where there's no Form
// 990 or no such mission. It changes no grade.

const COUNTRIES = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'Argentina',
  'Armenia',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bangladesh',
  'Belarus',
  'Belgium',
  'Bolivia',
  'Bosnia',
  'Brazil',
  'Bulgaria',
  'Cambodia',
  'Canada',
  'Chile',
  'China',
  'Colombia',
  'Croatia',
  'Cuba',
  'Cyprus',
  'Czechia',
  'Denmark',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Estonia',
  'Ethiopia',
  'Finland',
  'France',
  'Georgia',
  'Germany',
  'Ghana',
  'Greece',
  'Guatemala',
  'Haiti',
  'Honduras',
  'Hungary',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Korea',
  'Kosovo',
  'Latvia',
  'Lebanon',
  'Libya',
  'Lithuania',
  'Malaysia',
  'Mexico',
  'Moldova',
  'Mongolia',
  'Montenegro',
  'Morocco',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Nicaragua',
  'Nigeria',
  'Norway',
  'Pakistan',
  'Palestine',
  'Panama',
  'Peru',
  'Philippines',
  'Poland',
  'Portugal',
  'Qatar',
  'Romania',
  'Russia',
  'Rwanda',
  'Saudi Arabia',
  'Serbia',
  'Singapore',
  'Slovakia',
  'Slovenia',
  'Somalia',
  'South Africa',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Thailand',
  'Turkey',
  'Ukraine',
  'United Kingdom',
  'Uzbekistan',
  'Venezuela',
  'Vietnam',
  'Yemen',
];

const US = String.raw`(?:U\.?\s?S\.?(?:A\.?)?|UNITED STATES|AMERICA|AMERICAN)`;
const BOND = String.raw`(?:RELATIONSHIP|RELATIONS|PARTNERSHIP|ALLIANCE|TIES|FRIENDSHIP|COOPERATION)`;
const ACT = String.raw`(?:SECURE|SECURING|SUPPORT|SUPPORTING|STRENGTHEN|STRENGTHENING|PROTECT|PROTECTING|DEFEND|DEFENDING|ADVANCE|ADVANCING|PROMOTE|PROMOTING)`;

// The ways a mission says it exists for a country ({C} is the country)
const PATTERNS = [
  `${US}\\s*[-–]\\s*{C}\\b[^.;]{0,40}?\\b${BOND}`, // "the U.S.-Israel partnership"
  `\\b{C}\\s*[-–]\\s*${US}\\b[^.;]{0,40}?\\b${BOND}`, // "the Israel-U.S. alliance"
  `\\b${BOND}\\s+(?:BETWEEN|OF)\\s+(?:THE\\s+)?${US}\\s+AND\\s+{C}\\b`, // "relations between the US and C"
  `\\b${BOND}\\s+WITH\\s+(?:OUR\\s+)?(?:ALLY\\s+|FRIEND\\s+|PARTNER\\s+)?{C}\\b`, // "relationship with our ally C"
  `\\bPRO-{C}\\b`, // "pro-Israel"
  `\\b${ACT}\\s+(?:THE\\s+)?(?:STATE\\s+OF\\s+|NATION\\s+OF\\s+|REPUBLIC\\s+OF\\s+)?{C}\\b(?!\\s+(?:INDUSTRY|INDUSTRIES|MARKET|MARKETS|PRODUCERS|GROWERS|AND\\s+(?:THE\\s+)?(?:UNITED STATES|U\\.?S\\.?)))`, // "secure the State of C"
  `\\b{C}'?S\\s+(?:SECURITY|SURVIVAL|INTERESTS|DEFENSE|SOVEREIGNTY)\\b`, // "C's security"
];

/**
 * The country a mission says its organization exists for, or null.
 * Returns { country, phrase } (the words that decided it).
 */
export function countryFocus(mission) {
  const text = String(mission || '')
    .toUpperCase()
    .replace(/&AMP;/g, '&')
    .replace(/\s+/g, ' ');
  if (!text) {
    return null;
  }
  for (const country of COUNTRIES) {
    const c = country.toUpperCase().replace(/ /g, '\\s+');
    // "New Mexico" is a state, not the country
    const name = country === 'Mexico' ? `(?<!NEW\\s)${c}` : c;
    for (const p of PATTERNS) {
      const m = text.match(new RegExp(p.replaceAll('{C}', name)));
      if (m) {
        return { country, phrase: m[0].trim() };
      }
    }
  }
  return null;
}
