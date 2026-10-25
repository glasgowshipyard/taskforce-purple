import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  byPerson,
  fecDate,
  outsideSpending,
  parseCsv,
  registeredIds,
  unzipOne,
} from './outside.mjs';

const HEAD =
  'cand_id,cand_name,spe_id,spe_nam,ele_type,can_office_state,can_office_dis,can_office,cand_pty_aff,exp_amo,exp_date,agg_amo,sup_opp,pur,pay,file_num,amndt_ind,tran_id,image_num,receipt_dat,fec_election_yr,prev_file_num,dissem_dt';
const row = o => ({
  cand_id: 'S6TX00001',
  spe_id: 'C00000001',
  spe_nam: 'Real PAC',
  exp_amo: '1000',
  sup_opp: 'S',
  file_num: '1',
  amndt_ind: 'N',
  tran_id: 'SE.1',
  receipt_dat: '01-OCT-26',
  fec_election_yr: '2026',
  dissem_dt: '01-OCT-26',
  ...o,
});
const REGISTERED = new Set(['C00000001', 'C00000002']);

describe('outside spending (2026-10-25)', () => {
  it('reads the FEC file, quoted fields and all', () => {
    const rows = parseCsv(
      `${HEAD}\n"S6TX00001","DOE, JANE","C00000001","A ""Real"" PAC, Inc.","G","TX","00","S","","1000","","1000","S","TV","Ads Co","1","N","SE.1","","01-OCT-26","2026","","02-OCT-26"\n`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].spe_nam).toBe('A "Real" PAC, Inc.');
    expect(rows[0].cand_name).toBe('DOE, JANE');
    expect(fecDate('09-OCT-26')).toBe('2026-10-09');
    expect(fecDate('')).toBeNull();
  });

  it('opens the register, and leaves out filers who are not on it', () => {
    const text = 'C00000001|REAL PAC|\nC00000002|OTHER|\n';
    const data = deflateRawSync(Buffer.from(text));
    // A one-file zip: local header, data, central directory, end record
    const name = Buffer.from('cm.txt');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(0, 42);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt32LE(30 + name.length + data.length, 16);
    const zip = Buffer.concat([local, name, data, cd, name, end]);
    expect([...registeredIds(unzipOne(zip).toString())]).toEqual(['C00000001', 'C00000002']);

    const o = outsideSpending(
      [row({}), row({ spe_id: 'C00999999', spe_nam: 'TANKING', exp_amo: '9000000000' })],
      REGISTERED,
      2026
    );
    expect(o.candidates.S6TX00001.for).toBe(1000);
    expect(o.left).toEqual({ filers: 1, amount: 9000000000 });
  });

  it('counts an amended item once, at its newest version', () => {
    const o = outsideSpending(
      [
        row({ exp_amo: '1000' }),
        row({ exp_amo: '1500', amndt_ind: 'A1', file_num: '2', receipt_dat: '05-OCT-26' }),
        row({
          tran_id: 'SE.2',
          exp_amo: '200',
          sup_opp: 'O',
          spe_id: 'C00000002',
          spe_nam: 'Other',
        }),
      ],
      REGISTERED,
      2026
    );
    const c = o.candidates.S6TX00001;
    expect(c.for).toBe(1500);
    expect(c.against).toBe(200);
    expect(o.through).toBe('2026-10-05');
  });

  it('counts a 24-hour item restated in a later filing once, but two same-size buys in one filing twice', () => {
    const o = outsideSpending(
      [
        row({ tran_id: 'SE24.1', file_num: '1' }),
        row({ tran_id: 'SE.900', file_num: '2', receipt_dat: '15-OCT-26' }),
        row({ tran_id: 'SE24.2', file_num: '1' }),
      ],
      REGISTERED,
      2026
    );
    expect(o.candidates.S6TX00001.for).toBe(2000);
  });

  it('keeps to the cycle, and to items naming a candidate and a side', () => {
    const o = outsideSpending(
      [
        row({}),
        row({ tran_id: 'SE.2', fec_election_yr: '2024' }),
        row({ tran_id: 'SE.3', cand_id: '' }),
        row({ tran_id: 'SE.4', sup_opp: '' }),
      ],
      REGISTERED,
      2026
    );
    expect(o.candidates.S6TX00001.for).toBe(1000);
  });

  it("adds up a member's candidate IDs as one person, in whole dollars", () => {
    const o = outsideSpending(
      [
        row({ exp_amo: '100.4' }),
        row({ tran_id: 'SE.2', cand_id: 'H6TX00002', exp_amo: '200.4' }),
        row({ tran_id: 'SE.3', cand_id: 'H6CA00003', exp_amo: '50' }),
      ],
      REGISTERED,
      2026
    );
    const people = byPerson(o.candidates, { X000001: ['S6TX00001', 'H6TX00002'] }, ['H6CA00003']);
    expect(people.X000001.for).toBe(301);
    expect(people.X000001.spenders).toEqual([
      { id: 'C00000001', name: 'Real PAC', side: 'for', amount: 301 },
    ]);
    expect(people.H6CA00003.for).toBe(50);
  });
});
