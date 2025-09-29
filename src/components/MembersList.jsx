import React, { useState, useEffect, useMemo } from 'react';
import { Search, RefreshCw, AlertCircle, TrendingUp, DollarSign, Eye, Info, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { TaskForceAPI, mockCongressData } from '../lib/api.js';

export default function MembersList() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [useMockData, setUseMockData] = useState(false);
  const [showTooltip, setShowTooltip] = useState(null);
  const [focusedTier, setFocusedTier] = useState('S'); // Default to S tier
  const [showPACDetails, setShowPACDetails] = useState(false);

  // Gentle scroll to profile when selected (profile is now near top)
  useEffect(() => {
    if (selectedMember) {
      const profileElement = document.getElementById('member-profile');
      if (profileElement) {
        profileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Reset PAC details when selecting new member
      setShowPACDetails(false);
    }
  }, [selectedMember]);

  // Load data on component mount
  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await TaskForceAPI.fetchMembers();

      if (data.members && data.members.length > 0) {
        setMembers(data.members);
        setLastUpdated(data.lastUpdated);
        setUseMockData(false);
      } else {
        // Fallback to mock data if no real data available
        console.log('No real data available, using mock data');
        setMembers(mockCongressData);
        setUseMockData(true);
      }
    } catch (err) {
      console.error('Error loading members:', err);
      setError(err.message);
      // Fallback to mock data on error
      setMembers(mockCongressData);
      setUseMockData(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await loadMembers();
  };

  const filteredMembers = useMemo(() => {
    return members.filter(member =>
      member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.state.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.party.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [members, searchTerm]);

  const sortedMembers = useMemo(() => {
    return [...filteredMembers].sort((a, b) => {
      const tierOrder = { 'S': 6, 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'N/A': 1 };
      if (tierOrder[a.tier] !== tierOrder[b.tier]) {
        return tierOrder[b.tier] - tierOrder[a.tier];
      }
      // For same tier, sort by grassroots percentage (but N/A members by name)
      if (a.tier === 'N/A' && b.tier === 'N/A') {
        return a.name.localeCompare(b.name);
      }
      return b.grassrootsPercent - a.grassrootsPercent;
    });
  }, [filteredMembers]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center space-x-3 text-gray-600">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Loading congressional data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Data source indicator */}
      {useMockData && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 text-yellow-800">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Using Demo Data</span>
          </div>
          <p className="text-yellow-700 text-sm mt-1">
            Real API integration available but showing sample data for demonstration.
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 text-red-800">
            <AlertCircle className="w-5 h-5" />
            <span className="font-medium">Data Loading Error</span>
          </div>
          <p className="text-red-700 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Interactive Tier System */}
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow p-6">
        <div className="flex items-center space-x-2 mb-4">
          <HelpCircle className="w-5 h-5 text-purple-600" />
          <h3 className="text-lg font-semibold text-gray-900">How We Rate Your Representatives</h3>
        </div>

        {/* Interactive Tier Grid */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          {['S', 'A', 'B', 'C', 'D'].map((tier) => (
            <button
              key={tier}
              onClick={() => setFocusedTier(tier)}
              className={`rounded-lg p-3 text-center transition-all duration-300 transform hover:scale-105 focus:outline-none cursor-pointer ${
                TaskForceAPI.getTierColor(tier)
              } ${
                focusedTier === tier
                  ? 'ring-4 ring-purple-400 ring-opacity-60 shadow-lg scale-105'
                  : 'hover:shadow-md'
              }`}
            >
              <div className="text-lg font-bold mb-1">{tier} Tier</div>
              <div className="text-xs opacity-90">{TaskForceAPI.getTierDescription(tier)}</div>
            </button>
          ))}
        </div>

        {/* Dynamic Tier Explanation */}
        <div className="bg-white rounded-lg p-4 border-l-4 border-purple-400 shadow-sm">
          <div className="flex items-center space-x-2 mb-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${TaskForceAPI.getTierColor(focusedTier)}`}>
              {focusedTier}
            </div>
            <h4 className="font-semibold text-gray-900">{focusedTier} Tier: {TaskForceAPI.getTierDescription(focusedTier)}</h4>
          </div>
          <p className="text-sm text-gray-700 mb-3">{TaskForceAPI.getTierExplanation(focusedTier)}</p>

          {/* Show PAC explanation for lower tiers */}
          {(focusedTier === 'C' || focusedTier === 'D') && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm text-red-800">
                <strong>What are PACs?</strong> {TaskForceAPI.getPACExplanation()}
              </p>
            </div>
          )}

          <p className="text-xs text-gray-600 mt-3">💡 Click any representative below to see their detailed funding breakdown.</p>
        </div>
      </div>

      {/* Selected Member Profile - Shows at top when member is clicked */}
      {selectedMember && (
        <div className="bg-white rounded-lg shadow-lg p-6" id="member-profile">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold ${TaskForceAPI.getTierColor(selectedMember.tier)}`}>
                {selectedMember.tier}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedMember.name}</h2>
                <p className="text-gray-600">
                  {selectedMember.party} - {selectedMember.state} {selectedMember.district && `(${selectedMember.district})`} | {selectedMember.chamber}
                </p>
                <p className="text-sm text-gray-500 mt-1">{TaskForceAPI.getTierDescription(selectedMember.tier)}</p>
                <p className="text-sm text-purple-600 mt-2 italic">{TaskForceAPI.getTierExplanation(selectedMember.tier)}</p>
                {selectedMember.lastUpdated && (
                  <p className="text-xs text-gray-400 mt-1">
                    Data last updated: {new Date(selectedMember.lastUpdated).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => setSelectedMember(null)}
              className="text-gray-400 hover:text-gray-600 text-lg font-bold"
            >
              ×
            </button>
          </div>

          {/* Financial data explanation for $0 amounts */}
          {selectedMember.totalRaised === 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex items-start space-x-2">
                <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-blue-800 text-sm">
                  <p className="font-medium">No Recent Campaign Finance Data</p>
                  <p>This could mean they're not up for re-election in 2024, newly elected, or we haven't found their FEC committee records yet. We're working to expand our data coverage.</p>
                </div>
              </div>
            </div>
          )}

          {/* Financial breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <TrendingUp className="w-5 h-5 text-green-600" />
                <span className="font-semibold text-green-800">Grassroots Funding</span>
              </div>
              <div className="text-2xl font-bold text-green-600">{selectedMember.grassrootsPercent}%</div>
              <div className="text-sm text-green-700">{TaskForceAPI.formatCurrency(selectedMember.grassrootsDonations)}</div>
            </div>

            <div className="bg-red-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <DollarSign className="w-5 h-5 text-red-600" />
                <span className="font-semibold text-red-800">PAC Money</span>
              </div>
              <div className="text-2xl font-bold text-red-600">{TaskForceAPI.formatCurrency(selectedMember.pacMoney)}</div>
              <div className="text-sm text-red-700">
                {selectedMember.totalRaised > 0
                  ? `${((selectedMember.pacMoney / selectedMember.totalRaised) * 100).toFixed(1)}% of total`
                  : 'No data available'
                }
              </div>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Eye className="w-5 h-5 text-purple-600" />
                <span className="font-semibold text-purple-800">Total Raised</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">{TaskForceAPI.formatCurrency(selectedMember.totalRaised)}</div>
              <div className="text-sm text-purple-700">2024 Election Cycle</div>
            </div>
          </div>

          {/* Advanced PAC Breakdown Section */}
          {selectedMember.pacMoney > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowPACDetails(!showPACDetails)}
                className="flex items-center space-x-2 text-sm font-medium text-purple-600 hover:text-purple-800 transition-colors"
              >
                {showPACDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span>{showPACDetails ? 'Hide' : 'Show'} Detailed PAC Breakdown</span>
              </button>

              {showPACDetails && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                  <h4 className="font-semibold text-gray-900 mb-4">Top PAC Contributors</h4>

                  {selectedMember.pacContributions && selectedMember.pacContributions.length > 0 ? (
                    selectedMember.pacContributions.map((pac, index) => {
                      const category = TaskForceAPI.categorizePACByName(pac.pacName);
                      return (
                        <div key={index} className="flex items-center justify-between py-3 border-b border-gray-200 last:border-b-0">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3">
                              <div>
                                <h5 className="font-medium text-gray-900">{pac.pacName}</h5>
                                <div className="flex items-center space-x-2 mt-1">
                                  <span className={`text-xs px-2 py-1 rounded-full border ${category.color}`}>
                                    {category.industry}
                                  </span>
                                  <span className="text-xs text-gray-500">{pac.date}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-gray-900">{TaskForceAPI.formatCurrency(pac.amount)}</div>
                            <div className="text-xs text-gray-500">
                              {selectedMember.totalRaised > 0
                                ? `${((pac.amount / selectedMember.totalRaised) * 100).toFixed(1)}% of total`
                                : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <p>No detailed PAC contribution data available</p>
                      <p className="text-xs mt-1">This could mean limited PAC funding or data collection in progress</p>
                    </div>
                  )}

                  <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Understanding PAC Categories:</strong><br />
                      • <strong>Financial Services</strong> - Banks, investment firms, securities companies<br />
                      • <strong>Party Committees</strong> - Official Democratic/Republican campaign committees<br />
                      • <strong>Labor Unions</strong> - Worker organizations and union PACs<br />
                      • <strong>Other PACs</strong> - Issue advocacy groups, trade associations
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Additional member information */}
          {selectedMember.committeeInfo && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="font-semibold text-gray-900 mb-2">Campaign Committee</h4>
              <p className="text-sm text-gray-600">{selectedMember.committeeInfo.name}</p>
              <p className="text-xs text-gray-500">ID: {selectedMember.committeeInfo.id}</p>
            </div>
          )}

          {selectedMember.totalRaised === 0 && (
            <div className="mt-6 pt-6 border-t">
              <p className="text-xs text-gray-500">
                <strong>Note:</strong> This member may be newly elected or their FEC committee data
                might not be available for the 2024 cycle yet.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Main leaderboard */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 font-display">Congressional Tier List</h2>
            {lastUpdated && (
              <p className="text-sm text-gray-500 mt-1">
                Last updated: {new Date(lastUpdated).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex items-center space-x-4">
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
            <button
              onClick={handleRefresh}
              className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          {sortedMembers.map((member) => (
            <div
              key={member.bioguideId}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              onClick={() => setSelectedMember(member)}
            >
              <div className="flex items-center space-x-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${TaskForceAPI.getTierColor(member.tier)}`}>
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
                {member.totalRaised === 0 ? (
                  <div>
                    <div className="text-lg font-bold text-gray-400">No Filings</div>
                    <div className="text-sm text-gray-400">Financial Data</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-lg font-bold text-green-600">{member.grassrootsPercent}%</div>
                    <div className="text-sm text-gray-500">Grassroots</div>
                  </div>
                )}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tier definitions */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Tier Definitions</h3>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {['S', 'A', 'B', 'C', 'D', 'N/A'].map(tier => (
            <div key={tier} className={`p-3 rounded-lg ${TaskForceAPI.getTierColor(tier)}`}>
              <div className="text-2xl font-bold mb-1">{tier}</div>
              <div className="text-xs">{TaskForceAPI.getTierDescription(tier)}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}