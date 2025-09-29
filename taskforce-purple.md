# Task Force Purple - Complete Technical Specification

## Project Overview

Task Force Purple is a political transparency platform that cuts through partisan theater by tracking money in politics. It exposes how politicians from both parties often serve the same corporate interests while performing fake fights to distract voters. The platform makes campaign finance data as accessible as checking sports stats.

## Core Philosophy

**The Problem:** Citizens are told they live in incompatible political camps, but overlap exists on many issues. Corporate money influences both parties while manufactured culture wars distract from shared struggles.

**The Solution:** Evidence-based transparency tool that shows who actually serves people vs. money, regardless of party affiliation. Plain English explanations backed by real government data.

**Writing Tone:** Extremely plain English. Explain like talking to your neighbor. No academic jargon. Connect theory to "here's who voted for what yesterday."

## Key Conceptual Frameworks

### Pay-to-Win Politics
Politics has become a pay-to-win game where corporate money buys policy outcomes while regular citizens can't compete. Campaign donations = purchasing votes, lobbying = buying access, PAC money = policy influence. The wealthy get advantages regular voters can't access.

### Public Service Reminder
Politicians are public servants - employees paid by taxpayers to serve the public interest. Their job description is clear: represent constituents, not donors. Team Purple treats them as accountable employees, not untouchable figures or tribal leaders.

### Political Enshittification
Politics follows the same three-stage decay pattern as tech platforms:
1. **Promises:** Campaign on serving constituents, build voter trust
2. **Money:** Once elected, serve donors while maintaining voter-friendly rhetoric  
3. **Fucking Over Constituents:** Pure extraction for wealthy interests, rely on partisan fear to keep votes locked in

These frameworks make complex political corruption accessible through familiar experiences (gaming, workplace dynamics, tech platform decay).

## Branding & Positioning

**Name:** Task Force Purple

**Positioning:** A citizens' oversight operation holding public servants accountable through data transparency. Not a political commentary site - an active investigation into who serves people vs. money.

**Tone:** Direct, factual, no-nonsense. Like a task force investigation report, not political punditry.

## Core Features

### 1. Congressional Tier List
Rate all Congress members by funding source integrity:

- **S Tier (85%+ grassroots):** Clean, people-funded representatives
- **A Tier (70-84%):** Mostly grassroots funding
- **B Tier (50-69%):** Mixed funding sources
- **C Tier (30-49%):** PAC/lobbyist heavy
- **D Tier (0-29%):** Corporate captured

**Calculation:**
```
grassrootsPercent = (donations < $200) / totalRaised * 100
```

### 2. Member Profiles
Detailed breakdown for each Congress member:
- Funding sources (grassroots vs PAC vs lobbyist money)
- Recent voting record with bipartisan indicators
- Top donors and conflicts of interest
- Direct links to original FEC filings
- Tier assignment with explanation

### 3. Bipartisan Overlap Tracker
Identify issues where red/blue actually converge:
- Infrastructure investment
- Veterans healthcare
- Antitrust enforcement
- Drug price reform
- Show public polling vs congressional support
- Highlight bills that unite S-tier members across parties

### 4. Special Interests Dashboard
Map industries and lobbyists funding both parties:
- Connect money trails to recent votes
- Show parallel outcomes behind political theater
- Track revolving door between government and industry

### 5. Smart Article System
Two types of content:

**Evergreen Explainers** (Human-written):
- "Why Your Insurance Company Makes Everything So Hard"
- "The Rural/Urban Lie: Same Problems, Different Scapegoats"
- "How to Read Your Rep's Money Trail"
- Academic concepts (Doctorow, Graeber) made accessible

**Auto-Generated Updates** (AI + data-driven):
- "💸 @SenCruz just got $500K from oil companies"
- "📉 5 Members Who Dropped Tiers This Quarter"
- "🤝 Rare Unity: S-tier members back rail safety"
- "🚨 Funding Alert: New PAC money changes rankings"

## Technical Architecture

### Platform: Cloudflare (Free Tier)
- **Cloudflare Workers:** Data processing, API endpoints, OAuth
- **Cloudflare Pages:** React frontend hosting
- **Cloudflare KV:** Processed data storage
- **GitHub:** Content management, version control
- **Domain:** taskforcepurple.com or .org

### Data Pipeline
**Primary Sources (All Public APIs):**
- **OpenFEC API** (`api.open.fec.gov/v1`): Campaign finance data, requires API key from api.data.gov
- **Congress.gov API** (`api.congress.gov/v3`): Current members, voting records, requires API key
- **Senate Lobbying Database**: Quarterly lobbying disclosure data
- **Note**: ProPublica Congress API was discontinued in 2024

**Real API Endpoints:**
```
# Current Congress Members (119th Congress)
GET https://api.congress.gov/v3/member/congress/119?currentMember=true&api_key={key}

# Candidate Financial Data
GET https://api.open.fec.gov/v1/candidates/?api_key={key}&election_year=2024&office=H,S

# Committee Financial Summaries
GET https://api.open.fec.gov/v1/committees/{committee_id}/totals/?api_key={key}

# Individual Contributions (for grassroots calculation)
GET https://api.open.fec.gov/v1/schedules/schedule_a/?api_key={key}&committee_id={id}
```

**Processing Flow:**
1. **Daily Worker Schedule**: Fetch current member list from Congress.gov API
2. **Weekly Worker Schedule**: Pull latest FEC financial data for all committees
3. **Data Processing**: Calculate grassroots percentage from contributions <$200
4. **Tier Assignment**: Apply S-D tier system based on grassroots percentage
5. **KV Storage**: Store processed member profiles with tier rankings
6. **Change Detection**: Trigger updates only when tier changes occur

### Frontend (React)
**Core Components:**
- Congressional leaderboard with search/filtering
- Member profile pages with funding breakdowns
- Bipartisan overlap visualization
- Article browsing and reading interface
- Markdown editor with @mention system

**Key Features:**
- Real-time data integration
- Responsive design for mobile/desktop
- Social sharing optimized for viral content
- Fast loading with edge caching

## Content Management System

### Article Creation Workflow
**Markdown WYSIWYG Editor:**
- Browser-based editor (TipTap or similar)
- Live preview with formatted text
- @mention autocomplete for Congress members
- Saves markdown files to GitHub repo
- Auto-deploys on commit

**@Mention System:**
- Type `@rep` → dropdown with autocomplete
- Search by name, state, party affiliation
- Auto-inserts correct member ID
- Live data injection on render
- Links to full member profiles

**Example:**
```markdown
@RepAOC consistently votes with her 87% grassroots funding profile,
while @SenManchin takes $2M from coal and votes accordingly.
```

### Authentication
**GitHub OAuth Integration:**
- Writers login with existing GitHub accounts
- Allowlist of approved contributors
- No password management needed
- Secure cookies via Cloudflare Worker
- Role-based access (writer, editor, admin)

### Content Types
**Manual Articles:**
- Evergreen explainers connecting theory to practice
- Investigation pieces following money trails
- Plain English breakdowns of complex issues

**Auto-Generated Updates:**
- Triggered by new FEC filings
- Major vote contradictions
- Tier changes and funding alerts
- Quarterly funding roundups

## Data Schema

### Member Records
```json
{
  "bioguideId": "O000172",
  "name": "Alexandria Ocasio-Cortez",
  "party": "D",
  "state": "NY",
  "district": "14",
  "chamber": "House",
  "totalRaised": 4892847,
  "grassrootsDonations": 4256776,
  "grassrootsPercent": 87,
  "pacMoney": 98234,
  "lobbyistMoney": 537837,
  "tier": "S",
  "bipartisanScore": 0.234,
  "topDonors": [...],
  "recentVotes": [...],
  "lastUpdated": "2025-01-15"
}
```

### Vote Records
```json
{
  "voteId": "h2025-123",
  "chamber": "house",
  "date": "2025-01-15",
  "bill": "HR-2847",
  "title": "Infrastructure Investment Act",
  "description": "Funding for roads, bridges, broadband",
  "result": "passed",
  "bipartisan": true,
  "memberVotes": {
    "O000172": "YES",
    "F000466": "YES"
  }
}
```

## API Endpoints

### External Data Sources (Government APIs)
```bash
# Congress.gov API (Requires API key from api.congress.gov/sign-up)
# Rate limit: 5,000 requests/hour
GET https://api.congress.gov/v3/member/congress/119?currentMember=true&api_key={key}

# OpenFEC API (Requires API key from api.data.gov)
# No official rate limits, but be respectful
GET https://api.open.fec.gov/v1/candidates/?api_key={key}&election_year=2024&office=H,S
GET https://api.open.fec.gov/v1/committees/{committee_id}/totals/?api_key={key}
GET https://api.open.fec.gov/v1/schedules/schedule_a/?api_key={key}&committee_id={id}&per_page=100
```

### Public API (Our Frontend Endpoints)
```
GET /api/members - All Congress members with tier info
GET /api/members/{bioguideId} - Detailed member profile
GET /api/votes/recent - Latest congressional votes (future feature)
GET /api/bipartisan - Issues with cross-party support
GET /api/tiers/{tier} - Members by tier ranking (S, A, B, C, D)
```

### Content API
```
GET /api/articles - Published articles
GET /api/articles/{slug} - Individual article
POST /api/articles - Create new article (auth required)
GET /api/members/search - Member autocomplete for @mentions
```

## Deployment & Development

### Local Development
```bash
# Clone repository
git clone [repo-url]
cd taskforcepurple

# Install dependencies
npm install

# Start development server
npm run dev

# Run data pipeline locally
npm run update-data
```

### Production Deployment
- **Automatic:** Git push to main branch triggers Cloudflare Pages build
- **Data Pipeline:** Scheduled Workers run automatically
- **Content:** Markdown files in repo auto-deploy
- **Configuration:** Environment variables in Cloudflare dashboard

### Environment Variables
```
# Required API Keys
CONGRESS_API_KEY=xxx          # From api.congress.gov/sign-up
FEC_API_KEY=xxx               # From api.data.gov
GITHUB_CLIENT_ID=xxx          # For OAuth authentication
GITHUB_CLIENT_SECRET=xxx      # For OAuth authentication

# Configuration
ALLOWED_WRITERS=username1,username2,username3
```

### API Key Setup Instructions
1. **Congress.gov API**: Register at https://api.congress.gov/sign-up
   - Rate limit: 5,000 requests/hour
   - Free access to all congressional data

2. **OpenFEC API**: Register at https://api.data.gov
   - No official rate limits (be respectful)
   - Free access to all campaign finance data

3. **GitHub OAuth**: Create OAuth app in GitHub Settings
   - For content management authentication
   - Required for article publishing system

## Data Limitations & Challenges

### Real-World API Constraints
**Data Update Frequency:**
- **FEC Data**: Updated nightly, quarterly filings create big updates
- **Congress.gov Data**: Members updated immediately, votes within hours
- **Grassroots Calculation**: Requires individual contribution records (large datasets)

**API Rate Limits:**
- Congress.gov: 5,000 requests/hour (sufficient for daily updates)
- OpenFEC: No official limits but large contribution datasets require pagination
- Total members ~535, so daily fetches well within limits

**Data Complexity:**
- Members may have multiple committees (principal campaign committee + PACs)
- Contribution records require aggregation to calculate grassroots percentage
- Committee linkage to specific candidates requires bioguideId matching

**MVP Simplifications:**
1. **Start with most recent quarterly filing** instead of real-time data
2. **Focus on principal campaign committees** initially (not all PACs)
3. **Manual member list updates** until automated pipeline is stable
4. **Batch processing** rather than real-time tier calculations

### ProPublica API Alternative
Since ProPublica Congress API was discontinued in 2024, we need alternatives for:
- **Voting Records**: Use Congress.gov API (house/senate roll call votes)
- **Lobbying Data**: Direct access to Senate Lobbying Database
- **Enhanced Data**: Stick to official government sources for MVP

## Content Strategy

### Launch Content
**Essential Explainers:**
1. "How to Read This Site" - Tutorial for tier system
2. "Reminder: They Work for You" - Public service fundamentals
3. "How Politics Became Pay-to-Win" - Campaign finance corruption explained
4. "The Enshittification of American Politics" - Three-stage decay pattern
5. "The Bipartisan Issues Nobody Talks About" - Overlap examples
6. "Following the Money: A Beginner's Guide" - How to read FEC data

### Ongoing Content
**Weekly Updates:**
- New funding alerts when quarterly reports drop
- Voting contradictions: money vs. public statements
- Tier changes and what they mean
- Bipartisan wins and rare unity moments

**Monthly Deep Dives:**
- Industry influence investigations using pay-to-win framework
- Political enshittification case studies (promises → money → betrayal)
- Academic theory connected to current events (Doctorow, Graeber)
- Cross-party corporate capture examples
- Public service failures and accountability gaps

## Success Metrics

### Engagement
- Monthly active users
- Social sharing rates
- Time spent on member profiles
- Article completion rates

### Impact
- Media citations of tier rankings
- Political discourse references
- Member responses to ratings
- Policy discussion quality improvement

### Technical
- API response times
- Data freshness
- Search functionality usage
- Mobile vs desktop usage

## Future Enhancements

### Phase 2 Features
- State and local politician tracking
- Judicial influence mapping
- Interactive data visualizations
- API for third-party integrations

### Advanced Content
- Predictive modeling for tier changes
- Industry influence score tracking
- Corporate network mapping
- Historical trend analysis

### Community Features
- User-submitted tip system
- Crowdsourced fact-checking
- Regional impact reporting
- Voter guide generation

## Implementation Priority

### MVP (Month 1)
1. Basic tier list with funding data
2. Member profiles with recent votes
3. Simple article system
4. Core data pipeline

### Enhancement (Month 2)
1. Bipartisan overlap tracker
2. @mention editor system
3. Auto-generated updates
4. Social sharing optimization

### Advanced (Month 3+)
1. Advanced search and filtering
2. Data visualization improvements
3. Mobile app consideration
4. API for external developers

## Technical Notes

### Rate Limiting
- FEC API: No official limits, but be respectful
- Congress.gov: Monitor for rate limiting
- ProPublica: 5000 requests/day limit
- Implement caching to minimize API calls

### Data Freshness
- Campaign finance: Updated quarterly (mandatory filing dates)
- Voting records: Updated within hours of votes
- Lobbying data: Updated quarterly
- Member information: Updated as needed

### Performance
- Cloudflare edge caching for static content
- KV storage for frequently accessed data
- Lazy loading for large datasets
- Progressive web app considerations

This specification provides the complete blueprint for building Task Force Purple as a transparency platform that cuts through political theater with real data and plain English explanations.