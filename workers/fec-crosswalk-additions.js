// FEC candidate IDs the congress-legislators source (fec-crosswalk.js, which
// is generated) doesn't list yet. Each is looked up at the FEC, never
// inferred from a name, and says where. Merged in by fec-identity.js.
export const FEC_CROSSWALK_ADDITIONS = {
  // Ashley Hinson's Senate candidacy. The FEC lists S6IA00314 with the same
  // principal campaign committee, C00706267, as her House ID H0IA01174 (FEC
  // candidate records, read 2026-10-11). Without it her campaign isn't
  // counted at all (owner's decision, 2026-10-11).
  H001091: ['S6IA00314'],
};
