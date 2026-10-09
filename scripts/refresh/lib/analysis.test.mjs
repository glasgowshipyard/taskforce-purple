// The donor analysis on a tiny made-up file: a firm registered as a foreign
// agent, one donor personally registered with it and one colleague who isn't
// (#60).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzePool, loadFara } from './analysis.mjs';
import { loadBulk } from './bulk.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tfp-analysis-'));
const row = (name, employer, amount, sub) =>
  [
    'C00000001',
    'N',
    'Q1',
    'P',
    '1',
    '15',
    'IND',
    name,
    'WASHINGTON',
    'DC',
    '20006',
    employer,
    'LAWYER',
    '01152026',
    String(amount),
    '',
    `T${sub}`,
    '1',
    '',
    '',
    String(sub),
  ].join('|');
writeFileSync(
  join(dir, 'itcont.txt'),
  [
    row('CHILDRESS, PATRICK J.', 'HOLLAND & KNIGHT', 3300, 1),
    row('SMITH, JANE', 'HOLLAND & KNIGHT', 1000, 2),
    row('DOE, JOHN', 'ACME CORP', 500, 3),
  ].join('\n')
);
writeFileSync(
  join(dir, 'shortforms.csv'),
  [
    '"Short Form Termination Date","Short Form Date","Short Form Last Name","Short Form First Name","Registration Number","Registration Date","Registrant Name","Address 1","Address 2","City","State","Zip"',
    '"","09/16/2026","Childress","Patrick","3718","08/07/1985","Holland & Knight","","","","",""',
    // Left the firm before the cycle: not counted
    '"03/01/2020","01/01/2019","Smith","Jane","3718","08/07/1985","Holland & Knight","","","","",""',
  ].join('\n')
);
writeFileSync(
  join(dir, 'principals.csv'),
  [
    '"Foreign Principal Termination Date","Foreign Principal","Foreign Principal Registration Date","Country/Location Represented","Registration Number","Registrant Date","Registrant Name","Address 1","Address 2","City","State","Zip"',
    '"","Embassy of Japan","05/08/2015","JAPAN","3718","08/07/1985","Holland & Knight","","","","",""',
    '"","Acme Shipping Ltd","01/01/2024","GREECE","3718","08/07/1985","Holland & Knight","","","","",""',
  ].join('\n')
);

describe('foreign-agent money (#60)', () => {
  it('tells a registered agent apart from a colleague at the same firm', async () => {
    const bulk = await loadBulk(join(dir, 'itcont.txt'), ['C00000001']);
    await loadFara(
      bulk,
      [
        {
          employer: 'HOLLAND & KNIGHT',
          fara_firm: 'Holland & Knight',
          registration_number: '3718',
        },
      ],
      { shortForms: join(dir, 'shortforms.csv'), principals: join(dir, 'principals.csv') },
      2026
    );
    const a = await analyzePool(bulk, ['C00000001'], { conduitName: async id => id });
    expect(a.faraEmployerTotal).toBe(4300);
    expect(a.faraAgentTotal).toBe(3300);
    const [firm] = a.faraFirms;
    expect(firm).toMatchObject({ name: 'Holland & Knight', amount: 4300, agentAmount: 3300 });
    expect(firm.agents).toEqual([{ name: 'PATRICK J. CHILDRESS', amount: 3300 }]);
    expect(firm.countries).toEqual(['GREECE', 'JAPAN']);
    expect(firm.clients).toEqual([
      { name: 'Acme Shipping Ltd', country: 'GREECE', government: false },
      { name: 'Embassy of Japan', country: 'JAPAN', government: true },
    ]);
  });
});
