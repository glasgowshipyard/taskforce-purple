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
      'D': 'bg-red-500 text-white',
      'N/A': 'bg-gray-300 text-gray-600'
    };
    return colors[tier] || 'bg-gray-500 text-white';
  }

  static getTierDescription(tier) {
    const descriptions = {
      'S': 'Clean - Grassroots Funded (85%+)',
      'A': 'Mostly Clean (70-84%)',
      'B': 'Mixed Funding (50-69%)',
      'C': 'PAC Heavy (30-49%)',
      'D': 'Captured (0-29%)',
      'N/A': 'No Financial Data Available'
    };
    return descriptions[tier] || 'Unknown';
  }

  static getTierExplanation(tier) {
    const explanations = {
      'S': 'Truly people-funded representatives - your voice is likely to be theirs! These members get 85%+ of their funding from small grassroots donations.',
      'A': 'Mostly grassroots funded with some larger donations. Still primarily accountable to constituents like you.',
      'B': 'Mixed funding sources. Some independence from special interests, but also some dependency on larger donors.',
      'C': 'PAC heavy funding. These members rely significantly on Political Action Committees, which bundle corporate and special interest money. Your voice may compete with big donors.',
      'D': 'Corporate captured. These representatives depend heavily on PAC money and large donations, creating dependency on big donors vs. constituents like you.',
      'N/A': 'No recent financial data available. This could mean they\'re not up for re-election or we haven\'t found their committee records yet.'
    };
    return explanations[tier] || 'No explanation available.';
  }

  static getPACExplanation() {
    return "Political Action Committees (PACs) bundle donations from corporations, special interests, and wealthy individuals. While legal, heavy PAC funding can create dependency on big donors rather than everyday constituents like you. Grassroots donations under $200 represent individual citizens directly supporting their representatives.";
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