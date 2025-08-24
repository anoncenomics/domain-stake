import { activate } from '@autonomys/auto-utils';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[k.toUpperCase()] ?? d;
};

const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');
const DOMAIN_ID = Number(getArg('domain', '0'));
const PAGE_SIZE = Number(getArg('pageSize', '5'));

function toDecimalPerquintill(v) {
  try {
    const s = v?.toString?.();
    if (!s) return null;
    // Perquintill denominator = 10^18
    const pad = s.padStart(19, '0');
    const int = pad.slice(0, pad.length - 18).replace(/^0+(?=\d)/, '');
    const frac = pad.slice(-18).replace(/0+$/, '');
    return frac.length ? `${int}.${frac}` : int;
  } catch {
    return null;
  }
}

async function epochAt(api, blockNumber) {
  const hash = await api.rpc.chain.getBlockHash(blockNumber);
  const at = await api.at(hash);
  const opt = await at.query.domains.domainStakingSummary(DOMAIN_ID);
  if (!opt || opt.isNone) return null;
  const s = opt.unwrap();
  const epoch = s.currentEpochIndex ?? s.epochIndex ?? s.epoch;
  return typeof epoch?.toNumber === 'function' ? epoch.toNumber() : Number(epoch);
}

async function findEpochStartBlock(api, targetEpoch) {
  const head = await api.rpc.chain.getHeader();
  let lo = 1, hi = head.number.toNumber();
  let ans = null;
  const cur = await epochAt(api, hi);
  if (cur == null) throw new Error('Cannot read epoch at head');
  if (targetEpoch > cur) throw new Error(`target epoch ${targetEpoch} > current ${cur}`);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const e = await epochAt(api, mid);
    if (e == null) { lo = mid + 1; continue; }
    if (e >= targetEpoch) { ans = mid; hi = mid; } else { lo = mid + 1; }
  }
  const eLo = await epochAt(api, lo);
  if (eLo !== targetEpoch) throw new Error(`Failed to locate start: epoch@${lo}=${eLo}`);
  return lo;
}

async function main() {
  console.log(`[connect] ${WS}`);
  const api = await activate({ rpcUrl: WS });

  // Basic metadata printouts
  const opEpochSP = api.query?.domains?.operatorEpochSharePrice;
  const opMap = api.query?.domains?.operators;

  try {
    const meta = opEpochSP?.creator?.meta ?? opEpochSP?.meta;
    console.log('[operatorEpochSharePrice.meta.exists]', !!meta);
    if (meta) {
      try { console.log('[operatorEpochSharePrice.docs]', meta.docs.map(d => d.toString()).join('\n')); } catch {}
      try { console.log('[operatorEpochSharePrice.type]', meta.type.toString()); } catch {}
    }
  } catch (e) {
    console.warn('[meta.error]', e?.message || e);
  }

  // Sample keys (paged) for operatorEpochSharePrice
  try {
    const keys = await opEpochSP.keysPaged({ args: [], pageSize: PAGE_SIZE });
    console.log('[operatorEpochSharePrice.keysPaged.count]', keys.length);
    for (let i = 0; i < keys.length; i++) {
      const args = keys[i].args.map(a => a.toString());
      console.log(`[operatorEpochSharePrice.key.${i}.args]`, args);
    }
    if (keys.length > 0) {
      const sampleArgs = keys[0].args;
      const val = await opEpochSP(...sampleArgs);
      console.log('[operatorEpochSharePrice.sample.value]', val?.toString?.());
      console.log('[operatorEpochSharePrice.sample.value.decimal]', toDecimalPerquintill(val));
    }
  } catch (e) {
    console.warn('[operatorEpochSharePrice.keysPaged.error]', e?.message || e);
  }

  // Sample operators entries
  try {
    const entries = await opMap.entriesPaged({ args: [], pageSize: PAGE_SIZE });
    console.log('[operators.entriesPaged.count]', entries.length);
    for (let i = 0; i < entries.length; i++) {
      const [k, v] = entries[i];
      const id = k.args[0].toString();
      const human = v.toHuman?.();
      console.log(`[operator.${i}.id]`, id);
      console.log(`[operator.${i}.fields]`, Object.keys(human || {}));
    }
  } catch (e) {
    console.warn('[operators.entriesPaged.error]', e?.message || e);
  }

  // Probe at a recent epoch end
  try {
    const head = await api.rpc.chain.getHeader();
    const headEpoch = await epochAt(api, head.number.toNumber());
    console.log('[epoch.head.index]', headEpoch);
    const targetEpoch = Math.max(0, (headEpoch ?? 1) - 1);
    const startBlock = await findEpochStartBlock(api, targetEpoch);
    const nextStart = await findEpochStartBlock(api, targetEpoch + 1);
    const endBlock = nextStart - 1;
    const endHash = await api.rpc.chain.getBlockHash(endBlock);
    console.log('[epoch.target]', { targetEpoch, startBlock, endBlock, endHash: endHash.toString() });

    const atEnd = await api.at(endHash);
    // Reuse a sample key to fetch the value at endHash
    try {
      const keys = await opEpochSP.keysPaged({ args: [], pageSize: 1, at: endHash });
      if (keys.length > 0) {
        const sampleArgs = keys[0].args;
        const valAtEnd = await atEnd.query.domains.operatorEpochSharePrice(...sampleArgs);
        console.log('[operatorEpochSharePrice.sample.atEnd]', valAtEnd?.toString?.());
        console.log('[operatorEpochSharePrice.sample.atEnd.decimal]', toDecimalPerquintill(valAtEnd));
      } else {
        console.log('[operatorEpochSharePrice.keysPaged.atEnd] none');
      }
    } catch (e) {
      console.warn('[operatorEpochSharePrice.atEnd.error]', e?.message || e);
    }

    // Fetch for each discovered operator id at the target epoch
    try {
      const opEntries = await atEnd.query.domains.operators.entries();
      const operatorIds = opEntries.map(([k]) => k.args[0].toNumber());
      console.log('[operators.atEnd.ids]', operatorIds);
      for (const operatorId of operatorIds) {
        try {
          const p = await atEnd.query.domains.operatorEpochSharePrice(DOMAIN_ID, [operatorId, targetEpoch]);
          const present = p && p.isSome !== undefined ? p.isSome : true;
          const raw = p?.toString?.();
          const dec = toDecimalPerquintill(p);
          console.log(`[sharePrice.op=${operatorId}.epoch=${targetEpoch}] present=${present} raw=${raw} dec=${dec}`);
        } catch (e) {
          console.warn(`[sharePrice.error.op=${operatorId}]`, e?.message || e);
        }
      }
    } catch (e) {
      console.warn('[operators.ids.atEnd.error]', e?.message || e);
    }
  } catch (e) {
    console.warn('[epoch.probe.error]', e?.message || e);
  }

  await api.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


