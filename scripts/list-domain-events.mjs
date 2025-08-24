import { activate } from '@autonomys/auto-utils';

const argv = process.argv.slice(2);
const getArg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return process.env[k.toUpperCase()] ?? d;
};

const WS = getArg('ws', 'wss://rpc.mainnet.subspace.foundation/ws');

async function main(){
  console.log(`[connect] ${WS}`);
  const api = await activate({ rpcUrl: WS });
  const section = api.events?.domains || {};
  const names = Object.keys(section);
  console.log(`[domains.events] count=${names.length}`);
  for (const name of names){
    try {
      const meta = section[name]?.meta;
      const docs = meta?.docs?.map(d => d.toString())?.join(' ') || '';
      console.log(`- ${name}: ${docs}`);
    } catch (e) {
      console.log(`- ${name}`);
    }
  }
  await api.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });


