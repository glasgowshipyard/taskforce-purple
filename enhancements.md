# Task Force Purple - Enhancement Roadmap

Practical improvements without over-engineering. The project works - these are targeted fixes.

---

## Quick Wins (Do These)

### 1. Fix Magic Numbers
**Problem:** Tier thresholds scattered everywhere  
**Location:** `workers/data-pipeline.js` (lines ~360-400)  
**Fix:** Add constants at top of file for tier thresholds and PAC weights  
**Time:** 5 minutes

### 2. Delete Old Demo Code
**Problem:** `taskforce-purple.tsx` still in repo but unused  
**Fix:** Delete orphaned demo files  
**Time:** 2 minutes

### 3. Show Transparency Penalty
**Problem:** Users don't know if Super PAC money affected tier  
**Location:** Member profile display  
**Fix:** Add 🚩 indicator when penalty applied  
**Time:** 15 minutes

---

## Medium Priority

### 4. Cache Committee Metadata
**Problem:** Repeatedly fetching same committee data  
**Location:** `fetchCommitteeMetadata()` function  
**Fix:** Store in KV for 7 days  
**Why:** Faster, fewer API calls

### 5. PAC Breakdown Display
**Problem:** Can't see what type of PACs funded member  
**Enhancement:** Show list with categories (Super PAC vs Candidate Committee)  
**Why:** Core mission is transparency about PAC types

### 6. Filter by Tier
**Problem:** Users want to see only S-tier or only D-tier  
**Fix:** Simple dropdown filter  
**Time:** 30 minutes

---

## Low Priority

### 7. CSV Export
Export full member list for analysis

### 8. Track Tier Changes
Show when members drop/rise between tiers

### 9. Basic Tests
Smoke tests for tier calculation

---

## Priority Order

**This Week:**
1. Fix magic numbers
2. Delete demo code  
3. Show penalty indicator

**This Month:**
4. Cache committee lookups
5. Tier filtering

**Eventually:**
6. PAC breakdowns
7. CSV export
8. Historical tracking

The codebase is clean and functional. These make it better without adding unnecessary complexity.