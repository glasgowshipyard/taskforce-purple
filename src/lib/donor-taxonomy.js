/**
 * DONOR NETWORK TAXONOMY - display-only classification of bundlers/conduits
 * into sectors with lucide icon names, so a visitor can read a member card
 * at a glance without knowing what a "conduit" is.
 *
 * IMPORTANT: this is presentation only. Tier scoring never uses name
 * patterns (see CLAUDE.md conventions) - every classified organization is
 * still shown with its full FEC-reported name and dollar amount, and
 * anything unrecognized falls back to a neutral sector.
 */

// Sector definitions: plain-English label + lucide icon name.
// Icons must exist in the installed lucide-react version (checked in tests
// indirectly via the frontend build).
export const SECTORS = {
  platform: { label: 'Fundraising platform', icon: 'Share2', tone: 'neutral' },
  'pro-israel': { label: 'Pro-Israel lobby network', icon: 'Landmark', tone: 'flag' },
  'party-machine': { label: 'Party money network', icon: 'Flag', tone: 'flag' },
  'advocacy-network': { label: 'Advocacy money network', icon: 'Megaphone', tone: 'flag' },
  industry: { label: 'Industry group', icon: 'Briefcase', tone: 'flag' },
  tribal: { label: 'Tribal nation', icon: 'Landmark', tone: 'neutral' },
  'foreign-agent': { label: 'Registered foreign-agent firm', icon: 'Globe', tone: 'alert' },
  other: { label: 'Organization', icon: 'Users', tone: 'neutral' },
};

// Name patterns (normalized uppercase) -> sector. First match wins.
// Extend freely - unrecognized names degrade to 'other', never hidden.
const RULES = [
  { sector: 'platform', patterns: ['ACTBLUE', 'WINRED', 'DEMOCRACY ENGINE', 'OATH '] },
  {
    sector: 'pro-israel',
    patterns: ['ISRAEL PUBLIC AFFAIRS', 'AIPAC', 'NORPAC', 'JSTREET', 'J STREET', 'DMFI'],
  },
  {
    sector: 'party-machine',
    patterns: [
      'SENATE CONSERVATIVES FUND',
      'HOUSE FREEDOM FUND',
      'FREEDOM CAUCUS',
      'CLUB FOR GROWTH',
      'EMILY',
      'SWING LEFT',
      'SERVE AMERICA',
      'MAGGIE',
      'NO LABELS',
    ],
  },
  {
    sector: 'advocacy-network',
    patterns: ['END CITIZENS UNITED', ' ECU', 'PAC FOR GOOD', 'ZINC COLLECTIVE', 'DIGIDEMS'],
  },
  {
    sector: 'industry',
    patterns: ['ASSOCIATION OF BROADCASTERS', 'NABPAC', 'COUNCIL OF ENGINEERING'],
  },
  { sector: 'tribal', patterns: [' TRIBE', ' NATION', 'BAND OF', 'INDIAN COMMUNITY'] },
];

export function classifyOrganization(name) {
  const n = ` ${(name || '').toUpperCase()} `;
  for (const rule of RULES) {
    if (rule.patterns.some(p => n.includes(p))) {
      return rule.sector;
    }
  }
  return 'other';
}

export function sectorInfo(sector) {
  return SECTORS[sector] || SECTORS.other;
}

// Quicklook summary for a member row: which flag-worthy sectors are present
// in their bundled money, plus whether foreign-agent-firm money exists.
export function quicklookSectors(member) {
  const sectors = new Set();
  for (const conduit of member?.topConduits || []) {
    const s = classifyOrganization(conduit.name);
    if (s !== 'platform' && s !== 'other') {
      sectors.add(s);
    }
  }
  if ((member?.faraEmployerTotal || 0) > 0) {
    sectors.add('foreign-agent');
  }
  return [...sectors];
}
