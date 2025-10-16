// API client for Task Force Purple
// Handles communication with Cloudflare Worker backend

// Direct Worker URL since Pages routing isn't set up yet
const API_BASE_URL = 'https://taskforce-purple-api.dev-a4b.workers.dev/api';

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
        method: 'POST'
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
      maximumFractionDigits: 0
    }).format(amount);
  }

  static getTierColor(tier) {
    const colors = {
      'S': 'bg-green-500 text-white',
      'A': 'bg-blue-500 text-white',
      'B': 'bg-yellow-500 text-black',
      'C': 'bg-orange-500 text-white',
      'D': 'bg-red-400 text-white',
      'E': 'bg-red-600 text-white',
      'F': 'bg-gray-900 text-white',
      'N/A': 'bg-gray-300 text-gray-600'
    };
    return colors[tier] || 'bg-gray-500 text-white';
  }

  static getTierDescription(tier) {
    const descriptions = {
      'S': 'People Power (90%+)',
      'A': 'Broadly Supported (75-89%)',
      'B': 'Mostly Individual (60-74%)',
      'C': 'Mixed Sources (45-59%)',
      'D': 'Institution-Influenced (30-44%)',
      'E': 'PAC-Dependent (15-29%)',
      'F': 'Corporate-Funded (0-14%)',
      'N/A': 'No Financial Data Available'
    };
    return descriptions[tier] || 'Unknown';
  }

  static getTierExplanation(tier) {
    const explanations = {
      'S': 'Funded almost entirely by regular people. Gets 90%+ of money directly from individuals (small donations under $200 plus larger personal donations). Minimal corporate PAC influence. Answers to voters, not special interests.',
      'A': 'Mostly people-powered. Gets 75-89% from individual donations. Some corporate PAC money, but still primarily accountable to individual supporters rather than institutions.',
      'B': 'Majority individual funding (60-74%). Mix of grassroots donations and larger personal contributions, with modest corporate PAC influence. More accountable to people than special interests.',
      'C': 'Split funding (45-59% from individuals). Power divided between individual supporters and corporate PACs. Moderate special interest influence competing with voter accountability.',
      'D': 'Institution-influenced (30-44% individual). Relies more on corporate PACs and special interests than on individual constituents. Accountability tilts toward big donors and institutions.',
      'E': 'PAC-dependent (15-29% individual). Heavily reliant on corporate PACs and special interest money. Limited individual constituent support. Answers primarily to institutional funders.',
      'F': 'Corporate-funded (0-14% individual). Almost entirely funded by corporate PACs and special interests. Minimal support from individual constituents. Accountable to corporations, not voters.',
      'N/A': 'No recent financial data available. This could mean they\'re not up for re-election or we haven\'t found their committee records yet.'
    };
    return explanations[tier] || 'No explanation available.';
  }

  static getPACExplanation() {
    return "Political Action Committees (PACs) bundle donations from corporations, special interests, and institutional sources. Heavy PAC funding represents institutional capture rather than individual constituent support. Individual funding (both grassroots <$200 and itemized >$200) represents direct support from people, while PAC money represents organized institutional interests.";
  }

  // Industry categorization for PAC contributors
  static categorizePACByName(pacName) {
    const name = pacName.toUpperCase();

    // Financial Services
    if (name.includes('BANK') || name.includes('FINANCIAL') || name.includes('SECURITIES') ||
        name.includes('INVESTMENT') || name.includes('CAPITAL') || name.includes('PERSHING') ||
        name.includes('GOLDMAN') || name.includes('MORGAN')) {
      return { industry: 'Financial Services', color: 'bg-blue-50 text-blue-800 border-blue-200' };
    }

    // Energy/Oil
    if (name.includes('ENERGY') || name.includes('OIL') || name.includes('GAS') ||
        name.includes('PETROLEUM') || name.includes('EXXON') || name.includes('CHEVRON')) {
      return { industry: 'Energy & Oil', color: 'bg-orange-50 text-orange-800 border-orange-200' };
    }

    // Healthcare/Pharma
    if (name.includes('HEALTH') || name.includes('PHARMA') || name.includes('MEDICAL') ||
        name.includes('PFIZER') || name.includes('JOHNSON')) {
      return { industry: 'Healthcare & Pharma', color: 'bg-green-50 text-green-800 border-green-200' };
    }

    // Tech
    if (name.includes('TECH') || name.includes('GOOGLE') || name.includes('AMAZON') ||
        name.includes('MICROSOFT') || name.includes('APPLE') || name.includes('META')) {
      return { industry: 'Technology', color: 'bg-purple-50 text-purple-800 border-purple-200' };
    }

    // Party Committees
    if (name.includes('DSCC') || name.includes('DCCC') || name.includes('NRCC') ||
        name.includes('NRSC') || name.includes('DEMOCRATIC') || name.includes('REPUBLICAN')) {
      return { industry: 'Party Committee', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' };
    }

    // Labor Unions
    if (name.includes('UNION') || name.includes('WORKERS') || name.includes('TEAMSTERS') ||
        name.includes('AFL') || name.includes('CIO') || name.includes('SEIU')) {
      return { industry: 'Labor Union', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' };
    }

    // Defense/Military
    if (name.includes('DEFENSE') || name.includes('MILITARY') || name.includes('LOCKHEED') ||
        name.includes('BOEING') || name.includes('RAYTHEON')) {
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
    tier: 'S'
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
    tier: 'S'
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
    tier: 'D'
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
    tier: 'A'
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
    tier: 'C'
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
    tier: 'D'
  }
];