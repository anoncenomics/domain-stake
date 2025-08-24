import { activate } from '@autonomys/auto-utils';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[k.toUpperCase()] ?? d;
};

const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');
const DOMAIN_ID = Number(getArg('domain', '0'));

function fmtAmount(a){
  try { return BigInt(a.toString()).toString(); } catch { return a?.toString?.() ?? String(a); }
}

async function main(){
  console.log(`[connect] ${WS}`);
  const api = await activate({ rpcUrl: WS });

  console.log(`[subscribe] system events for domain ${DOMAIN_ID}`);
  await api.rpc.chain.subscribeFinalizedHeads(async (header)=>{
    const hash = await api.rpc.chain.getBlockHash(header.number.toNumber());
    const events = await (await api.at(hash)).query.system.events();
    for (const { event } of events){
      const sec = event.section;
      const meth = event.method;
      if (sec !== 'domains') continue;
      // Likely names to watch: FundsDeposited, FundsWithdrawn, Nominated, NominationWithdrawn, StakeDeposited, StakeWithdrawn, etc.
      if (/Deposit|Withdraw|Stake|Nomination/i.test(meth)){
        const data = event.toHuman?.() ?? event.data?.toJSON?.() ?? event.data;
        console.log(`[${header.number.toString()}] domains.${meth}`, JSON.stringify(data));
      }
    }
  });
}

main().catch(e => { console.error(e); process.exit(1); });


