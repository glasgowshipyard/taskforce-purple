import React, { useState } from 'react';
import { BarChart3, GitCompare, Users } from 'lucide-react';
import MembersList from './components/MembersList.jsx';

// Bipartisan issues data for the overlap tracker

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

// Utility functions moved to api.js

export default function App() {
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [showMethodology, setShowMethodology] = useState(false);

  const renderLeaderboard = () => <MembersList />;

  const renderOverlap = () => (
    <div className="space-y-6">
      {/* Development notice */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-center space-x-2 text-yellow-800">
          <Users className="w-5 h-5" />
          <span className="font-medium">Feature In Development</span>
        </div>
        <p className="text-yellow-700 text-sm mt-1">
          Real bipartisan voting data integration is currently under development. Sample data shown below.
        </p>
      </div>

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

  const renderProfile = () => (
    <div className="bg-white rounded-lg shadow-lg p-8 text-center">
      <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Member Profiles</h3>
      <p className="text-gray-600">
        Detailed member profiles are available in the Leaderboard tab.
        Click on any member to view their funding breakdown.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gradient-to-r from-red-500 via-purple-600 to-blue-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between py-4 sm:h-20 gap-4 sm:gap-0">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center space-x-4 hover:bg-white/10 rounded-lg p-2 transition-colors group w-full sm:w-auto justify-center sm:justify-start"
            >
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center ring-2 ring-white/30 group-hover:ring-white/50 transition-all">
                <span className="text-white font-bold text-lg font-display">TP</span>
              </div>
              <div className="text-center sm:text-left">
                <h1 className="text-xl sm:text-2xl font-bold text-white font-display tracking-tight">Task Force Purple</h1>
                <p className="text-white/80 text-xs sm:text-sm font-medium">Political Transparency Platform</p>
              </div>
            </button>
            <nav className="flex flex-col sm:flex-row w-full sm:w-auto gap-2 sm:gap-8 sm:space-x-0">
              <button
                onClick={() => setActiveTab('leaderboard')}
                className={`flex items-center justify-center space-x-2 px-4 py-3 sm:py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === 'leaderboard'
                    ? 'bg-white/25 text-white backdrop-blur-sm ring-1 ring-white/30'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Leaderboard</span>
              </button>
              <button
                onClick={() => setActiveTab('overlap')}
                className={`flex items-center justify-center space-x-2 px-4 py-3 sm:py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeTab === 'overlap'
                    ? 'bg-white/25 text-white backdrop-blur-sm ring-1 ring-white/30'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                }`}
              >
                <GitCompare className="w-4 h-4" />
                <span>Overlap Tracker</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'leaderboard' && renderLeaderboard()}
        {activeTab === 'overlap' && renderOverlap()}
      </main>

      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Methodology Explanation - Collapsible */}
          <div className="mb-6" id="how-tiers-work">
            <button
              onClick={() => setShowMethodology(!showMethodology)}
              className="flex items-center space-x-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              <span>{showMethodology ? '▼' : '▶'}</span>
              <span>How Tiers Are Calculated</span>
            </button>

            {showMethodology && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2">The Basic Idea</h4>
                    <p className="text-sm text-gray-700 mb-3">
                      Tiers distinguish <span className="font-semibold text-green-700">individual support</span> (grassroots + itemized donations) from <span className="font-semibold text-red-700">institutional capture</span> (PAC money).
                    </p>
                    <p className="text-sm text-gray-700">
                      Tiers start with <span className="font-semibold text-green-700">individual funding %</span> (all donations from people, regardless of size), then concentration penalties are applied:
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2">Individual Funding Model</h4>
                    <div className="space-y-1 text-sm text-gray-700">
                      <div><span className="font-medium text-green-700">Grassroots donations (under $200):</span></div>
                      <div className="ml-4">• <span className="font-medium">Full credit</span> - Small-dollar donations from ordinary people</div>

                      <div className="mt-2"><span className="font-medium text-blue-600">Itemized donations (over $200):</span></div>
                      <div className="ml-4">• <span className="font-medium">Full credit by default</span> - $201 from a teacher or $250 from a nurse is still grassroots-adjacent</div>
                      <div className="ml-4">• <span className="font-medium">Concentration penalty</span> - Only penalized if ratio is extreme (above 70th percentile, currently ~40%)</div>
                      <div className="ml-4 text-xs text-gray-600">⚠️ FEC's $200 threshold is a reporting requirement, not a wealth indicator</div>

                      <div className="mt-2"><span className="font-medium text-red-600">PAC money (institutions):</span></div>
                      <div className="ml-4">• <span className="font-medium">Super PACs:</span> 2.0x penalty - Unlimited dark money groups</div>
                      <div className="ml-4">• <span className="font-medium">Leadership/Lobbyist PACs:</span> 1.5x penalty - Political insiders and corporate lobbyists</div>
                      <div className="ml-4">• <span className="font-medium">Regular PACs:</span> 1.0x penalty - Standard corporate/union money</div>
                      <div className="ml-4">• <span className="font-medium">Candidate's own committee:</span> 0.15x (mostly ignored) - Their personal campaign account</div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2">Example</h4>
                    <div className="text-sm text-gray-700">
                      <p className="mb-2">
                        Two members both have <span className="text-blue-700">95% individual support</span> (grassroots + itemized):
                      </p>
                      <div className="ml-4 space-y-1">
                        <p><strong>Member A:</strong> 69% grassroots, 28% itemized, 0.4% PAC → <strong>S tier</strong> (28% itemized is below the 40% threshold)</p>
                        <p><strong>Member B:</strong> 7% grassroots, 49% itemized, 4% PAC → <strong>C tier</strong> (49% itemized triggers concentration penalty)</p>
                      </div>
                      <p className="mt-3 italic text-xs">
                        Individual support is good, but <strong>how</strong> that support is distributed matters. Broad grassroots base beats concentrated large donations.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-200">
                    <p className="text-sm text-gray-600">
                      <strong>Bottom line:</strong> Where the money comes from matters. Many small donations = accountability to voters.
                      PAC money from corporations = accountability to special interests instead.
                    </p>
                    <button
                      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                      className="text-xs text-purple-600 hover:text-purple-800 underline mt-3"
                    >
                      ↑ Back to top
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Original Footer */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Data sources: <a href="https://api.open.fec.gov/developers/" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">OpenFEC API</a>, <a href="https://www.congress.gov/help/using-data-offsite" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Congress.gov API</a>
            </div>
            <div className="flex items-center space-x-4 text-sm text-gray-600">
              <a href="https://github.com/glasgowshipyard/taskforce-purple" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900">GitHub</a>
              <a href="https://api.open.fec.gov/developers/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900">Data Sources</a>
              <a href="https://taskforce-purple-api.dev-a4b.workers.dev/api/members" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900">API</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}