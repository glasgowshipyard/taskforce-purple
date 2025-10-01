# Grassroots Calculation Reference

## Committee Types Considered Grassroots-Friendly

**Candidate Committees (P)**: 0.3x weight - candidate's own fundraising apparatus
**Personal/Candidate PACs (designation P)**: 0.15x weight - personal political committees
**Authorized Committees (designation A)**: 0.15x weight - authorized by candidate

## Committee Types Considered Concerning

**Super PACs (O)**: 2.0x weight - independent expenditure committees
**Leadership PACs (designation D)**: 1.5x weight - leadership influence
**Lobbyist PACs (designation B)**: 1.5x weight - lobbyist influence

## API Fields

- `grassrootsPercent`: Enhanced calculation (when PAC data available) or raw FEC data
- `rawFECGrassrootsPercent`: Original FEC percentage for reference
- `hasEnhancedData`: Boolean indicating enhanced calculation used
- `grassrootsPACTypes`: Array of grassroots-friendly PAC types for this member

## Frontend Display

For member profiles with enhanced data, show: "91% grassroots*"
*includes Candidate Committee

Footer should explain enhanced calculation accounts for committee type transparency weights.