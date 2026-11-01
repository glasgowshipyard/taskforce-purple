import { describe, expect, it } from 'vitest';
import { dropInvalidUtf8 } from './fara.mjs';

describe('dropInvalidUtf8', () => {
  it('leaves out the bytes that are not UTF-8 and keeps the rest', () => {
    // A Windows dash (0x97) and Latin-1 letters (0xCA, 0xC7), as in the DOJ's files
    const raw = Buffer.concat([
      Buffer.from('"Partisi '),
      Buffer.from([0x97]),
      Buffer.from(' Party","AG'),
      Buffer.from([0xca]),
      Buffer.from('NCIA","São Paulo"\n'),
    ]);
    expect(dropInvalidUtf8(raw)).toBe('"Partisi  Party","AGNCIA","São Paulo"\n');
  });
});
