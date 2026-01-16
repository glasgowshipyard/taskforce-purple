# Task Force Purple

A political transparency platform that cuts through partisan theater by tracking money in politics. Rate Congress members like video game characters based on funding integrity.

## Overview

Task Force Purple exposes how politicians from both parties often serve the same corporate interests while performing fake fights to distract voters. We make campaign finance data as accessible as checking sports stats.

### Core Features

- **Congressional Tier List**: S-D tier rankings based on grassroots funding percentage
- **Member Profiles**: Detailed funding breakdowns and voting records
- **Bipartisan Overlap Tracker**: Issues where red/blue actually converge
- **Auto-Updates**: Daily data refresh from government APIs

## Tier System

Rankings based on **individual funding %** (grassroots + itemized donations from people), with **coordination risk penalties** applied:

- **S Tier (85%+)**: Clean, people-funded representatives
- **A Tier (70-84%)**: Mostly grassroots with low coordination risk
- **B Tier (60-74%)**: Majority individual funded
- **C Tier (45-59%)**: Mixed sources, moderate coordination risk
- **D Tier (30-44%)**: PAC heavy or high donor coordination risk
- **E/F Tier (<30%)**: Corporate captured

### Dynamic Trust Anchor System

Not all itemized donations are equal. The system applies a **sliding threshold** based on donor coordination risk:

- **Movement-scale** (≥10% Nakamoto): 50% itemization limit - too many donors to coordinate
- **Standard** (5-10% Nakamoto): 40% limit - requires organization to coordinate
- **Elite capture** (<5% Nakamoto): 25% limit - donors fit in a country club
- **Dinner party** (<50 total donors): 10% limit - coordination trivial

**Quadratic penalty** (P = E²/20) applies for exceeding your specific limit, punishing structural capture harder than minor slips.

**Example**: Two members with 41% itemized funding:

- **12% Nakamoto** (1,500+ donors needed for 50%): Gets 50% limit → No penalty → S-tier
- **4% Nakamoto** (100 donors for 50%): Gets 25% limit → 16% excess → 12.8% penalty → A-tier

## Tech Stack

- **Frontend**: React (deployed on Cloudflare Pages)
- **Backend**: Cloudflare Workers (data pipeline, API endpoints)
- **Storage**: Cloudflare KV (processed member data)
- **Data Sources**: Congress.gov API, OpenFEC API

## Getting Started

### Local Development

```bash
# Clone repository
git clone https://github.com/glasgowshipyard/taskforce-purple.git
cd taskforce-purple

# Install dependencies
npm install

# Start development server
npm run dev
```

## Data Sources

### Government APIs (All Free)

- **Congress.gov API**: Current members, voting records
- **OpenFEC API**: Campaign finance data, contribution records
- **Rate Limits**: 5,000 requests/hour (Congress), no official limits (FEC)

### Data Pipeline

1. **Daily**: Fetch current member list from Congress.gov
2. **Weekly**: Pull latest FEC financial data for all committees
3. **Processing**: Calculate grassroots percentage from contributions <$200
4. **Storage**: Store processed tier rankings in Cloudflare KV

## Live Platform

Visit **https://taskforcepurple.pages.dev** to see the platform in action with real congressional data.

## Development

### Project Structure

```
/src
  /components     # React components
  /lib           # Utilities, API clients
  /data          # Mock data for development
/workers         # Cloudflare Workers
/docs           # Documentation
```

### Key Files

- `taskforce-purple.tsx`: Main React demo component
- `taskforce-purple.md`: Complete technical specification
- `/workers/data-pipeline.js`: Scheduled data fetching
- `/workers/api.js`: Backend API endpoints

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Philosophy

**The Problem**: Citizens are told they live in incompatible political camps, but corporate money influences both parties while manufactured culture wars distract from shared struggles.

**The Solution**: Evidence-based transparency tool that shows who actually serves people vs. money, regardless of party affiliation.

**Writing Tone**: Extremely plain English. Explain like talking to your neighbor. Connect theory to "here's who voted for what yesterday."

## License

MIT License - see LICENSE file for details

## Links

- **Live Site**: https://taskforcepurple.com (coming soon)
- **Specification**: [taskforce-purple.md](./taskforce-purple.md)
- **Demo Component**: [taskforce-purple.tsx](./taskforce-purple.tsx)
