// API client for Task Force Purple
// Handles communication with Cloudflare Worker backend

// Direct Worker URL since Pages routing isn't set up yet
const API_BASE_URL = 'https://taskforce-purple-api.dev-a4b.workers.dev/api';

// Tiers that WITHHOLD a grade rather than award one.
//
// When a tier is ringfenced we must not publish the figures behind it either.
// For DISPUTED we cannot tell whether the underlying FEC filing is sound (the
// agency reports receipts net of refunds and itemized gross, so a committee
// that returned money legitimately files itemized > receipts) or whether our
// own record is corrupt (figures assembled across cycles). That
// indistinguishability is the entire reason the tier exists - so printing a
// percentage derived from those same figures contradicts the sentence sitting
// next to it on the card.
//
// UNVERIFIED goes further: we could not confirm the figures on file belong to
// this member at all (issue #41 - 35 members were showing another person's
// campaign money). Everything derived from that record is suspect, including
// the bundler, foreign-agent and concentration analyses, so those are hidden
// too. DISPUTED hides less: its bundler and concentration analyses come from
// the member's own itemized records and remain sound (issue #40).
//
// Add any future withholding tier here and every suppression site follows.
const RINGFENCED_TIERS = ['DISPUTED', 'UNVERIFIED'];
const IDENTITY_UNVERIFIED_TIERS = ['UNVERIFIED'];

// What goes inside the round tier badge. The badge is a fixed-size circle
// sized for one letter; rendering a word there overflowed it (issue #36).
// Non-letter tiers get a mark, and the words go in the description beside it.
const TIER_BADGE_LABELS = { DISPUTED: '?', UNVERIFIED: '?' };

export class TaskForceAPI {
  static async fetchMembers() {
    try {
      const response = await fetch(`${API_BASE_URL}/members`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check if response is actually JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('Non-JSON response:', text);
        throw new Error(`API returned non-JSON response: ${text.substring(0, 100)}...`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      return data;
    } catch (error) {
      console.error('Failed to fetch members:', error);
      throw error;
    }
  }

  static async triggerDataUpdate() {
    try {
      const response = await fetch(`${API_BASE_URL}/update-data`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to trigger data update:', error);
      throw error;
    }
  }

  static formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * True when the tier withholds a grade, so no funding figures derived from
   * the same record may be displayed. See RINGFENCED_TIERS.
   */
  /**
   * One member's money trail (#32): every committee they run, what each
   * raised, and their largest donors. Fetched per profile, not with the list.
   */
  static async fetchMemberDetail(bioguideId) {
    const response = await fetch(
      `${API_BASE_URL}/member-detail?bioguideId=${encodeURIComponent(bioguideId)}`
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  static isRingfenced(tier) {
    return RINGFENCED_TIERS.includes(tier);
  }

  /**
   * True when we could not confirm the record belongs to this member, so NO
   * analysis derived from it may be shown - not just the headline figures.
   */
  static isIdentityUnverified(tier) {
    return IDENTITY_UNVERIFIED_TIERS.includes(tier);
  }

  /** Text for the round badge: the letter, or a short mark for word tiers. */
  static getTierBadgeLabel(tier) {
    return TIER_BADGE_LABELS[tier] ?? tier;
  }

  static getTierColor(tier) {
    const colors = {
      S: 'bg-green-500 text-white',
      A: 'bg-blue-500 text-white',
      B: 'bg-yellow-500 text-black',
      C: 'bg-orange-500 text-white',
      D: 'bg-red-400 text-white',
      E: 'bg-red-600 text-white',
      F: 'bg-gray-900 text-white',
      'N/A': 'bg-gray-300 text-gray-600',
      // Our figures don't reconcile to the FEC filing - not a judgement
      // about the member, so it must not look like a bad grade
      DISPUTED: 'bg-purple-200 text-purple-900',
      // We're checking whose money this is - also not a judgement
      UNVERIFIED: 'bg-slate-200 text-slate-800',
    };
    return colors[tier] || 'bg-gray-500 text-white';
  }

  static getTierDescription(tier) {
    const descriptions = {
      S: 'People-Funded (90%+)',
      A: 'Very Clean (75-89%)',
      B: 'Above Average (60-74%)',
      C: 'Below Average (45-59%)',
      D: 'PAC Heavy (30-44%)',
      E: 'Captured (15-29%)',
      F: 'Owned (0-14%)',
      'N/A': 'No Financial Data Available',
      DISPUTED: 'Figures Under Review',
      UNVERIFIED: 'Checking Our Records',
    };
    return descriptions[tier] || 'Unknown';
  }

  static getTierExplanation(tier) {
    const explanations = {
      S: 'Democratic power source. 90%+ individual funding (grassroots + itemized) with minimal PAC influence. Power derives from many individual donors, not institutional special interests. Extremely rare.',
      A: 'Strong individual support. 75-89% funded by individual donors with limited institutional capture. Power flows from constituents, not corporate PACs or special interests.',
      B: 'Above average. 60-74% individual funding. Majority people-funded with some institutional influence from PACs or vulnerable to coordinated donor pressure.',
      C: 'Below average diffusion. 45-59% individual funding. Mixed power sources with institutional interests or organized donor groups competing with constituent voices.',
      D: 'PAC heavy. 30-44% individual funding. Power increasingly derived from PACs, special interests, or small groups of coordinated large donors rather than broad individual support.',
      E: 'Captured. 15-29% individual funding. These members depend overwhelmingly on PACs, corporate money, or special interest funding rather than individual constituents.',
      F: 'Owned. 0-14% individual funding. Power comes almost entirely from PACs, special interests, or easily coordinated donor groups. Not accountable to everyday constituents.',
      'N/A':
        "No recent financial data available. This could mean they're not up for re-election or we haven't found their committee records yet.",
      DISPUTED:
        "Our figures for this campaign don't add up against the FEC's own filing, so we won't publish a grade we can't stand behind. This is a problem with our data, not a finding about this member.",
      UNVERIFIED:
        "We're double-checking that the campaign money on file really belongs to this member. We found we had some members matched to the wrong person's records, so until this one is confirmed we won't show a grade or any funding details. This is about our records, not about this member.",
    };
    return explanations[tier] || 'No explanation available.';
  }

  static getPACExplanation() {
    return 'Political Action Committees (PACs) bundle donations from corporations, special interests, and institutional sources. Heavy PAC funding represents institutional capture rather than individual constituent support. Individual funding (both grassroots <$200 and itemized >$200) represents direct support from people, while PAC money represents organized institutional interests.';
  }

  // Industry categorization for PAC contributors
  static categorizePACByName(pacName) {
    const name = pacName.toUpperCase();

    // Financial Services
    if (
      name.includes('BANK') ||
      name.includes('FINANCIAL') ||
      name.includes('SECURITIES') ||
      name.includes('INVESTMENT') ||
      name.includes('CAPITAL') ||
      name.includes('PERSHING') ||
      name.includes('GOLDMAN') ||
      name.includes('MORGAN')
    ) {
      return { industry: 'Financial Services', color: 'bg-blue-50 text-blue-800 border-blue-200' };
    }

    // Energy/Oil
    if (
      name.includes('ENERGY') ||
      name.includes('OIL') ||
      name.includes('GAS') ||
      name.includes('PETROLEUM') ||
      name.includes('EXXON') ||
      name.includes('CHEVRON')
    ) {
      return { industry: 'Energy & Oil', color: 'bg-orange-50 text-orange-800 border-orange-200' };
    }

    // Healthcare/Pharma
    if (
      name.includes('HEALTH') ||
      name.includes('PHARMA') ||
      name.includes('MEDICAL') ||
      name.includes('PFIZER') ||
      name.includes('JOHNSON')
    ) {
      return {
        industry: 'Healthcare & Pharma',
        color: 'bg-green-50 text-green-800 border-green-200',
      };
    }

    // Tech
    if (
      name.includes('TECH') ||
      name.includes('GOOGLE') ||
      name.includes('AMAZON') ||
      name.includes('MICROSOFT') ||
      name.includes('APPLE') ||
      name.includes('META')
    ) {
      return { industry: 'Technology', color: 'bg-purple-50 text-purple-800 border-purple-200' };
    }

    // Party Committees
    if (
      name.includes('DSCC') ||
      name.includes('DCCC') ||
      name.includes('NRCC') ||
      name.includes('NRSC') ||
      name.includes('DEMOCRATIC') ||
      name.includes('REPUBLICAN')
    ) {
      return {
        industry: 'Party Committee',
        color: 'bg-indigo-50 text-indigo-800 border-indigo-200',
      };
    }

    // Labor Unions
    if (
      name.includes('UNION') ||
      name.includes('WORKERS') ||
      name.includes('TEAMSTERS') ||
      name.includes('AFL') ||
      name.includes('CIO') ||
      name.includes('SEIU')
    ) {
      return { industry: 'Labor Union', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' };
    }

    // Defense/Military
    if (
      name.includes('DEFENSE') ||
      name.includes('MILITARY') ||
      name.includes('LOCKHEED') ||
      name.includes('BOEING') ||
      name.includes('RAYTHEON')
    ) {
      return { industry: 'Defense & Military', color: 'bg-gray-50 text-gray-800 border-gray-200' };
    }

    // Default for unrecognized PACs
    return { industry: 'Other PAC', color: 'bg-gray-50 text-gray-600 border-gray-200' };
  }
}

// Mock data fallback for development
export const mockCongressData = [
  {
    bioguideId: 'F000466',
    name: 'Brian Fitzpatrick',
    party: 'Republican',
    state: 'PA',
    district: '1',
    chamber: 'House',
    grassrootsPercent: 89,
    totalRaised: 2847293,
    grassrootsDonations: 2534231,
    pacMoney: 156847,
    tier: 'S',
  },
  {
    bioguideId: 'O000172',
    name: 'Alexandria Ocasio-Cortez',
    party: 'Democratic',
    state: 'NY',
    district: '14',
    chamber: 'House',
    grassrootsPercent: 87,
    totalRaised: 4892847,
    grassrootsDonations: 4256776,
    pacMoney: 98234,
    tier: 'S',
  },
  {
    bioguideId: 'M000355',
    name: 'Mitch McConnell',
    party: 'Republican',
    state: 'KY',
    chamber: 'Senate',
    grassrootsPercent: 23,
    totalRaised: 8934782,
    grassrootsDonations: 2054860,
    pacMoney: 4521847,
    tier: 'D',
  },
  {
    bioguideId: 'W000817',
    name: 'Elizabeth Warren',
    party: 'Democratic',
    state: 'MA',
    chamber: 'Senate',
    grassrootsPercent: 76,
    totalRaised: 6234891,
    grassrootsDonations: 4738517,
    pacMoney: 892374,
    tier: 'A',
  },
  {
    bioguideId: 'C001098',
    name: 'Ted Cruz',
    party: 'Republican',
    state: 'TX',
    chamber: 'Senate',
    grassrootsPercent: 45,
    totalRaised: 9847291,
    grassrootsDonations: 4431081,
    pacMoney: 3284719,
    tier: 'C',
  },
  {
    bioguideId: 'P000197',
    name: 'Nancy Pelosi',
    party: 'Democratic',
    state: 'CA',
    district: '11',
    chamber: 'House',
    grassrootsPercent: 31,
    totalRaised: 12934827,
    grassrootsDonations: 4009736,
    pacMoney: 5847291,
    tier: 'D',
  },
];
