import { activate } from '@autonomys/auto-utils';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[k.toUpperCase()] ?? d;
};

const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');
const LOOKBACK = Number(getArg('lookback', '300'));

const METHODS_DEPOSIT = new Set([
  'OperatorNominated',
  'StorageFeeDeposited'
]);
const METHODS_WITHDRAW = new Set([
  'WithdrewStake',
  'NominatorUnlocked',
  'NominatedStakedUnlocked'
]);

async function main(){
  const api = await activate({ rpcUrl: WS });
  const head = await api.rpc.chain.getHeader();
  const headNum = head.number.toNumber();
  const start = Math.max(1, headNum - LOOKBACK + 1);
  console.log(`[scan] ws=${WS} range=${start}..${headNum}`);
  let found = 0;
  for (let n = start; n <= headNum; n++){
    const hash = await api.rpc.chain.getBlockHash(n);
    const events = await (await api.at(hash)).query.system.events();
    for (const { event } of events){
      if (event.section !== 'domains') continue;
      const meth = event.method;
      if (!(METHODS_DEPOSIT.has(meth) || METHODS_WITHDRAW.has(meth))) continue;
      const dir = METHODS_DEPOSIT.has(meth) ? 'DEPOSIT' : 'WITHDRAW';
      const data = event.toHuman?.() ?? event.data?.toJSON?.() ?? event.data;
      console.log(`[${n}] ${dir} domains.${meth} ${JSON.stringify(data)}`);
      found++;
    }
  }
  console.log(`[scan] matches=${found}`);
  await api.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


