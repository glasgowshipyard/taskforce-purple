// The records the job fetched from the FEC because the bulk file lacks them
// (gap fills and earmarked gifts), stored in D1 `gap_packs` (2026-10-06,
// owner's choice: full records, compressed).
//
// Each record is kept exactly as the FEC's API returned it, so anything in it
// can be looked at later. A committee's records are packed together, up to
// PACK_SIZE per row, as Brotli-compressed JSON (base64): about 50 bytes per
// record instead of about 4,000. Until 2026-10-06 each record was its own
// uncompressed row in `gap_records`, which filled D1's 500 MB.
//
// Only the refresh job reads these. `node scripts/refresh/gap-records.mjs`
// unpacks a committee's records for a person to look at.

import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

export const PACK_SIZE = 5000;
const KINDS = ['gap', 'earmarked'];

export function packRecords(records) {
  const packs = [];
  for (let i = 0; i < records.length; i += PACK_SIZE) {
    const slice = records.slice(i, i + PACK_SIZE);
    const data = brotliCompressSync(JSON.stringify(slice), {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 9,
        [constants.BROTLI_PARAM_LGWIN]: 24,
      },
    }).toString('base64');
    packs.push({ pack: packs.length, records: slice.length, data });
  }
  return packs;
}

export function unpackRecords(data) {
  return JSON.parse(brotliDecompressSync(Buffer.from(data, 'base64')).toString('utf8'));
}

/** A committee's stored records for the cycle: { gap: [...], earmarked: [...] }. */
export async function loadStored(d1, committeeId, cycle) {
  const rows = await d1(
    'SELECT kind, pack, data FROM gap_packs WHERE committee_id = ? AND cycle = ? ORDER BY kind, pack',
    [committeeId, cycle]
  );
  const out = { gap: [], earmarked: [] };
  for (const r of rows) {
    out[r.kind].push(...unpackRecords(r.data));
  }
  return out;
}

/**
 * Replace a committee's stored records with `stored` ({gap, earmarked}),
 * writing only the packs whose contents changed and removing packs no longer
 * needed. Returns the number of pack rows written or removed.
 */
export async function saveStored(d1, committeeId, cycle, stored) {
  const existing = new Map(
    (
      await d1(
        'SELECT kind, pack, records, data FROM gap_packs WHERE committee_id = ? AND cycle = ?',
        [committeeId, cycle]
      )
    ).map(r => [`${r.kind}:${r.pack}`, r])
  );
  const now = new Date().toISOString();
  let changes = 0;
  for (const kind of KINDS) {
    // Sorted by FEC record ID, so the same records always pack the same way
    const records = [...(stored[kind] || [])].sort((a, b) =>
      String(a.sub_id).localeCompare(String(b.sub_id))
    );
    const packs = packRecords(records);
    for (const p of packs) {
      const old = existing.get(`${kind}:${p.pack}`);
      existing.delete(`${kind}:${p.pack}`);
      if (old && old.data === p.data) {
        continue;
      }
      await d1(
        `INSERT INTO gap_packs (committee_id, cycle, kind, pack, records, data, saved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(committee_id, cycle, kind, pack) DO UPDATE SET records = excluded.records,
           data = excluded.data, saved_at = excluded.saved_at`,
        [committeeId, cycle, kind, p.pack, p.records, p.data, now]
      );
      changes++;
    }
  }
  for (const old of existing.values()) {
    await d1(
      'DELETE FROM gap_packs WHERE committee_id = ? AND cycle = ? AND kind = ? AND pack = ?',
      [committeeId, cycle, old.kind, old.pack]
    );
    changes++;
  }
  return changes;
}
