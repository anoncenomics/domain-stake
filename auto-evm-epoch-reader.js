// Auto EVM Epoch Reader (SDK-first, binary-search for epoch boundaries)
// ------------------------------------------------------------
// What this does
// - Connects to Autonomys consensus (Subspace) RPC via Auto SDK
// - Uses domainStakingSummary(domainId) at historical block hashes
// - Binary-searches consensus blocks to find the *first* block of a target epoch
// - Produces:
//     • total stake at epoch start (snapshot)
//     • operator stakes at epoch start (snapshot)
//     • rewards per operator at epoch end (finalized for that epoch)
// - Defaults to domainId=0 (Auto EVM on mainnet) and the *current* epoch.
//
// Usage examples
//   node auto-evm-epoch-reader.mjs --ws wss://rpc.mainnet.subspace.foundation/ws
//   node auto-evm-epoch-reader.mjs --ws wss://rpc.mainnet.subspace.foundation/ws --epoch 2179
//   node auto-evm-epoch-reader.mjs --ws wss://rpc.mainnet.subspace.foundation/ws --domain 0 --epoch 2179 --verbose
//
// Notes
// - This avoids event-scanning entirely; it only queries storage snapshots at block hashes.
// - It relies on a monotonic epoch index in storage (currentEpochIndex) per domain.
// - Field names can evolve; we read conservatively and print strings for big numbers.
//
// ------------------------------------------------------------
import { activate } from '@autonomys/auto-utils';

// ------------------------------
// CLI helpers
// ------------------------------
const argv = process.argv.slice(2);
function getArg(name, def = undefined) {
  const i = argv.findIndex(a => a === `--${name}`);
  if (i !== -1 && argv[i+1] && !argv[i+1].startsWith('--')) return argv[i+1];
  return process.env[name.toUpperCase()] ?? def;
}
const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');
const DOMAIN_ID = Number(getArg('domain', '0')); // Auto EVM on mainnet = 0
const TARGET_EPOCH = getArg('epoch');
const VERBOSE = !!(argv.includes('--verbose') || process.env.VERBOSE);

function log(...args){ console.log(...args); }
function vlog(...args){ if(VERBOSE) console.log('[v]', ...args); }

// ------------------------------
// Helpers to read summary at a given consensus block number
// ------------------------------
async function readSummaryAtBlockNumber(api, domainId, blockNumber){
  const hash = await api.rpc.chain.getBlockHash(blockNumber);
  const at = await api.at(hash);
  const opt = await at.query.domains.domainStakingSummary(domainId);
  if (!opt || opt.isNone) return null;
  const sum = opt.unwrap();
  // Normalize fields gracefully across possible naming variants
  const epoch = sum.currentEpochIndex ?? sum.epochIndex ?? sum.epoch ?? null;
  const totalStake = sum.currentTotalStake ?? sum.totalStake ?? sum.total_stake ?? null;
  const operators = sum.currentOperators ?? sum.operators ?? null;
  const rewards = sum.currentEpochRewards ?? sum.epochRewards ?? null;
  return { hash, blockNumber, epoch, totalStake, operators, rewards, raw: sum };
}

async function readEpochIndexAt(api, domainId, blockNumber){
  const s = await readSummaryAtBlockNumber(api, domainId, blockNumber);
  if (!s) return null;
  // epoch may be a Compact<u32> or BN-like
  return typeof s.epoch?.toNumber === 'function' ? s.epoch.toNumber() : Number(s.epoch);
}

// ------------------------------
// Binary search for start block of a target epoch
// ------------------------------
async function findEpochStartBlock(api, domainId, targetEpoch){
  const latestHeader = await api.rpc.chain.getHeader();
  let lo = 1; // genesis+1 is fine
  let hi = latestHeader.number.toNumber();
  let ans = null;
  let steps = 0;

  // Guard: ensure targetEpoch exists (<= current epoch)
  const curEpoch = await readEpochIndexAt(api, domainId, hi);
  if (curEpoch === null) throw new Error('Could not read epoch index at head');
  if (targetEpoch > curEpoch){
    throw new Error(`Target epoch ${targetEpoch} > current epoch ${curEpoch}`);
  }

  while (lo < hi){
    steps++;
    const mid = Math.floor((lo + hi) / 2);
    const e = await readEpochIndexAt(api, domainId, mid);
    if (e === null){
      // If storage missing very early, advance lo
      lo = mid + 1;
      continue;
    }
    if (e >= targetEpoch){
      ans = mid; // candidate
      hi = mid;
    } else {
      lo = mid + 1;
    }
    if (VERBOSE && steps % 5 === 0) vlog(`[bs] step=${steps} mid=${mid} epoch@mid=${e} lo=${lo} hi=${hi}`);
  }

  // Verify
  const eLo = await readEpochIndexAt(api, domainId, lo);
  if (eLo !== targetEpoch){
    throw new Error(`Binary search failed to isolate epoch start (got epoch ${eLo} at block ${lo})`);
  }
  return lo;
}

async function getBlockHash(api, n){
  return (await api.rpc.chain.getBlockHash(n)).toString();
}

function mapToObjectLike(m){
  // Handle both BTreeMap-like structs and JS Maps/Objects
  if (!m) return {};
  const out = {};
  if (typeof m.entries === 'function'){
    for (const [k, v] of m.entries()){
      const kk = (k?.toNumber?.() ?? Number(k));
      out[kk] = v?.toString?.() ?? String(v);
    }
    return out;
  }
  // polkadot.js often exposes as object with numeric keys already
  try{
    const j = m.toJSON?.() ?? m;
    if (j && typeof j === 'object'){
      for (const [k, v] of Object.entries(j)) out[k] = typeof v === 'object' && v !== null && v.toString ? v.toString() : String(v);
    }
    return out;
  } catch{ return {}; }
}

// ------------------------------
// Main
// ------------------------------
(async () => {
  log(`[connect] ${WS}`);
  const api = await activate({ rpcUrl: WS });
  log(`[config] domainId = ${DOMAIN_ID} (Auto EVM on mainnet)`);

  // Determine target epoch (default = current)
  const head = await api.rpc.chain.getHeader();
  const headEpoch = await readEpochIndexAt(api, DOMAIN_ID, head.number.toNumber());
  if (headEpoch == null) throw new Error('Could not read current epoch at head');
  const epoch = TARGET_EPOCH ? Number(TARGET_EPOCH) : headEpoch;
  log(`[epoch] target = ${epoch} (current head epoch is ${headEpoch})`);

  // Find start of epoch and start of next epoch
  log('[search] locating epoch start via binary search…');
  const startBlock = await findEpochStartBlock(api, DOMAIN_ID, epoch);
  const startHash = await getBlockHash(api, startBlock);
  log(`[epoch] start block #${startBlock}  hash=${startHash}`);

  let endBlock = null, endHash = null;
  try {
    const nextStartBlock = await findEpochStartBlock(api, DOMAIN_ID, epoch + 1);
    endBlock = nextStartBlock - 1;
    endHash = await getBlockHash(api, endBlock);
    log(`[epoch] end block   #${endBlock}  hash=${endHash}`);
  } catch (e){
    // If the next epoch hasn't started yet, use head as provisional end
    endBlock = head.number.toNumber();
    endHash = head.hash.toString();
    log(`[epoch] next epoch not found; using head as provisional end #${endBlock} ${endHash}`);
  }

  // Read snapshots at start & end
  const startSummary = await readSummaryAtBlockNumber(api, DOMAIN_ID, startBlock);
  const endSummary   = await readSummaryAtBlockNumber(api, DOMAIN_ID, endBlock);

  log('\n=== Epoch Snapshot ===');
  log('epochIndex:', String(startSummary.epoch));
  log('startHash :', startSummary.hash.toString());
  log('endHash   :', endSummary.hash.toString());

  // Totals
  const totalStakeStr = startSummary.totalStake?.toString?.() ?? String(startSummary.totalStake);
  log('\nTotal Stake @ epoch start:', totalStakeStr);

  // Operator stakes (snapshot at start)
  const opStakes = mapToObjectLike(startSummary.operators);
  const opIds = Object.keys(opStakes).map(Number).sort((a,b)=>a-b);
  log('\nOperator stakes @ start:');
  if (!opIds.length) log('(none)');
  for (const id of opIds){
    log(`  operator ${id}: ${opStakes[id]}`);
  }

  // Rewards per operator (final values at end)
  const rewards = mapToObjectLike(endSummary.rewards);
  const rIds = Object.keys(rewards).map(Number).sort((a,b)=>a-b);
  log('\nOperator rewards for this epoch (final at end):');
  if (!rIds.length) log('(none / not available yet)');
  for (const id of rIds){
    log(`  operator ${id}: ${rewards[id]}`);
  }

  await api.disconnect();
})();
