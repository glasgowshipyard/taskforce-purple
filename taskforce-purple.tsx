import React, { useState, useMemo, useEffect } from 'react';
import { Search, ExternalLink, TrendingUp, Users, DollarSign, Eye, BarChart3, GitCompare } from 'lucide-react';

// Mock data structure representing what we'd get from APIs
const mockCongressData = [
  {
    id: 'fitzpatrick-brian',
    name: 'Brian Fitzpatrick',
    party: 'R',
    state: 'PA',
    district: '1st',
    chamber: 'House',
    grassrootsPercent: 89,
    totalRaised: 2847293,
    grassrootsDonations: 2534231,
    pacMoney: 156847,
    lobbyistMoney: 156215,
    bipartisanScore: 0.847,
    recentVotes: [
      { bill: 'HR-2847', title: 'Infrastructure Investment Act', vote: 'YES', bipartisan: true },
      { bill: 'HR-1923', title: 'Veterans Healthcare Expansion', vote: 'YES', bipartisan: true },
      { bill: 'HR-3421', title: 'Tax Reform Act', vote: 'NO', bipartisan: false }
    ],
    tier: 'S'
  },
  {
    id: 'ocasio-cortez-alexandria',
    name: 'Alexandria Ocasio-Cortez',
    party: 'D',
    state: 'NY',
    district: '14th',
    chamber: 'House',
    grassrootsPercent: 87,
    totalRaised: 4892847,
    grassrootsDonations: 4256776,
    pacMoney: 98234,
    lobbyistMoney: 537837,
    bipartisanScore: 0.234,
    recentVotes: [
      { bill: 'HR-2847', title: 'Infrastructure Investment Act', vote: 'YES', bipartisan: true },
      { bill: 'HR-4521', title: 'Climate Action Now', vote: 'YES', bipartisan: false },
      { bill: 'HR-1923', title: 'Veterans Healthcare Expansion', vote: 'YES', bipartisan: true }
    ],
    tier: 'S'
  },
  {
    id: 'mcconnell-mitch',
    name: 'Mitch McConnell',
    party: 'R',
    state: 'KY',
    chamber: 'Senate',
    grassrootsPercent: 23,
    totalRaised: 8934782,
    grassrootsDonations: 2054860,
    pacMoney: 4521847,
    lobbyistMoney: 2358075,
    bipartisanScore: 0.156,
    recentVotes: [
      { bill: 'S-1847', title: 'Defense Authorization', vote: 'YES', bipartisan: true },
      { bill: 'S-2943', title: 'Banking Deregulation', vote: 'YES', bipartisan: false },
      { bill: 'S-1923', title: 'Veterans Healthcare Expansion', vote: 'NO', bipartisan: true }
    ],
    tier: 'D'
  },
  {
    id: 'warren-elizabeth',
    name: 'Elizabeth Warren',
    party: 'D',
    state: 'MA',
    chamber: 'Senate',
    grassrootsPercent: 76,
    totalRaised: 6234891,
    grassrootsDonations: 4738517,
    pacMoney: 892374,
    lobbyistMoney: 604000,
    bipartisanScore: 0.287,
    recentVotes: [
      { bill: 'S-1847', title: 'Defense Authorization', vote: 'YES', bipartisan: true },
      { bill: 'S-3214', title: 'Financial Reform Act', vote: 'YES', bipartisan: false },
      { bill: 'S-1923', title: 'Veterans Healthcare Expansion', vote: 'YES', bipartisan: true }
    ],
    tier: 'A'
  },
  {
    id: 'cruz-ted',
    name: 'Ted Cruz',
    party: 'R',
    state: 'TX',
    chamber: 'Senate',
    grassrootsPercent: 45,
    totalRaised: 9847291,
    totalReceived: 9847291,
    grassrootsDonations: 4431081,
    pacMoney: 3284719,
    lobbyistMoney: 2131491,
    bipartisanScore: 0.089,
    recentVotes: [
      { bill: 'S-1847', title: 'Defense Authorization', vote: 'YES', bipartisan: true },
      { bill: 'S-2845', title: 'Border Security Act', vote: 'YES', bipartisan: false },
      { bill: 'S-1923', title: 'Veterans Healthcare Expansion', vote: 'NO', bipartisan: true }
    ],
    tier: 'C'
  },
  {
    id: 'pelosi-nancy',
    name: 'Nancy Pelosi',
    party: 'D',
    state: 'CA',
    district: '11th',
    chamber: 'House',
    grassrootsPercent: 31,
    totalRaised: 12934827,
    grassrootsDonations: 4009736,
    pacMoney: 5847291,
    lobbyistMoney: 3077800,
    bipartisanScore: 0.198,
    recentVotes: [
      { bill: 'HR-2847', title: 'Infrastructure Investment Act', vote: 'YES', bipartisan: true },
      { bill: 'HR-4912', title: 'Healthcare Expansion', vote: 'YES', bipartisan: false },
      { bill: 'HR-1923', title: 'Veterans Healthcare Expansion', vote: 'YES', bipartisan: true }
    ],
    tier: 'D'
  }
];

const bipartisanIssues = [
  {
    issue: 'Veterans Healthcare',
    description: 'Expanding healthcare benefits for veterans',
    supportPercent: 87,
    recentBills: ['HR-1923', 'S-1923'],
    publicSupport: 91
  },
  {
    issue: 'Infrastructure Investment',
    description: 'Modernizing roads, bridges, and broadband',
    supportPercent: 74,
    recentBills: ['HR-2847', 'S-2847'],
    publicSupport: 83
  },
  {
    issue: 'Antitrust Enforcement',
    description: 'Breaking up tech monopolies',
    supportPercent: 68,
    recentBills: ['HR-3782', 'S-2992'],
    publicSupport: 72
  },
  {
    issue: 'Drug Price Reform',
    description: 'Lowering prescription drug costs',
    supportPercent: 81,
    recentBills: ['HR-4521', 'S-3214'],
    publicSupport: 89
  }
];

const getTierColor = (tier) => {
  const colors = {
    'S': 'bg-green-500 text-white',
    'A': 'bg-blue-500 text-white', 
    'B': 'bg-yellow-500 text-black',
    'C': 'bg-orange-500 text-white',
    'D': 'bg-red-500 text-white'
  };
  return colors[tier] || 'bg-gray-500 text-white';
};

const getTierDescription = (tier) => {
  const descriptions = {
    'S': 'Clean - Grassroots Funded (85%+)',
    'A': 'Mostly Clean (70-84%)',
    'B': 'Mixed Funding (50-69%)',
    'C': 'PAC Heavy (30-49%)',
    'D': 'Captured (0-29%)'
  };
  return descriptions[tier] || 'Unknown';
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(amount);
};

export default function TeamPurple() {
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [congressData, setCongressData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch real data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://taskforce-purple-api.dev-a4b.workers.dev/api/members');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setCongressData(data.members || []);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch data:', err);
        setError(err.message);
        // Fallback to mock data if API fails
        setCongressData(mockCongressData);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const filteredMembers = useMemo(() => {
    return congressData.filter(member =>
      member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.state.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, congressData]);

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      const tierOrder = { 'S': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
      if (tierOrder[a.tier] !== tierOrder[b.tier]) {
        return tierOrder[b.tier] - tierOrder[a.tier];
      }
      return b.grassrootsPercent - a.grassrootsPercent;
    });
  }, [filteredMembers]);

  const renderLeaderboard = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Congressional Tier List</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search members..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-2">
          {sortedMembers.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              onClick={() => setSelectedMember(member)}
            >
              <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${getTierColor(member.tier)}`}>
                  {member.tier}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{member.name}</h3>
                  <p className="text-sm text-gray-600">
                    {member.party} - {member.state} {member.district && `(${member.district})`} | {member.chamber}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-green-600">{member.grassrootsPercent}%</div>
                <div className="text-sm text-gray-500">Grassroots</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Tier Definitions</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {['S', 'A', 'B', 'C', 'D'].map(tier => (
            <div key={tier} className={`p-3 rounded-lg ${getTierColor(tier)}`}>
              <div className="text-2xl font-bold mb-1">{tier}</div>
              <div className="text-xs">{getTierDescription(tier)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderOverlap = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Bipartisan Overlap Tracker</h2>
        <div className="grid gap-4">
          {bipartisanIssues.map((issue, index) => (
            <div key={index} className="border border-gray-200 rounded-lg p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{issue.issue}</h3>
                  <p className="text-sm text-gray-600">{issue.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-purple-600">{issue.supportPercent}%</div>
                  <div className="text-xs text-gray-500">Congressional Support</div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <div className="text-sm text-gray-700 mb-1">Public Support</div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full" 
                      style={{ width: `${issue.publicSupport}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">{issue.publicSupport}%</div>
                </div>
                <div>
                  <div className="text-sm text-gray-700 mb-1">Congressional Support</div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-purple-500 h-2 rounded-full" 
                      style={{ width: `${issue.supportPercent}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">{issue.supportPercent}%</div>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-xs text-gray-500">Recent Bills: {issue.recentBills.join(', ')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderProfile = () => {
    if (!selectedMember) {
      return (
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Select a Member</h3>
          <p className="text-gray-600">Click on a member from the leaderboard to view their detailed profile.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${getTierColor(selectedMember.tier)}`}>
                {selectedMember.tier}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedMember.name}</h2>
                <p className="text-gray-600">
                  {selectedMember.party} - {selectedMember.state} {selectedMember.district && `(${selectedMember.district})`} | {selectedMember.chamber}
                </p>
                <p className="text-sm text-gray-500 mt-1">{getTierDescription(selectedMember.tier)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-800">Grassroots Funding</span>
              </div>
              <div className="text-2xl font-bold text-green-600">
                {selectedMember.grassrootsPercent}%
                {selectedMember.hasEnhancedData && selectedMember.grassrootsPACTypes && selectedMember.grassrootsPACTypes.length > 0 && (
                  <span className="text-sm font-normal text-green-600">*</span>
                )}
              </div>
              <div className="text-sm text-green-700">
                {formatCurrency(selectedMember.grassrootsDonations || (selectedMember.totalRaised * selectedMember.grassrootsPercent / 100))}
                {selectedMember.hasEnhancedData && selectedMember.grassrootsPACTypes && selectedMember.grassrootsPACTypes.length > 0 && (
                  <div className="text-xs text-green-600 mt-1">
                    *includes {selectedMember.grassrootsPACTypes.join(', ')}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-red-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <DollarSign className="w-5 h-5 text-red-600" />
                <span className="font-semibold text-red-800">PAC Money</span>
              </div>
              <div className="text-2xl font-bold text-red-600">{formatCurrency(selectedMember.pacMoney)}</div>
              <div className="text-sm text-red-700">{((selectedMember.pacMoney / selectedMember.totalRaised) * 100).toFixed(1)}% of total</div>
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Eye className="w-5 h-5 text-orange-600" />
                <span className="font-semibold text-orange-800">Lobbyist Money</span>
              </div>
              <div className="text-2xl font-bold text-orange-600">{formatCurrency(selectedMember.lobbyistMoney)}</div>
              <div className="text-sm text-orange-700">{((selectedMember.lobbyistMoney / selectedMember.totalRaised) * 100).toFixed(1)}% of total</div>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="font-semibold text-gray-900 mb-4">Recent Votes</h3>
            <div className="space-y-3">
              {selectedMember.recentVotes.map((vote, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-gray-900">{vote.title}</div>
                    <div className="text-sm text-gray-600">{vote.bill}</div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`px-2 py-1 rounded text-sm font-medium ${
                      vote.vote === 'YES' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {vote.vote}
                    </span>
                    {vote.bipartisan && (
                      <span className="px-2 py-1 rounded text-sm font-medium bg-purple-100 text-purple-800">
                        Bipartisan
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold">TP</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">Team Purple</h1>
            </div>
            <nav className="flex space-x-8">
              <button
                onClick={() => setActiveTab('leaderboard')}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'leaderboard' 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Leaderboard</span>
              </button>
              <button
                onClick={() => setActiveTab('overlap')}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'overlap' 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <GitCompare className="w-4 h-4" />
                <span>Overlap Tracker</span>
              </button>
              <button
                onClick={() => setActiveTab('profile')}
                className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === 'profile' 
                    ? 'bg-purple-100 text-purple-700' 
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Profile</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'leaderboard' && renderLeaderboard()}
        {activeTab === 'overlap' && renderOverlap()}
        {activeTab === 'profile' && renderProfile()}
      </main>

      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Data sources: <a href="#" className="text-purple-600 hover:underline">FEC API</a>, <a href="#" className="text-purple-600 hover:underline">Senate Lobbying Database</a>, <a href="#" className="text-purple-600 hover:underline">Congress.gov</a>
              </div>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <a href="#" className="hover:text-gray-900">About</a>
                <a href="#" className="hover:text-gray-900">Methodology</a>
                <a href="#" className="hover:text-gray-900">API</a>
              </div>
            </div>
            <div className="text-xs text-gray-500 border-t pt-4">
              <strong>Enhanced Transparency Calculation:</strong> Grassroots percentages marked with * use enhanced calculations that weight PAC types by transparency.
              Candidate committees and personal PACs are treated as more grassroots-friendly, while Super PACs and Leadership PACs receive transparency penalties in tier calculations.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}