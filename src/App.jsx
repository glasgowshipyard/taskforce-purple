import React, { useState, useEffect } from 'react';
import { BarChart3, GitCompare, Users } from 'lucide-react';
import MembersList from './components/MembersList.jsx';
import { TaskForceAPI } from './lib/api.js';

// Bipartisan issues data for the overlap tracker

const bipartisanIssues = [
  {
    issue: 'Veterans Healthcare',
    description: 'Expanding healthcare benefits for veterans',
    supportPercent: 87,
    recentBills: ['HR-1923', 'S-1923'],
    publicSupport: 91,
  },
  {
    issue: 'Infrastructure Investment',
    description: 'Modernizing roads, bridges, and broadband',
    supportPercent: 74,
    recentBills: ['HR-2847', 'S-2847'],
    publicSupport: 83,
  },
  {
    issue: 'Antitrust Enforcement',
    description: 'Breaking up tech monopolies',
    supportPercent: 68,
    recentBills: ['HR-3782', 'S-2992'],
    publicSupport: 72,
  },
  {
    issue: 'Drug Price Reform',
    description: 'Lowering prescription drug costs',
    supportPercent: 81,
    recentBills: ['HR-4521', 'S-3214'],
    publicSupport: 89,
  },
];

// Utility functions moved to api.js

export default function App() {
  const [activeTab, setActiveTab] = useState('leaderboard');
  const [showMethodology, setShowMethodology] = useState(false);
  const [showNerdExplanation, setShowNerdExplanation] = useState(false);
  const [adaptiveThresholds, setAdaptiveThresholds] = useState(null);

  // Fetch adaptive thresholds for tier explanation
  useEffect(() => {
    const fetchThresholds = async () => {
      try {
        const data = await TaskForceAPI.fetchMembers();
        if (data.adaptiveThresholds) {
          setAdaptiveThresholds(data.adaptiveThresholds);
        }
      } catch (error) {
        console.warn('Failed to fetch adaptive thresholds:', error);
      }
    };
    fetchThresholds();
  }, []);

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
          Real bipartisan voting data integration is currently under development. Sample data shown
          below.
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
                <div className="text-xs text-gray-500">
                  Recent Bills: {issue.recentBills.join(', ')}
                </div>
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
        Detailed member profiles are available in the Leaderboard tab. Click on any member to view
        their funding breakdown.
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
                <h1 className="text-xl sm:text-2xl font-bold text-white font-display tracking-tight">
                  Task Force Purple
                </h1>
                <p className="text-white/80 text-xs sm:text-sm font-medium">
                  Political Transparency Platform
                </p>
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
                      Tiers distinguish{' '}
                      <span className="font-semibold text-green-700">individual support</span>{' '}
                      (grassroots + itemized donations) from{' '}
                      <span className="font-semibold text-red-700">institutional capture</span> (PAC
                      money).
                    </p>
                    <p className="text-sm text-gray-700">
                      Tiers start with{' '}
                      <span className="font-semibold text-green-700">individual funding %</span>{' '}
                      (all donations from people, regardless of size), then coordination risk
                      penalties are applied:
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2">Individual Funding Model</h4>
                    <div className="space-y-1 text-sm text-gray-700">
                      <div>
                        <span className="font-medium text-green-700">
                          Grassroots donations (under $200):
                        </span>
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Full credit</span> - Small-dollar donations
                        from ordinary people
                      </div>

                      <div className="mt-2">
                        <span className="font-medium text-blue-600">
                          Itemized donations (over $200):
                        </span>
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Dynamic trust anchor</span> - Safe threshold
                        depends on coordination risk
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Easy to coordinate</span> (&lt; 5% of
                        donors) → 25% limit
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Hard to coordinate</span> (&gt; 10% of
                        donors) → 50% limit
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Quadratic penalty</span> - Going over limit
                        gets punished exponentially
                      </div>
                      <div className="ml-4 text-xs text-gray-600">
                        ⚠️ FEC's $200 threshold is a reporting requirement, not a wealth indicator
                      </div>
                      <div className="ml-4 text-xs text-gray-600 mt-1">
                        💡 <strong>Why cap at 60%?</strong> With 400+ members, the empirical 70th
                        percentile is reliable. But we clamp between 20-60% to prevent runaway
                        penalties if patterns shift dramatically between election cycles. This keeps
                        the system stable while trusting the data.
                      </div>

                      <div className="mt-2">
                        <span className="font-medium text-red-600">PAC money (institutions):</span>
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Super PACs:</span> 2.0x penalty - Unlimited
                        dark money groups
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Leadership/Lobbyist PACs:</span> 1.5x
                        penalty - Political insiders and corporate lobbyists
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Regular PACs:</span> 1.0x penalty - Standard
                        corporate/union money
                      </div>
                      <div className="ml-4">
                        • <span className="font-medium">Candidate's own committee:</span> 0.15x
                        (mostly ignored) - Their personal campaign account
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-800 mb-2">Examples</h4>
                    <div className="text-sm text-gray-700 space-y-3">
                      <div>
                        <p className="font-medium mb-1">AOC (S tier, House):</p>
                        <p className="ml-4 text-xs">
                          69% grassroots + 28% itemized = 97% individual funding
                        </p>
                        <p className="ml-4 text-xs">
                          28% itemized is below {adaptiveThresholds?.houseThreshold || '~40'}%
                          threshold → no penalty → S tier
                        </p>
                      </div>
                      <div>
                        <p className="font-medium mb-1">Dina Titus (C tier, House):</p>
                        <p className="ml-4 text-xs">
                          7% grassroots + 49% itemized = 56% individual funding
                        </p>
                        {adaptiveThresholds?.houseThreshold && (
                          <p className="ml-4 text-xs">
                            49% itemized is {(49 - adaptiveThresholds.houseThreshold).toFixed(1)}%
                            over {adaptiveThresholds.houseThreshold}% threshold → ~
                            {(
                              5 * 0.1 +
                              Math.min(49 - adaptiveThresholds.houseThreshold - 5, 5) * 0.2 +
                              Math.max(49 - adaptiveThresholds.houseThreshold - 10, 0) * 0.3
                            ).toFixed(1)}
                            % penalty → ~
                            {(
                              56 -
                              (5 * 0.1 +
                                Math.min(49 - adaptiveThresholds.houseThreshold - 5, 5) * 0.2 +
                                Math.max(49 - adaptiveThresholds.houseThreshold - 10, 0) * 0.3)
                            ).toFixed(1)}
                            % → C tier
                          </p>
                        )}
                        {!adaptiveThresholds && (
                          <p className="ml-4 text-xs">
                            49% itemized is 9% over threshold → 1.3% penalty → 54.7% → C tier
                          </p>
                        )}
                      </div>
                      <p className="mt-3 italic text-xs">
                        Individual support is good, but <strong>donor coordination risk</strong>{' '}
                        matters. Many donors = impossible to organize. Few donors = easier to
                        coordinate pressure.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-600">
                        <strong>Bottom line:</strong> Where the money comes from matters. Many small
                        donations = accountability to voters. PAC money from corporations =
                        accountability to special interests instead.
                      </p>
                      <button
                        onClick={() => setShowNerdExplanation(!showNerdExplanation)}
                        className="text-xs text-purple-600 hover:text-purple-800 underline font-mono whitespace-nowrap ml-4"
                      >
                        {showNerdExplanation ? 'Hide' : 'Show'} Statistical Details
                      </button>
                    </div>
                    <button
                      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                      className="text-xs text-purple-600 hover:text-purple-800 underline mt-3"
                    >
                      Back to top
                    </button>
                  </div>

                  {/* Nerdy Statistical Explanation - Taleb Style */}
                  {showNerdExplanation && (
                    <div className="mt-4 p-6 bg-gray-900 text-gray-100 rounded-lg border border-gray-700 font-mono text-sm">
                      <h4 className="font-bold text-green-400 mb-4">
                        Power-Law Distribution & Adaptive Thresholds
                      </h4>

                      <div className="space-y-4">
                        <div>
                          <p className="text-gray-300 mb-2">
                            <span className="text-yellow-400 font-bold">Problem:</span> Political
                            finance follows power-law distributions, not Gaussians.
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Fixed thresholds (e.g., "$200+ = wealthy") are naive and fragile
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            FEC's $200 threshold is a{' '}
                            <span className="text-red-400">reporting requirement</span>, not a
                            wealth indicator
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            $201 from a teacher is not elite capture
                          </p>
                        </div>

                        <div>
                          <p className="text-gray-300 mb-2">
                            <span className="text-green-400 font-bold">Solution:</span> Empirical
                            percentile-based thresholds + fat-tail robustness
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            <span className="text-blue-300">70th percentile</span> of itemized
                            donation ratios calculated per chamber
                          </p>
                          {adaptiveThresholds && (
                            <>
                              <p className="text-gray-400 text-xs ml-4">
                                Currently: ~
                                {Math.round(
                                  (adaptiveThresholds.houseThreshold +
                                    adaptiveThresholds.senateThreshold) /
                                    2
                                )}
                                % (House={adaptiveThresholds.houseThreshold}%, Senate=
                                {adaptiveThresholds.senateThreshold}%)
                              </p>
                              <p className="text-gray-400 text-xs ml-4 text-gray-500">
                                (Recalculated quarterly from actual data)
                              </p>
                            </>
                          )}
                          {!adaptiveThresholds && (
                            <p className="text-gray-400 text-xs ml-4">Currently: ~50%</p>
                          )}
                          <p className="text-gray-400 text-xs ml-4 mt-2">
                            <span className="text-orange-300">Why clamp to 20-60%?</span>
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            Lower bound (20%): Prevents under-penalization if sample has anomalously
                            low itemization
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            Upper bound (60%): Prevents runaway penalties from outliers or election
                            cycle volatility
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            With 400+ members, empirical 70th percentile is statistically sound, but
                            clamp ensures cross-cycle stability
                          </p>
                          <p className="text-gray-400 text-xs ml-4 mt-2">
                            Only penalize when{' '}
                            <span className="text-red-300">coordination risk</span> exceeds
                            empirical norms
                          </p>
                        </div>

                        <div>
                          <p className="text-gray-300 mb-2">
                            <span className="text-purple-400 font-bold">Dynamic Trust Anchor:</span>{' '}
                            Sliding threshold based on coordination risk
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Instead of a static limit, the "safe" itemization threshold slides based
                            on <span className="text-cyan-300">Nakamoto Density</span> (% of donors
                            needed to control 50%):
                          </p>
                          <p className="text-gray-400 text-xs ml-4 mt-2">
                            <span className="text-yellow-300">Trust Anchor (T) =</span>
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            • Raw count &lt;50: T = 10% (dinner party - zero trust)
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            • Nakamoto &lt;5%: T = 25% (elite capture - low trust)
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            • 5% ≤ Nakamoto &lt;10%: T = 40% (standard trust)
                          </p>
                          <p className="text-gray-400 text-xs ml-6">
                            • Nakamoto ≥10%: T = 50% (movement - high trust)
                          </p>
                          <p className="text-gray-400 text-xs ml-4 mt-2">
                            <span className="text-orange-300">Quadratic Penalty:</span> P = E² / 20,
                            where E = max(0, Itemized% - T)
                          </p>
                          <p className="text-gray-400 text-xs ml-4 mt-2">
                            Example: 12% Nakamoto → T=50%, 41% itemized → 0% excess → no penalty
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Example: 4% Nakamoto → T=25%, 41% itemized → 16% excess → 12.8% penalty
                          </p>
                        </div>

                        <div>
                          <p className="text-gray-300 mb-2">
                            <span className="text-cyan-400 font-bold">
                              PAC Transparency Weights:
                            </span>{' '}
                            Institutional vs. individual funding
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Super PACs (type O): 2.0x (dark money, unlimited)
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Leadership/Lobbyist PACs (designation D/B): 1.5x (insider networks)
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Regular PACs: 1.0x (standard corporate/union money)
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Candidate committees (P/A designation): 0.15x (campaign apparatus,
                            mostly ignored)
                          </p>
                          <p className="text-gray-400 text-xs ml-4 mt-2 text-yellow-300">
                            Weights multiply: Super PAC + Lobbyist = 2.0 × 1.5 = 3.0x
                          </p>
                        </div>

                        <div className="border-t border-gray-700 pt-4">
                          <p className="text-gray-300 mb-2">
                            <span className="text-orange-400 font-bold">Anti-fragility:</span> Why
                            this approach is robust
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Percentile-based: Adapts to changing political finance landscape
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Fat-tail aware: Tolerates noise in 0-70th percentile range
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Non-linear penalties: Smooth transitions, no cliff effects
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            FEC metadata: Uses official committee types, not brittle name patterns
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Clamped bounds: 20-60% stops runaway penalties while trusting empirical
                            data
                          </p>
                          <p className="text-gray-400 text-xs ml-4">
                            Per-chamber calculation: Senate and House analyzed separately for
                            accuracy
                          </p>
                        </div>

                        <div className="bg-gray-800 p-3 rounded border border-gray-600 mt-4">
                          <p className="text-xs text-gray-300 italic">
                            "The empirical trumps the theoretical. Observe the distribution, don't
                            assume it. Let the data tell you where the threshold should be, not some
                            bureaucrat's $200 rule."
                          </p>
                          <p className="text-xs text-gray-500 mt-2">
                            — Inspired by Taleb's{' '}
                            <span className="font-semibold">
                              Statistical Consequences of Fat Tails
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Original Footer */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Data sources:{' '}
              <a
                href="https://api.open.fec.gov/developers/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:underline"
              >
                OpenFEC API
              </a>
              ,{' '}
              <a
                href="https://www.congress.gov/help/using-data-offsite"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-600 hover:underline"
              >
                Congress.gov API
              </a>
            </div>
            <div className="flex items-center space-x-4 text-sm text-gray-600">
              <a
                href="https://github.com/glasgowshipyard/taskforce-purple"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-900"
              >
                GitHub
              </a>
              <a
                href="https://api.open.fec.gov/developers/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-900"
              >
                Data Sources
              </a>
              <a
                href="https://taskforce-purple-api.dev-a4b.workers.dev/api/members"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-900"
              >
                API
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
