## DomainStake — Auto EVM Epoch Staking & Rewards

A small Next.js app and script that read domain staking and operator rewards for Autonomys/Subspace Auto EVM (default domain 0) from a Substrate RPC and visualize them.

### What data is fetched and how

- **RPC connection (read‑only)**: Uses `@autonomys/auto-utils` to create a Substrate API instance (`activate({ rpcUrl })`). Default RPC is `wss://rpc.mainnet.subspace.foundation/ws`.
- **Core storage queried**: `domains.domainStakingSummary(DOMAIN_ID)` at a specific block using `api.at(blockHash)`. From this summary we read:
  - **epoch index**: `currentEpochIndex | epochIndex | epoch`
  - **total stake**: `currentTotalStake | totalStake`
  - **per‑operator stakes**: `currentOperators`
  - **per‑operator rewards (for the epoch)**: `currentEpochRewards`

#### Historical backfill (scripts/backfill-epochs.mjs)

1. Connect via `@autonomys/auto-utils`.
2. Determine the current epoch at chain head.
3. For each target epoch in the requested range, locate its start block using a **binary search over block numbers** that checks the epoch at `domains.domainStakingSummary` for midpoints.
4. Compute the epoch end block as `(next epoch start − 1)`. If the next epoch isn't yet discoverable, the script skips persisting that epoch to avoid partial data.
5. Read a snapshot at the start block (stake, operators) and at the end block (rewards), then write a row to `public/data/epochs.json`.

Notes:
- Only fully completed epochs are written. In‑progress epochs are intentionally skipped and will be filled on a later run.
- All large numeric values are saved as strings (decimal) to avoid precision loss.

#### Live mode (client UI)

- When toggled on, the browser subscribes to new heads and, on each block, reads `domains.domainStakingSummary(0)` at that block hash.
- The latest summary is merged into the in‑memory dataset for display. Live rows are not written to disk; only backfilled data is persisted.

### Data shape (public/data/epochs.json)

Each array element represents one completed epoch:

```json
{
  "domainId": 0,
  "epoch": 1234,
  "startBlock": 100000,
  "startHash": "0x...",
  "endBlock": 100999,
  "endHash": "0x...",
  "totalStake": "123456789000000000000000", // string (Shannons)
  "operatorStakes": { "0": "...", "1": "..." }, // strings (Shannons)
  "rewards": { "0": "...", "1": "..." } // strings (Shannons)
}
```

Operator IDs are keys as strings. Amounts are in Shannons (18 decimals). The UI can show values as Shannons or in AI3 with decimal conversion.

### What to expect

- **Deterministic, chain‑derived data**: All values are read directly from on‑chain storage at specific blocks.
- **Consistency**: Only completed epochs are persisted; you will never see partial rewards written to `epochs.json`.
- **Units**: JSON stores amounts as decimal strings in Shannons (1 AI3 = 10^18 Shannons). The UI provides a unit toggle and formats values accordingly.
- **Live overlay**: Live mode augments charts with the latest block data but does not persist it to disk.

### Running locally

Requirements: Node.js 18+

```bash
npm install
npm run dev
```

Visit http://localhost:3000 to view charts (they read `public/data/epochs.json`).

### Backfilling epochs

The backfill script reads historical epochs and writes `public/data/epochs.json`.

```bash
# Default: mainnet RPC, domain 0, from epoch 0 to current, append to existing file
npm run backfill

# Or run directly with custom flags
node scripts/backfill-epochs.mjs \
  --ws wss://rpc.mainnet.subspace.foundation/ws \
  --domain 0 \
  --from 0 \
  --to current \
  --append \
  --out public/data/epochs.json
```

Flags (env var equivalents in parentheses):
- `--ws` (`WS`): Substrate RPC websocket URL
- `--domain` (`DOMAIN`): Domain ID (default 0)
- `--from` (`FROM`): Start epoch (number) or `current`
- `--to` (`TO`): End epoch (number) or `current`
- `--append`: Append to existing output if present
- `--out` (`OUT`): Output JSON path

Examples:
```bash
# Backfill only the last 200 epochs for domain 0
HEAD=$(node -e "(async()=>{const {activate}=await import('@autonomys/auto-utils');const api=await activate({rpcUrl:'wss://rpc.mainnet.subspace.foundation/ws'});const h=await api.rpc.chain.getHeader();const e=(await (await api.at(await api.rpc.chain.getBlockHash(h.number.toNumber()))).query.domains.domainStakingSummary(0)).unwrap().currentEpochIndex.toNumber();console.log(e);await api.disconnect();})().catch(e=>{console.error(e);process.exit(1)})")
node scripts/backfill-epochs.mjs --from $((HEAD-199)) --to ${HEAD}

# Different domain
node scripts/backfill-epochs.mjs --domain 1 --from 0 --to current
```

### API endpoint

- `GET /api/epochs` serves the contents of `public/data/epochs.json` as `application/json`.

### Deployment

- Configured for Vercel. Static file `public/data/epochs.json` is bundled and served; you can update it by re‑running backfill and redeploying.

### Caveats & troubleshooting

- Long ranges can take time due to per‑epoch binary search, but it minimizes RPC load compared to scanning every block.
- If the RPC is unstable, rerun the backfill; the script persists after each completed epoch.
- Rewards are finalized at the epoch end block; do not expect them to be non‑zero earlier.
- This app is read‑only; it does not require keys or submit transactions.


