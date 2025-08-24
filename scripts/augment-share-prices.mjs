import fs from 'node:fs';
import path from 'node:path';
import { activate } from '@autonomys/auto-utils';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[k.toUpperCase()] ?? d;
};

const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');
const IN = getArg('in', 'public/data/epochs.json');
const OUT = getArg('out', IN);

function ensureDir(p){ fs.mkdirSync(path.dirname(p), { recursive: true }); }

function toPerquintill(value){
  // value expected as decimal string of 1e18 scale
  return value;
}

async function main(){
  const text = fs.readFileSync(IN, 'utf8');
  const rows = JSON.parse(text);
  console.log(`[augment] rows=${rows.length} ws=${WS}`);
  const api = await activate({ rpcUrl: WS });

  let updated = 0;
  for (const row of rows){
    const { domainId, epoch, endBlock } = row;
    if (row.operatorSharePrices && Object.keys(row.operatorSharePrices).length){
      continue;
    }
    if (endBlock == null) continue;
    const hash = await api.rpc.chain.getBlockHash(endBlock);
    const atEnd = await api.at(hash);
    const entries = await atEnd.query.domains.operators.entries();
    const operatorIds = entries.map(([k]) => k.args[0].toNumber());
    const map = {};
    for (const opId of operatorIds){
      try {
        // Try storage first
        const opt = await atEnd.query.domains.operatorEpochSharePrice(domainId ?? 0, [opId, epoch]);
        if (opt && opt.isSome !== undefined) {
          if (opt.isSome) {
            map[String(opId)] = opt.unwrap().toString();
            continue;
          }
        } else if (opt) {
          map[String(opId)] = opt.toString();
          continue;
        }
        // Fallback: derive from operator at end block
        const oper = await atEnd.query.domains.operators(opId);
        if (oper && oper.isSome) {
          const v = oper.unwrap();
          const stake = v.currentTotalStake?.toString?.();
          const shares = v.currentTotalShares?.toString?.();
          if (stake && shares && shares !== '0'){
            // perquintill = floor(stake * 1e18 / shares)
            const p = (BigInt(stake) * 10n**18n) / BigInt(shares);
            map[String(opId)] = p.toString();
          }
        }
      } catch (e) {
        console.warn(`[op=${opId}]`, e?.message || e);
      }
    }
    if (Object.keys(map).length){
      row.operatorSharePrices = map;
      updated++;
    }
  }

  if (updated){
    ensureDir(OUT);
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
    console.log(`[write] ${OUT} • augmented rows=${updated}`);
  } else {
    console.log('[augment] no changes');
  }

  await api.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


