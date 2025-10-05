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
  const [showTierExplanation, setShowTierExplanation] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [displayedCount, setDisplayedCount] = useState(20); // Start with 20 on each page
  const ITEMS_PER_PAGE = 20;

  // Scroll to profile when selected and reset PAC details
  useEffect(() => {
    if (selectedMember) {
      // Reset PAC details when selecting new member
      setShowPACDetails(false);

      // Scroll to top first, then to profile
      setTimeout(() => {
        const profileElement = document.getElementById('member-profile');
        if (profileElement) {
          profileElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
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

  // Create showcase page (page 1) with meaningful representatives
  // Check if showcase should be available (page 1, no search)
  const hasShowcaseAvailable = useMemo(() => {
    return !searchTerm; // Showcase available when no search term
  }, [searchTerm]);

  const showcaseMembers = useMemo(() => {
    if (currentPage !== 1 || searchTerm) return null; // Only show on page 1 with no search

    const showcase = [];

    // Get top S-tier (truly grassroots)
    const sTier = filteredMembers
      .filter(member => member.tier === 'S')
      .sort((a, b) => b.grassrootsPercent - a.grassrootsPercent)
      .slice(0, 8);

    // Get top A-tier (mostly clean)
    const aTier = filteredMembers
      .filter(member => member.tier === 'A')
      .sort((a, b) => b.grassrootsPercent - a.grassrootsPercent)
      .slice(0, 6);

    // Get some B-tier (mixed funding) for context
    const bTier = filteredMembers
      .filter(member => member.tier === 'B')
      .sort((a, b) => b.grassrootsPercent - a.grassrootsPercent)
      .slice(0, 4);

    // Get a couple C-tier for comparison
    const cTier = filteredMembers
      .filter(member => member.tier === 'C')
      .sort((a, b) => b.grassrootsPercent - a.grassrootsPercent)
      .slice(0, 2);

    // Get some D-tier members to show the contrast (highest grassroots % within D-tier)
    const dTier = filteredMembers
      .filter(member => member.tier === 'D')
      .sort((a, b) => b.grassrootsPercent - a.grassrootsPercent)
      .slice(0, 4);

    showcase.push(...sTier, ...aTier, ...bTier, ...cTier, ...dTier);
    return showcase.slice(0, 20); // Ensure exactly 20
  }, [filteredMembers, currentPage, searchTerm]);

  // Regular sorted members for normal pages
  const sortedMembers = useMemo(() => {
    const sorted = [...filteredMembers].sort((a, b) => {
      const tierOrder = { 'S': 8, 'A': 7, 'B': 6, 'C': 5, 'D': 4, 'E': 3, 'F': 2, 'N/A': 1 };
      if (tierOrder[a.tier] !== tierOrder[b.tier]) {
        return tierOrder[b.tier] - tierOrder[a.tier];
      }
      // For same tier, sort by grassroots percentage (but N/A members by name)
      if (a.tier === 'N/A' && b.tier === 'N/A') {
        return a.name.localeCompare(b.name);
      }
      return b.grassrootsPercent - a.grassrootsPercent;
    });

    // If showing showcase page, return that
    if (showcaseMembers) return showcaseMembers;

    // Otherwise return paginated results
    // Adjust pagination to account for showcase on page 1
    let adjustedStartIndex;

    if (currentPage === 2 && hasShowcaseAvailable) {
      // Page 2 after showcase: start from position 20 (after the 20 showcase members)
      adjustedStartIndex = 20;
    } else if (currentPage > 2 && hasShowcaseAvailable) {
      // Pages 3+: account for the fact that page 1 had 20 items, page 2 had 20 items
      adjustedStartIndex = 20 + (currentPage - 2) * ITEMS_PER_PAGE;
    } else {
      // Normal pagination when no showcase
      adjustedStartIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    }

    return sorted.slice(adjustedStartIndex, adjustedStartIndex + displayedCount);
  }, [filteredMembers, currentPage, displayedCount, showcaseMembers, hasShowcaseAvailable]);

  // Calculate total pages
  const totalPages = Math.ceil(filteredMembers.length / ITEMS_PER_PAGE);

  // Reset to page 1 when search changes
  useEffect(() => {
    setCurrentPage(1);
    setDisplayedCount(ITEMS_PER_PAGE);
  }, [searchTerm]);


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
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow p-4 sm:p-6">
        <button
          onClick={() => setShowTierExplanation(!showTierExplanation)}
          className="flex items-center justify-between w-full sm:pointer-events-none"
        >
          <div className="flex items-center space-x-2">
            <HelpCircle className="w-5 h-5 text-purple-600" />
            <h3 className="text-base sm:text-lg font-semibold text-gray-900">How We Rate Your Representatives</h3>
          </div>
          <ChevronDown className={`w-5 h-5 text-purple-600 sm:hidden transition-transform ${showTierExplanation ? 'rotate-180' : ''}`} />
        </button>

        {/* Show on desktop, collapsible on mobile */}
        <div className={`${showTierExplanation ? 'block' : 'hidden'} sm:block mt-4`}>
          {/* Interactive Tier Grid */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-4 sm:mb-6">
          {['S', 'A', 'B', 'C', 'D', 'E', 'F'].map((tier) => (
            <button
              key={tier}
              onClick={() => setFocusedTier(tier)}
              className={`rounded-lg p-2 sm:p-3 text-center transition-all duration-300 transform hover:scale-105 focus:outline-none cursor-pointer ${
                TaskForceAPI.getTierColor(tier)
              } ${
                focusedTier === tier
                  ? 'ring-2 sm:ring-4 ring-purple-400 ring-opacity-60 shadow-lg scale-105'
                  : 'hover:shadow-md'
              }`}
            >
              <div className="text-base sm:text-lg font-bold mb-0 sm:mb-1">{tier}</div>
              <div className="text-[10px] sm:text-xs opacity-90 hidden sm:block">
                {TaskForceAPI.getTierDescription(tier)}
              </div>
            </button>
          ))}
        </div>

          {/* Dynamic Tier Explanation */}
          <div className="bg-white rounded-lg p-3 sm:p-4 border-l-4 border-purple-400 shadow-sm">
            <div className="flex items-center space-x-2 mb-2 sm:mb-3">
              <div className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold ${TaskForceAPI.getTierColor(focusedTier)}`}>
                {focusedTier}
              </div>
              <h4 className="font-semibold text-gray-900 text-sm sm:text-base">
                {focusedTier} Tier: {TaskForceAPI.getTierDescription(focusedTier)}
              </h4>
            </div>
            <p className="text-xs sm:text-sm text-gray-700">{TaskForceAPI.getTierExplanation(focusedTier)}</p>

          {/* Show PAC explanation for lower tiers */}
          {(focusedTier === 'C' || focusedTier === 'D' || focusedTier === 'E' || focusedTier === 'F') && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
              <p className="text-sm text-red-800">
                <strong>What are PACs?</strong> {TaskForceAPI.getPACExplanation()}
              </p>
            </div>
          )}

          <p className="text-xs text-gray-600 mt-3">💡 Click any representative below to see their detailed funding breakdown.</p>
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className={`p-4 rounded-lg ${selectedMember.grassrootsPercent <= 15 ? 'bg-red-50' : 'bg-green-50'}`}>
              <div className="flex items-center space-x-2 mb-2">
                <TrendingUp className={`w-5 h-5 ${selectedMember.grassrootsPercent <= 15 ? 'text-red-600' : 'text-green-600'}`} />
                <span className={`font-semibold text-xs ${selectedMember.grassrootsPercent <= 15 ? 'text-red-800' : 'text-green-800'}`}>Grassroots (&lt;$200)</span>
              </div>
              <div className={`text-2xl font-bold ${selectedMember.grassrootsPercent <= 15 ? 'text-red-600' : 'text-green-600'}`}>
                {selectedMember.grassrootsPercent}%
                {selectedMember.hasEnhancedData && selectedMember.grassrootsPACTypes && (
                  <span className={`text-sm font-normal ${selectedMember.grassrootsPercent <= 15 ? 'text-red-600' : 'text-green-600'}`}>*</span>
                )}
              </div>
              <div className={`text-sm ${selectedMember.grassrootsPercent <= 15 ? 'text-red-700' : 'text-green-700'}`}>{TaskForceAPI.formatCurrency(selectedMember.grassrootsDonations)}</div>
              {selectedMember.hasEnhancedData && selectedMember.grassrootsPACTypes && (
                <div className={`text-xs mt-1 ${selectedMember.grassrootsPercent <= 15 ? 'text-red-600' : 'text-green-600'}`}>
                  *includes {selectedMember.grassrootsPACTypes.join(', ')}
                </div>
              )}
            </div>

            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <DollarSign className="w-5 h-5 text-orange-600" />
                <span className="font-semibold text-xs text-orange-800">Large Donors (&gt;$200)</span>
              </div>
              <div className="text-2xl font-bold text-orange-600">
                {selectedMember.totalRaised > 0 && selectedMember.largeDonorDonations !== undefined
                  ? `${((selectedMember.largeDonorDonations / selectedMember.totalRaised) * 100).toFixed(1)}%`
                  : '0%'
                }
              </div>
              <div className="text-sm text-orange-700">{TaskForceAPI.formatCurrency(selectedMember.largeDonorDonations || 0)}</div>
            </div>

            <div className="bg-red-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <DollarSign className="w-5 h-5 text-red-600" />
                <span className="font-semibold text-xs text-red-800">PAC Money</span>
              </div>
              <div className="text-2xl font-bold text-red-600">
                {selectedMember.totalRaised > 0
                  ? `${((selectedMember.pacMoney / selectedMember.totalRaised) * 100).toFixed(1)}%`
                  : '0%'
                }
              </div>
              <div className="text-sm text-red-700">{TaskForceAPI.formatCurrency(selectedMember.pacMoney)}</div>
            </div>

            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Eye className="w-5 h-5 text-purple-600" />
                <span className="font-semibold text-xs text-purple-800">Total Raised</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">{TaskForceAPI.formatCurrency(selectedMember.totalRaised)}</div>
              <div className="text-sm text-purple-700">2024 Election Cycle</div>
            </div>
          </div>

          {/* Tier Explanation */}
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2 flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Understanding {selectedMember.name.split(',')[0]}'s {selectedMember.tier} Tier
            </h4>
            <div className="text-sm text-blue-800 space-y-2">
              <p>
                This tier reflects <strong>funding diffusion</strong> - <span className="font-semibold text-green-700">{selectedMember.grassrootsPercent}% grassroots</span> funding adjusted for
                concentration from <span className="font-semibold text-orange-700">large donors ({selectedMember.largeDonorDonations ? `${((selectedMember.largeDonorDonations / selectedMember.totalRaised) * 100).toFixed(1)}%` : '0%'})</span>
                {' '}and <span className="font-semibold text-red-700">PACs ({selectedMember.pacMoney ? `${((selectedMember.pacMoney / selectedMember.totalRaised) * 100).toFixed(1)}%` : '0%'})</span>.
              </p>
              <div className="flex items-center justify-between mt-2">
                <a
                  href="#tier-methodology"
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('tier-methodology')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  See detailed methodology →
                </a>
                <button
                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  ↑ Back to top
                </button>
              </div>
            </div>
          </div>

          {/* Advanced PAC Breakdown Section */}
          {selectedMember.pacContributions && selectedMember.pacContributions.length > 0 && (
            <div className="mt-6">
              <button
                onClick={() => setShowPACDetails(!showPACDetails)}
                className="flex items-center space-x-2 text-sm font-medium text-purple-600 hover:text-purple-800 transition-colors"
              >
                {showPACDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                <span>{showPACDetails ? 'Hide' : 'Show'} Detailed PAC Breakdown ({selectedMember.pacContributions.length} contributions)</span>
              </button>

              {showPACDetails && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                  <h4 className="font-semibold text-gray-900 mb-4">Top PAC Contributors</h4>

                  {selectedMember.pacContributions.length > 0 ? (
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
                                {/* FEC Committee Details */}
                                {(pac.committee_id || pac.committee_type || pac.designation) && (
                                  <div className="flex items-center space-x-2 mt-1">
                                    {pac.committee_id && (
                                      <span className="text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded border border-blue-200 font-mono">
                                        FEC: {pac.committee_id}
                                      </span>
                                    )}
                                    {pac.committee_type && (
                                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded border">
                                        Type: {pac.committee_type}
                                      </span>
                                    )}
                                    {pac.designation && (
                                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded border">
                                        Class: {pac.designation}
                                      </span>
                                    )}
                                  </div>
                                )}
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
                      <strong>Reading FEC Committee Codes:</strong><br />
                      <strong className="text-blue-900 mt-1 block">Types:</strong>
                      <span className="font-mono">O</span>=Super PAC (2.0x penalty),
                      <span className="font-mono">P</span>=Candidate Committee (85% discount),
                      Regular PACs (1.0x penalty)<br />
                      <strong className="text-blue-900 mt-1 block">Designations:</strong>
                      <span className="font-mono">D</span>=Leadership PAC (1.5x penalty),
                      <span className="font-mono">B</span>=Lobbyist PAC (1.5x penalty),
                      <span className="font-mono">A/P</span>=Authorized (85% discount)<br />
                      <strong className="text-blue-900 mt-1 block">Industry labels</strong> (Financial Services, Labor, etc.) are for display only - penalties use FEC codes.
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

        {/* Page header with showcase explanation */}
        <div className="mb-4">
          {showcaseMembers && !searchTerm ? (
            <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
              <h3 className="font-semibold text-purple-900 mb-2">Top 20 Representatives Showcase</h3>
              <p className="text-sm text-purple-700">
                Featuring the most grassroots-funded representatives in Congress - those most accountable to individual constituents like you, not special interests.
              </p>
            </div>
          ) : searchTerm ? (
            <div className="text-sm text-gray-600">
              Showing search results for "{searchTerm}"
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              Page {currentPage} of {totalPages} • Showing all Congress members
            </div>
          )}
        </div>

        <div className="grid gap-2">
          {sortedMembers.map((member) => (
            <div
              key={member.bioguideId}
              className="flex items-center space-x-3 sm:space-x-4 p-3 sm:p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
              onClick={() => setSelectedMember(member)}
            >
              <div className={`w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 rounded-full flex items-center justify-center text-lg sm:text-xl font-bold ${TaskForceAPI.getTierColor(member.tier)}`}>
                {member.tier}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">{member.name}</h3>
                <p className="text-xs sm:text-sm text-gray-600 truncate">
                  {member.party} - {member.state} {member.district && `(${member.district})`} | {member.chamber}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                {member.totalRaised === 0 ? (
                  <div>
                    <div className="text-sm sm:text-lg font-bold text-gray-400">No Data</div>
                    <div className="text-[10px] sm:text-sm text-gray-400">Filings</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-base sm:text-lg font-bold text-green-600">
                      {member.grassrootsPercent}%
                      {member.hasEnhancedData && member.grassrootsPACTypes && (
                        <span className="text-xs font-normal text-green-600">*</span>
                      )}
                    </div>
                    <div className="text-[10px] sm:text-sm text-gray-500">Grassroots</div>
                  </div>
                )}</div>
            </div>
          ))}
        </div>

        {/* Pagination and Load More controls */}
        {!searchTerm && (
          <div className="mt-6 flex flex-col items-center space-y-4">
            {/* Load More button for current page (if not showing all) */}
            {displayedCount < ITEMS_PER_PAGE && !showcaseMembers && (
              <button
                onClick={() => setDisplayedCount(Math.min(displayedCount + 10, ITEMS_PER_PAGE))}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                Load More ({Math.min(10, ITEMS_PER_PAGE - displayedCount)} more)
              </button>
            )}

            {/* Page navigation */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setCurrentPage(Math.max(1, currentPage - 1));
                    setDisplayedCount(ITEMS_PER_PAGE);
                  }}
                  disabled={currentPage === 1}
                  className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>

                {/* Page numbers with sliding window */}
                {(() => {
                  const maxVisible = 7; // Show up to 7 page numbers
                  const sidePages = Math.floor(maxVisible / 2);

                  let startPage = Math.max(1, currentPage - sidePages);
                  let endPage = Math.min(totalPages, currentPage + sidePages);

                  // Adjust if we're near the beginning or end
                  if (endPage - startPage + 1 < maxVisible) {
                    if (startPage === 1) {
                      endPage = Math.min(totalPages, startPage + maxVisible - 1);
                    } else if (endPage === totalPages) {
                      startPage = Math.max(1, endPage - maxVisible + 1);
                    }
                  }

                  const pages = [];

                  // Show first page if not in range
                  if (startPage > 1) {
                    pages.push(
                      <button
                        key={1}
                        onClick={() => {
                          setCurrentPage(1);
                          setDisplayedCount(ITEMS_PER_PAGE);
                        }}
                        className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
                      >
                        1
                      </button>
                    );
                    if (startPage > 2) {
                      pages.push(<span key="ellipsis1" className="text-gray-500">...</span>);
                    }
                  }

                  // Show page range
                  for (let i = startPage; i <= endPage; i++) {
                    pages.push(
                      <button
                        key={i}
                        onClick={() => {
                          setCurrentPage(i);
                          setDisplayedCount(ITEMS_PER_PAGE);
                        }}
                        className={`px-3 py-1 rounded ${
                          currentPage === i
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-100 hover:bg-gray-200'
                        }`}
                      >
                        {i}
                      </button>
                    );
                  }

                  // Show last page if not in range
                  if (endPage < totalPages) {
                    if (endPage < totalPages - 1) {
                      pages.push(<span key="ellipsis2" className="text-gray-500">...</span>);
                    }
                    pages.push(
                      <button
                        key={totalPages}
                        onClick={() => {
                          setCurrentPage(totalPages);
                          setDisplayedCount(ITEMS_PER_PAGE);
                        }}
                        className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
                      >
                        {totalPages}
                      </button>
                    );
                  }

                  return pages;
                })()}

                <button
                  onClick={() => {
                    setCurrentPage(Math.min(totalPages, currentPage + 1));
                    setDisplayedCount(ITEMS_PER_PAGE);
                  }}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}

            <div className="text-sm text-gray-500">
              {showcaseMembers ? (
                "Showing top 20 representatives"
              ) : (
                `Showing ${sortedMembers.length} of ${filteredMembers.length} members`
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}