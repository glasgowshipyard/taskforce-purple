// FEC candidate IDs the congress-legislators source (fec-crosswalk.js, which
// is generated) doesn't list yet. Each is looked up at the FEC, never
// inferred from a name, and says where. Merged in by fec-identity.js.
export const FEC_CROSSWALK_ADDITIONS = {
  // Ashley Hinson's Senate candidacy. The FEC lists S6IA00314 with the same
  // principal campaign committee, C00706267, as her House ID H0IA01174 (FEC
  // candidate records, read 2026-10-11). Without it her campaign isn't
  // counted at all (owner's decision, 2026-10-11).
  H001091: ['S6IA00314'],
  // Darline Graham, appointed to the Senate for South Carolina in July 2026
  // and the Republican nominee there. The FEC lists S6SC04437, GRAHAM,
  // DARLINE, Senate, South Carolina, first filed 2026-07-23, with principal
  // campaign committee C00957308 DARLINE FOR SENATE (FEC candidate records,
  // read 2026-10-31). congress-legislators has no FEC ID for her yet, so
  // she showed UNVERIFIED with no grade
  G000608: ['S6SC04437'],
};

// Committees counted only from a date (owner, 2026-10-31): money a committee
// raised before the member became its sponsor isn't theirs. Its reports
// from then on, and its records, gifts and transfers dated from then.
// committee id -> { from (the first day of the first report counted), member }
export const COMMITTEE_SINCE = {
  // Fund for America's Future was Lindsey Graham's leadership PAC. Its
  // Form 1 amendment of 25 July 2026 (FEC filing 2002011) names Darline
  // Graham, appointed after his death, as its sponsor. Counted from its July
  // report (1 to 31 July, $11,002 raised), the first covering that day
  C00388934: { from: '2026-07-01', member: 'G000608' },
};
