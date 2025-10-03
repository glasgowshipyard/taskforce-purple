// Script to clear Chuck Grassley's financial data to force regeneration with new committee logic
const fs = require('fs');

// This will be run by wrangler to clear Chuck Grassley's financial data
async function clearGrassleyData(env) {
  const membersData = await env.MEMBER_DATA.get('members:all');
  if (!membersData) {
    console.log('No members data found');
    return;
  }

  const members = JSON.parse(membersData);

  // Find Chuck Grassley
  const grassleyIndex = members.members.findIndex(m => m.bioguideId === 'G000386');

  if (grassleyIndex === -1) {
    console.log('Chuck Grassley not found');
    return;
  }

  console.log(`Found Chuck Grassley at index ${grassleyIndex}`);
  console.log(`Current data: ${JSON.stringify(members.members[grassleyIndex], null, 2)}`);

  // Clear his financial data to force regeneration
  const grassley = members.members[grassleyIndex];
  delete grassley.totalRaised;
  delete grassley.grassrootsDonations;
  delete grassley.grassrootsPercent;
  delete grassley.pacMoney;
  delete grassley.partyMoney;
  delete grassley.pacContributions;
  delete grassley.committeeId;
  delete grassley.committeeInfo;
  delete grassley.tier;

  // Reset to basic state
  grassley.tier = 'N/A';

  console.log(`Cleared financial data for Chuck Grassley`);

  // Save back to storage
  await env.MEMBER_DATA.put('members:all', JSON.stringify(members));
  console.log('Updated members data saved');
}

export default {
  async fetch(request, env) {
    await clearGrassleyData(env);
    return new Response('Chuck Grassley financial data cleared');
  }
};