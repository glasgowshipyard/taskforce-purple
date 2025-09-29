import React, { useState, useEffect, useMemo } from 'react';
import { Search, RefreshCw, AlertCircle, TrendingUp, DollarSign, Eye } from 'lucide-react';
import { TaskForceAPI, mockCongressData } from '../lib/api.js';

export default function MembersList() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMember, setSelectedMember] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [useMockData, setUseMockData] = useState(false);

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
      const tierOrder = { 'S': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
      if (tierOrder[a.tier] !== tierOrder[b.tier]) {
        return tierOrder[b.tier] - tierOrder[a.tier];
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
                <div className="text-lg font-bold text-green-600">{member.grassrootsPercent}%</div>
                <div className="text-sm text-gray-500">Grassroots</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tier definitions */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Tier Definitions</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {['S', 'A', 'B', 'C', 'D'].map(tier => (
            <div key={tier} className={`p-3 rounded-lg ${TaskForceAPI.getTierColor(tier)}`}>
              <div className="text-2xl font-bold mb-1">{tier}</div>
              <div className="text-xs">{TaskForceAPI.getTierDescription(tier)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Member profile modal/detail */}
      {selectedMember && (
        <div className="bg-white rounded-lg shadow-lg p-6">
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
              </div>
            </div>
            <button
              onClick={() => setSelectedMember(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <div className="text-sm text-red-700">{((selectedMember.pacMoney / selectedMember.totalRaised) * 100).toFixed(1)}% of total</div>
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
        </div>
      )}
    </div>
  );
}