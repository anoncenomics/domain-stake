'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Bar, Brush } from 'recharts';

function useEpochs(){
  const [data, setData] = useState<any[]>([]);
  useEffect(() => { fetch('/data/epochs.json').then(r=>r.json()).then(setData).catch(()=>setData([])); }, []);
  return data;
}

function formatBig(x?: string){
  if (!x) return '';
  try {
    const n = BigInt(x);
    // format with thousands separators only, no suffixes
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  } catch {
    return String(x);
  }
}

function insertThousandsSeparators(intStr: string){
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pow10BigInt(exp: number){
  let result = BigInt(1);
  for (let i = 0; i < exp; i++) result *= BigInt(10);
  return result;
}

function formatTokensFromShannons(x?: string, fractionDigits = 3){
  if (!x) return '';
  try {
    const value = BigInt(x);
    const base = pow10BigInt(18);
    const integer = value / base;
    const remainder = value % base;
    const scale = pow10BigInt(fractionDigits);
    // round half up
    let fractional = (remainder * scale + base / BigInt(2)) / base;
    let carry = BigInt(0);
    const limit = scale;
    if (fractional >= limit) { fractional -= limit; carry = BigInt(1); }
    const intStr = insertThousandsSeparators((integer + carry).toString());
    const fracStr = fractional.toString().padStart(fractionDigits, '0');
    return `${intStr}.${fracStr}`;
  } catch {
    return '';
  }
}

function tokensPlainFromShannons(x?: string, fractionDigits = 3){
  if (!x) return '';
  try {
    const value = BigInt(x);
    const base = pow10BigInt(18);
    const integer = value / base;
    const remainder = value % base;
    const scale = pow10BigInt(fractionDigits);
    // round half up
    let fractional = (remainder * scale + base / BigInt(2)) / base;
    let carry = BigInt(0);
    const limit = scale;
    if (fractional >= limit) { fractional -= limit; carry = BigInt(1); }
    const intStr = (integer + carry).toString();
    const fracStr = fractional.toString().padStart(fractionDigits, '0');
    return `${intStr}.${fracStr}`;
  } catch {
    return '';
  }
}

function tokensNumberFromShannons(x?: string, fractionDigits = 6){
  const plain = tokensPlainFromShannons(x, fractionDigits);
  return plain ? parseFloat(plain) : 0;
}

function formatAmount(x: string | undefined, unit: 'AI3' | 'Shannons'){
  return unit === 'AI3' ? formatTokensFromShannons(x, 3) : formatBig(x);
}

function formatRewardsAmount(x: string | undefined, unit: 'AI3' | 'Shannons'){
  return unit === 'AI3' ? formatTokensFromShannons(x, 6) : formatBig(x);
}

function formatTokensIntegerFromShannons(x?: string){
  if (!x) return '';
  try {
    const value = BigInt(x);
    const base = pow10BigInt(18);
    const integer = value / base;
    return insertThousandsSeparators(integer.toString());
  } catch {
    return '';
  }
}

function formatYAxisTick(v: number, unit: 'AI3' | 'Shannons'){
  if (unit === 'Shannons'){
    if (!Number.isFinite(v)) return '';
    if (v === 0) return '0';
    // Reduce mantissa decimals as much as reasonable (trim trailing zeros)
    const str = Number(v).toExponential(3).replace('e+', 'e');
    const [mantissa, exp] = str.split('e');
    let m = mantissa;
    if (m.includes('.')){
      m = m.replace(/0+$/, ''); // drop trailing zeros
      m = m.replace(/\.$/, ''); // drop trailing dot if any
    }
    return `${m}e${exp}`;
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(v);
}

function formatTooltipNumber(v: number, unit: 'AI3' | 'Shannons', kind: 'stake' | 'rewards'){
  if (kind === 'stake'){
    // Whole numbers for stake
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  }
  // Rewards: adaptive 3-7 significant non-zero decimals for AI3, plain for Shannons
  if (unit === 'Shannons'){
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
  }
  // AI3 rewards
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  // Determine decimals: at least 3, at most 7, but extend until 3 non-zero decimals or cap
  let decimals = 3;
  const toFixedAt = (d: number) => Number(v).toFixed(d);
  if (abs > 0){
    for (let d = 3; d <= 7; d++){
      const s = toFixedAt(d);
      const frac = s.split('.')[1] || '';
      const nonZero = (frac.match(/[^0]/g) || []).length;
      if (nonZero >= 3 || d === 7){
        decimals = d;
        break;
      }
    }
  }
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

class ChartErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; errorMsg?: string }>{
  constructor(props: any){
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any){
    return { hasError: true, errorMsg: error?.message || String(error) };
  }
  componentDidCatch(error: any, info: any){
    try { console.error('Chart render error', error, info); } catch {}
  }
  render(){
    if (this.state.hasError){
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '256px', color: '#EF4444', background: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: 12 }}>
          <span style={{ fontSize: 12 }}>Chart failed to render. Try changing settings or reloading.</span>
        </div>
      );
    }
    return this.props.children as any;
  }
}

function StatCard({ label, value, live = false }: { label: string; value: string | number; live?: boolean }){
  const [hover, setHover] = useState(false);
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} style={{ background: 'white', borderRadius: '16px', border: '1px solid #e5e7eb', boxShadow: hover ? '0 8px 24px rgba(0,0,0,0.12)' : '0 2px 10px rgba(0,0,0,0.08)', padding: '18px', transition: 'box-shadow 0.2s ease, transform 0.2s ease', transform: hover ? 'translateY(-1px)' : 'none' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>
        {label}
        {live && <span title="Live" style={{ width: 6, height: 6, borderRadius: 9999, background: '#10B981', display: 'inline-block' }} />}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700 }}>{String(value)}</div>
    </div>
  );
}

export default function Dashboard(){
  const rows = useEpochs();

  const [isLive, setIsLive] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [liveRow, setLiveRow] = useState<any | null>(null);
  const [lastLiveAt, setLastLiveAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  function mapToObj(m: any){
    if (!m) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    try {
      if (typeof m.entries === 'function'){
        for (const [k, v] of m.entries()){
          const kk = (k?.toNumber?.() ?? Number(k)) as any;
          out[String(kk)] = v?.toString?.() ?? String(v);
        }
        return out;
      }
      const j = m.toJSON?.() ?? m;
      if (j && typeof j === 'object'){
        for (const [k, v] of Object.entries(j as any)){
          if (v && typeof v === 'object' && typeof (v as any).toString === 'function'){
            out[k] = (v as any).toString();
          } else if (typeof v === 'string' && v.startsWith('0x')){
            try { out[k] = BigInt(v as string).toString(); } catch { out[k] = String(v); }
          } else {
            out[k] = String(v);
          }
        }
        return out;
      }
    } catch {}
    return out;
  }

  useEffect(() => {
    if (!isLive) return;
    let unsub: any;
    let apiRef: any = null;
    let disconnected = false;
    setLiveStatus('connecting');
    (async () => {
      try {
        const mod = await import('@autonomys/auto-utils');
        const api = await (mod as any).activate({ rpcUrl: 'wss://rpc.mainnet.subspace.foundation/ws' } as any);
        apiRef = api;
        if (disconnected) { try { await api.disconnect(); } catch {} return; }
        setLiveStatus('live');
        unsub = await (api as any).rpc.chain.subscribeNewHeads(async (header: any) => {
          try {
            const blockNumber = header.number.toNumber();
            const hash = await (api as any).rpc.chain.getBlockHash(blockNumber);
            const at = await (api as any).at(hash);
            const opt = await (at as any).query.domains.domainStakingSummary(0);
            if (!opt || opt.isNone) return;
            const s = opt.unwrap();
            const epochRaw = s.currentEpochIndex ?? s.epochIndex ?? s.epoch;
            const epoch = typeof epochRaw?.toNumber === 'function' ? epochRaw.toNumber() : Number(epochRaw);
            const totalStake = (s.currentTotalStake ?? s.totalStake)?.toString?.() ?? null;
            const operatorStakes = mapToObj(s.currentOperators);
            const rewards = mapToObj(s.currentEpochRewards);
            setLiveRow({
              domainId: 0,
              epoch,
              startBlock: undefined,
              endBlock: blockNumber,
              startHash: undefined,
              endHash: hash.toString(),
              totalStake,
              operatorStakes,
              rewards
            });
            setLastLiveAt(Date.now());
          } catch {}
        });
      } catch (e) {
        setLiveStatus('error');
      }
    })();
    return () => {
      disconnected = true;
      try { if (typeof unsub === 'function') unsub(); } catch {}
      try { if (apiRef && typeof apiRef.disconnect === 'function') apiRef.disconnect(); } catch {}
    };
  }, [isLive]);

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const mergedRows = useMemo(() => {
    const base = Array.isArray(rows) ? rows.slice() : [];
    if (!liveRow) return base;
    const last = base[base.length - 1];
    if (!last) return [liveRow];
    if (liveRow.epoch > last.epoch) return [...base, liveRow];
    if (liveRow.epoch === last.epoch) {
      const copy = base.slice();
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...liveRow };
      return copy;
    }
    return base;
  }, [rows, liveRow]);

  const [unit, setUnit] = useState<'AI3' | 'Shannons'>('AI3');

  const isSummaryLive = useMemo(() => Boolean(isLive && liveRow), [isLive, liveRow]);

  const baseRows = useMemo(() => mergedRows.map((r: any) => ({
    epoch: r.epoch,
    startBlock: r.startBlock,
    endBlock: r.endBlock,
    totalStake: String(r.totalStake ?? '0'),
    operatorStakes: r.operatorStakes ?? {},
    rewards: r.rewards ?? {}
  })), [mergedRows]);

  const summary = useMemo(() => {
    const last: any = mergedRows[mergedRows.length - 1];
    if (!last) {
      return { lastEpoch: '-', totalStake: '-', operators: '-', rewardsTotal: '-' } as const;
    }
    const operators = Object.keys(last.operatorStakes ?? {}).length;
    const rewardsTotalBig = Object.values(last.rewards ?? {}).reduce((acc: bigint, v: any) => {
      try { return acc + BigInt(v as any); } catch { return acc; }
    }, BigInt(0));
    return {
      lastEpoch: last.epoch,
      totalStake: unit === 'AI3' ? formatTokensIntegerFromShannons(last.totalStake) : formatAmount(last.totalStake, unit),
      operators,
      rewardsTotal: formatRewardsAmount(rewardsTotalBig.toString(), unit)
    } as const;
  }, [mergedRows, unit]);

  const [range, setRange] = useState<'50' | '200' | 'All'>('200');
  const [showOp0, setShowOp0] = useState(true);
  const [showOp1, setShowOp1] = useState(true);
  const [stakeScale, setStakeScale] = useState<'auto' | 'fit' | 'log'>('auto');
  const [rewardsScale, setRewardsScale] = useState<'auto' | 'fit' | 'log'>('log');

  const [brush, setBrush] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [hoverStake, setHoverStake] = useState(false);
  const [hoverRewards, setHoverRewards] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const microFont = isMobile ? 10 : 11;
  const segPad = isMobile ? '4px 8px' : '6px 10px';
  const chartHeight = isMobile ? 220 : 256;
  const chartPadding = isMobile ? '16px' : '24px';

  const COLORS = {
    total: '#111827',
    op0: '#60A5FA',
    op1: '#F59E0B'
  } as const;

  const displayRows = useMemo(() => {
    if (range === 'All') return baseRows;
    const n = range === '50' ? 50 : 200;
    return baseRows.slice(-n);
  }, [baseRows, range]);

  const chartRows = useMemo(() => {
    const arr = displayRows;
    if (range === 'All' && arr.length > 1000) {
      const step = Math.ceil(arr.length / 1000);
      const sampled = arr.filter((_, i) => i % step === 0);
      if (sampled[sampled.length - 1] !== arr[arr.length - 1]) sampled.push(arr[arr.length - 1]);
      return sampled;
    }
    return arr;
  }, [displayRows, range]);

  const chartData = useMemo(() => chartRows.map((r: any) => {
    const rewardsVals = Object.values(r.rewards || {});
    let rewardsTotalNum = 0;
    try {
      const totalBig = rewardsVals.reduce((acc: bigint, v: any) => {
        try { return acc + BigInt(v); } catch { return acc; }
      }, BigInt(0));
      rewardsTotalNum = unit === 'AI3' ? tokensNumberFromShannons(totalBig.toString()) : Number(totalBig.toString());
    } catch {
      rewardsTotalNum = 0;
    }
    return {
      epoch: r.epoch,
      totalStake: unit === 'AI3' ? tokensNumberFromShannons(r.totalStake) : Number(r.totalStake ?? '0'),
      stake0: unit === 'AI3' ? tokensNumberFromShannons(r.operatorStakes?.['0'] ?? '0') : Number(r.operatorStakes?.['0'] ?? '0'),
      stake1: unit === 'AI3' ? tokensNumberFromShannons(r.operatorStakes?.['1'] ?? '0') : Number(r.operatorStakes?.['1'] ?? '0'),
      rewards0: unit === 'AI3' ? tokensNumberFromShannons(r.rewards?.['0'] ?? '0') : Number(r.rewards?.['0'] ?? '0'),
      rewards1: unit === 'AI3' ? tokensNumberFromShannons(r.rewards?.['1'] ?? '0') : Number(r.rewards?.['1'] ?? '0'),
      rewardsTotal: rewardsTotalNum
    };
  }), [chartRows, unit]);

  function computeYDomain(
    data: any[],
    keys: string[],
    mode: 'auto' | 'fit' | 'log'
  ): [number | 'auto', number | 'auto']{
    if (mode === 'auto') return ['auto', 'auto'];
    const values: number[] = [];
    for (const row of data){
      for (const k of keys){
        const v = Number((row as any)[k] ?? 0);
        if (Number.isFinite(v)) values.push(v);
      }
    }
    if (!values.length) return ['auto', 'auto'];
    if (mode === 'log'){
      const positives = values.filter(v => v > 0);
      const minPos = positives.length ? Math.min(...positives) : 1;
      return [minPos, 'auto'];
    }
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max){
      const pad = min === 0 ? 1 : Math.abs(min) * 0.02;
      return [min - pad, max + pad];
    }
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  }

  const stakeYDomain = useMemo(() => computeYDomain(
    chartData,
    ['totalStake', ...(showOp0 ? ['stake0'] : []), ...(showOp1 ? ['stake1'] : [])],
    stakeScale
  ), [chartData, showOp0, showOp1, stakeScale]);

  const rewardsYDomain = useMemo(() => computeYDomain(
    chartData,
    ['rewardsTotal', ...(showOp0 ? ['rewards0'] : []), ...(showOp1 ? ['rewards1'] : [])],
    rewardsScale
  ), [chartData, showOp0, showOp1, rewardsScale]);

  const sharedBrushProps: any = brush ? { startIndex: brush.startIndex, endIndex: brush.endIndex } : {};
  function handleBrushChange(range: any){
    if (!range) return;
    const { startIndex, endIndex } = range as any;
    if (typeof startIndex === 'number' && typeof endIndex === 'number'){
      setBrush({ startIndex, endIndex });
    }
  }

  return (
    <div style={{ minHeight: '100vh', padding: '24px', background: '#f9fafb' }}>
      <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>Auto EVM (domain 0) — Epoch Staking & Rewards</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
        <StatCard label="Latest epoch" value={summary.lastEpoch} live={isSummaryLive} />
        <StatCard label="Total stake (latest)" value={summary.totalStake} live={isSummaryLive} />
        <StatCard label="Operators active" value={summary.operators} live={isSummaryLive} />
        <StatCard label="Rewards (latest)" value={summary.rewardsTotal} live={isSummaryLive} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: isMobile ? '16px' : '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? '4px' : '6px', alignItems: 'center', background: '#f5f5f5', border: '1px solid #e5e7eb', borderRadius: '12px', padding: isMobile ? '8px 10px' : '10px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', position: 'sticky', top: 0, zIndex: 20 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '8px' }}>
            <span
              title={liveStatus}
              style={{
                width: 8,
                height: 8,
                borderRadius: 9999,
                background:
                  liveStatus === 'live' ? '#10B981' :
                  liveStatus === 'connecting' ? '#F59E0B' :
                  liveStatus === 'error' ? '#EF4444' : '#9CA3AF'
              }}
            />
            <button
              onClick={() => {
                const next = !isLive;
                setIsLive(next);
                if (!next) setLiveStatus('idle');
              }}
              style={{ 
                padding: segPad, 
                fontSize: microFont, 
                border: '1px solid #d1d5db', 
                borderRadius: '8px', 
                background: 'white', 
                cursor: 'pointer', 
                transition: 'all 0.15s ease-in-out',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                fontWeight: 500
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >{isLive ? 'Live: On' : 'Live: Off'}</button>
            {isLive && lastLiveAt && (
              <span style={{ fontSize: '11px', color: '#6b7280' }}>
                Updated {Math.max(0, Math.floor(((Date.now() - lastLiveAt) / 1000)))}s ago
              </span>
            )}
          </div>
          <div style={{ fontSize: microFont, color: '#6b7280' }}>Range:</div>
          <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            {(['50','200','All'] as const).map(key => (
              <button
                key={key}
                onClick={() => setRange(key)}
                style={{
                  padding: segPad,
                  fontSize: microFont,
                  background: range === key ? '#111827' : 'white',
                  color: range === key ? 'white' : '#111827',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  fontWeight: range === key ? 600 : 500
                }}
                onMouseEnter={(e) => {
                  if (range !== key) {
                    e.currentTarget.style.background = '#f3f4f6';
                  }
                }}
                onMouseLeave={(e) => {
                  if (range !== key) {
                    e.currentTarget.style.background = 'white';
                  }
                }}
              >{key === 'All' ? 'All' : `Last ${key}`}</button>
            ))}
          </div>
          <div style={{ width: '1px', height: '20px', background: '#d1d5db', margin: '0 4px' }} />
          <div style={{ fontSize: microFont, color: '#6b7280' }}>Unit:</div>
          <div style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            {(['AI3','Shannons'] as const).map(key => (
              <button
                key={key}
                onClick={() => setUnit(key)}
                style={{
                  padding: segPad,
                  fontSize: microFont,
                  background: unit === key ? '#111827' : 'white',
                  color: unit === key ? 'white' : '#111827',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  fontWeight: unit === key ? 600 : 500
                }}
                onMouseEnter={(e) => {
                  if (unit !== key) {
                    e.currentTarget.style.background = '#f3f4f6';
                  }
                }}
                onMouseLeave={(e) => {
                  if (unit !== key) {
                    e.currentTarget.style.background = 'white';
                  }
                }}
              >{key}</button>
            ))}
          </div>
          <div style={{ width: '1px', height: '20px', background: '#f3f4f6', margin: '0 4px' }} />
          {/* moved per-chart scale controls into each chart container */}
          <div style={{ fontSize: microFont, color: '#6b7280' }}>Operators:</div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: microFont, padding: '4px 6px', borderRadius: '6px', background: 'white', border: '1px solid #d1d5db', cursor: 'pointer', transition: 'all 0.15s ease-in-out' }}>
            <input type="checkbox" checked={showOp0} onChange={(e)=>setShowOp0(e.target.checked)} style={{ accentColor: '#111827' }} />
            <span style={{ fontWeight: 500 }}>0</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: microFont, padding: '4px 6px', borderRadius: '6px', background: 'white', border: '1px solid #d1d5db', cursor: 'pointer', transition: 'all 0.15s ease-in-out' }}>
            <input type="checkbox" checked={showOp1} onChange={(e)=>setShowOp1(e.target.checked)} style={{ accentColor: '#111827' }} />
            <span style={{ fontWeight: 500 }}>1</span>
          </label>
          <div style={{ flex: 1 }} />
          <button onClick={() => {
            const opsStakeKeys = Array.from(new Set(displayRows.flatMap((r: any) => Object.keys(r.operatorStakes || {})))).sort((a,b)=>Number(a)-Number(b));
            const opsRewardKeys = Array.from(new Set(displayRows.flatMap((r: any) => Object.keys(r.rewards || {})))).sort((a,b)=>Number(a)-Number(b));
            const header = ['epoch','startBlock','endBlock','totalStake', ...opsStakeKeys.map(k=>`stake${k}`), ...opsRewardKeys.map(k=>`rewards${k}`)];
            const csvRows = displayRows.map((r: any) => {
              // Use raw values without any formatting - keep as bigints/shannons
              const totalStakeStr = String(r.totalStake ?? '0');
              const stakeVals = opsStakeKeys.map((k)=> String(r.operatorStakes?.[k] ?? '0'));
              const rewardVals = opsRewardKeys.map((k)=> String(r.rewards?.[k] ?? '0'));
              return [r.epoch, r.startBlock, r.endBlock, totalStakeStr, ...stakeVals, ...rewardVals];
            });
            const csv = [header.join(','), ...csvRows.map((r:any)=>r.join(','))].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const latestEpoch = baseRows.length ? baseRows[baseRows.length - 1].epoch : '';
            a.download = `epochs_raw${latestEpoch !== '' ? `_e${latestEpoch}` : ''}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }} style={{ 
            padding: segPad, 
            fontSize: microFont, 
            border: '1px solid #d1d5db', 
            borderRadius: '8px', 
            background: 'white', 
            cursor: 'pointer', 
            transition: 'all 0.15s ease-in-out',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            fontWeight: 500
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}>Download CSV</button>
        </div>
        <div onMouseEnter={() => setHoverStake(true)} onMouseLeave={() => setHoverStake(false)} style={{ background: 'white', borderRadius: '16px', border: '1px solid #e5e7eb', boxShadow: hoverStake ? '0 8px 24px rgba(0,0,0,0.12)' : '0 2px 10px rgba(0,0,0,0.08)', transition: 'box-shadow 0.2s ease-in-out', padding: chartPadding }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '18px', fontWeight: 500, color: '#111827', paddingBottom: '10px', marginBottom: '14px', borderBottom: '1px solid #f3f4f6' }}>
            <span>Total Stake by Epoch</span>
            {isLive && <span title="Live" style={{ width: 6, height: 6, borderRadius: 9999, background: '#10B981', display: 'inline-block' }} />}
          </h2>
          <div style={{ height: chartHeight }}>
            <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 24 }} syncId="epochs" syncMethod="index">
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="epoch" tick={{ fontSize: microFont }} />
                <YAxis tickFormatter={(v)=>formatYAxisTick(Number(v), unit)} tick={{ fontSize: microFont }} domain={stakeYDomain} scale={stakeScale === 'log' ? 'log' : 'auto'} allowDataOverflow />
                <Tooltip formatter={(v)=>`${formatTooltipNumber(Number(v), unit, 'stake')} ${unit}`} labelFormatter={(l)=>`Epoch ${l}`} />
                <Line type="monotone" dataKey="totalStake" dot={false} name="Total Stake" strokeWidth={2} stroke={COLORS.total} />
                {showOp0 && <Line type="monotone" dataKey="stake0" dot={false} name="Operator 0 Stake" stroke={COLORS.op0} strokeDasharray="4 2" />}
                {showOp1 && <Line type="monotone" dataKey="stake1" dot={false} name="Operator 1 Stake" stroke={COLORS.op1} strokeDasharray="4 2" />}
                <Brush dataKey="epoch" height={isMobile ? 12 : 14} stroke="#9CA3AF" travellerWidth={isMobile ? 6 : 8} onChange={handleBrushChange} {...sharedBrushProps} />
              </LineChart>
            </ResponsiveContainer>
            </ChartErrorBoundary>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                {(['auto','fit','log'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => setStakeScale(key)}
                    style={{
                      padding: isMobile ? '3px 6px' : '4px 8px',
                      fontSize: microFont,
                      textTransform: 'capitalize',
                      background: stakeScale === key ? '#111827' : 'white',
                      color: stakeScale === key ? 'white' : '#111827',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >{key}</button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div onMouseEnter={() => setHoverRewards(true)} onMouseLeave={() => setHoverRewards(false)} style={{ background: 'white', borderRadius: '16px', border: '1px solid #e5e7eb', boxShadow: hoverRewards ? '0 8px 24px rgba(0,0,0,0.12)' : '0 2px 10px rgba(0,0,0,0.08)', transition: 'box-shadow 0.2s ease-in-out', padding: chartPadding }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '18px', fontWeight: 500, color: '#111827', paddingBottom: '10px', marginBottom: '14px', borderBottom: '1px solid #f3f4f6' }}>
            <span>Operator Rewards per Epoch</span>
            {isLive && <span title="Live" style={{ width: 6, height: 6, borderRadius: 9999, background: '#10B981', display: 'inline-block' }} />}
          </h2>
          <div style={{ height: chartHeight }}>
            <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 24 }} syncId="epochs" syncMethod="index">
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="epoch" tick={{ fontSize: microFont }} />
                <YAxis tickFormatter={(v)=>formatYAxisTick(Number(v), unit)} tick={{ fontSize: microFont }} domain={rewardsYDomain} scale={rewardsScale === 'log' ? 'log' : 'auto'} allowDataOverflow />
                <Tooltip formatter={(v)=>`${formatTooltipNumber(Number(v), unit, 'rewards')} ${unit}`} labelFormatter={(l)=>`Epoch ${l}`} />
                {showOp0 && <Bar dataKey="rewards0" name="Operator 0" fill={COLORS.op0} radius={[2,2,0,0]} />}
                {showOp1 && <Bar dataKey="rewards1" name="Operator 1" fill={COLORS.op1} radius={[2,2,0,0]} />}
                <Line type="monotone" dataKey="rewardsTotal" name="Total Rewards" dot={false} stroke={COLORS.total} strokeWidth={2} connectNulls />
                <Brush dataKey="epoch" height={isMobile ? 12 : 14} stroke="#9CA3AF" travellerWidth={isMobile ? 6 : 8} onChange={handleBrushChange} {...sharedBrushProps} />
              </ComposedChart>
            </ResponsiveContainer>
            </ChartErrorBoundary>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', flexShrink: 0 }}>
                {(['auto','fit','log'] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => setRewardsScale(key)}
                    style={{
                      padding: isMobile ? '3px 6px' : '4px 8px',
                      fontSize: microFont,
                      textTransform: 'capitalize',
                      background: rewardsScale === key ? '#111827' : 'white',
                      color: rewardsScale === key ? 'white' : '#111827',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >{key}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
