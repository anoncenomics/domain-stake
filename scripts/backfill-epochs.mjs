import fs from 'node:fs';
import path from 'node:path';
import { activate } from '@autonomys/auto-utils';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i !== -1 && argv[i+1] && !argv[i+1].startsWith('--')) return argv[i+1];
  return process.env[k.toUpperCase()] ?? d;
};

const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');
const DOMAIN_ID = Number(getArg('domain', '0'));
const FROM = getArg('from');
const TO = getArg('to', 'current');
const APPEND = argv.includes('--append');
const OUT = getArg('out', 'public/data/epochs.json');

function ensureDir(p){ fs.mkdirSync(path.dirname(p), { recursive: true }); }
function mapToObj(m){
  if (!m) return {};
  const out = {};
  try {
    if (typeof m.entries === 'function'){
      for (const [k, v] of m.entries()){
        const kk = (k?.toNumber?.() ?? Number(k));
        out[kk] = v?.toString?.() ?? String(v);
      }
      return out;
    }
    const j = m.toJSON?.() ?? m;
    if (j && typeof j === 'object'){
      for (const [k, v] of Object.entries(j)){
        if (v && typeof v === 'object' && typeof v.toString === 'function'){
          out[k] = v.toString();
        } else if (typeof v === 'string' && v.startsWith('0x')){
          // hex -> decimal string
          out[k] = BigInt(v).toString();
        } else {
          out[k] = String(v);
        }
      }
      return out;
    }
  } catch {}
  return out;
}

async function readSummaryAt(api, blockNumber){
  const hash = await api.rpc.chain.getBlockHash(blockNumber);
  const at = await api.at(hash);
  const opt = await at.query.domains.domainStakingSummary(DOMAIN_ID);
  if (!opt || opt.isNone) return null;
  const s = opt.unwrap();
  const epoch = s.currentEpochIndex ?? s.epochIndex ?? s.epoch;
  return {
    blockNumber,
    hash: hash.toString(),
    epoch: typeof epoch?.toNumber === 'function' ? epoch.toNumber() : Number(epoch),
    totalStake: (s.currentTotalStake ?? s.totalStake)?.toString?.() ?? null,
    operatorStakes: mapToObj(s.currentOperators),
    rewards: mapToObj(s.currentEpochRewards)
  };
}

async function epochAt(api, blockNumber){
  const sum = await readSummaryAt(api, blockNumber);
  return sum?.epoch ?? null;
}

async function findEpochStartBlock(api, targetEpoch){
  const head = await api.rpc.chain.getHeader();
  let lo = 1, hi = head.number.toNumber(), ans = null;
  const cur = await epochAt(api, hi);
  if (cur == null) throw new Error('Cannot read epoch at head');
  if (targetEpoch > cur) throw new Error(`target epoch ${targetEpoch} > current ${cur}`);
  while (lo < hi){
    const mid = Math.floor((lo + hi)/2);
    const e = await epochAt(api, mid);
    if (e == null){ lo = mid + 1; continue; }
    if (e >= targetEpoch){ ans = mid; hi = mid; } else { lo = mid + 1; }
  }
  const eLo = await epochAt(api, lo);
  if (eLo !== targetEpoch) throw new Error(`Failed to locate start: epoch@${lo}=${eLo}`);
  return lo;
}

async function main(){
  console.log(`[connect] ${WS}`);
  const api = await activate({ rpcUrl: WS });
  console.log(`[config] domain=${DOMAIN_ID}`);

  const head = await api.rpc.chain.getHeader();
  const headEpoch = await epochAt(api, head.number.toNumber());
  if (headEpoch == null) throw new Error('Cannot read current epoch');

  const startEpoch = FROM === 'current' ? headEpoch : Number(FROM ?? 0);
  const endEpoch   = TO === 'current' ? headEpoch : Number(TO);

  console.log(`[range] epochs ${startEpoch}…${endEpoch}`);

  let existing = [];
  if (APPEND && fs.existsSync(OUT)){
    existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  }

  const rows = [...existing];
  let lastWrittenLength = rows.length;

  for (let ep = startEpoch; ep <= endEpoch; ep++){
    console.log(`[epoch] ${ep}`);
    const startBlock = await findEpochStartBlock(api, ep);
    let endBlock;
    let hasConfirmedEnd = true;
    try {
      const nextStart = await findEpochStartBlock(api, ep + 1);
      endBlock = nextStart - 1;
    } catch {
      // If the next epoch start is not yet discoverable, this epoch is still in progress.
      // Skip writing a provisional row to avoid incomplete rewards being persisted.
      hasConfirmedEnd = false;
      console.log(`[skip] epoch ${ep} has no confirmed end block yet; will retry on next run`);
    }

    if (!hasConfirmedEnd){
      // Do not persist incomplete epoch rows
      if (rows.length > lastWrittenLength){
        ensureDir(OUT);
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
        console.log(`[write] ${OUT} • count=${rows.length}`);
        lastWrittenLength = rows.length;
      }
      continue;
    }

    const startSnap = await readSummaryAt(api, startBlock);
    const endSnap   = await readSummaryAt(api, endBlock);

    rows.push({
      domainId: DOMAIN_ID,
      epoch: ep,
      startBlock,
      startHash: startSnap?.hash,
      endBlock,
      endHash: endSnap?.hash,
      totalStake: startSnap?.totalStake,
      operatorStakes: startSnap?.operatorStakes,
      rewards: endSnap?.rewards
    });

    // Persist after each completed epoch to avoid losing progress
    ensureDir(OUT);
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
    console.log(`[write] ${OUT} • count=${rows.length}`);
    lastWrittenLength = rows.length;
  }

  if (rows.length > lastWrittenLength){
    ensureDir(OUT);
    fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
    console.log(`[write] ${OUT} • count=${rows.length}`);
  }

  await api.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


