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

function perquintillToNumber(x?: string){
  // Perquintill uses 1e18 scale, reuse token formatter with 18 fraction digits
  const plain = tokensPlainFromShannons(x, 18);
  return plain ? parseFloat(plain) : 0;
}

function deltaBps(curr?: string, prev?: string){
  try {
    if (!curr || !prev) return 0;
    const c = BigInt(curr);
    const p = BigInt(prev);
    if (p === BigInt(0)) return 0;
    const diff = c - p; // same scale, cancels in division
    const bps = (diff * BigInt(10000)) / p;
    return Number(bps);
  } catch {
    return 0;
  }
}

function formatPerquintillDecimalString(x?: string){
  // Return a long decimal string with up to 18 fractional digits; trim trailing zeros
  const s = tokensPlainFromShannons(x, 18);
  if (!s) return '';
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function ratioToFixed(numer?: string, denom?: string, fractionDigits = 6){
  try {
    if (!numer || !denom) return '';
    const n = BigInt(numer);
    const d = BigInt(denom);
    if (d === BigInt(0)) return '';
    const scale = pow10BigInt(fractionDigits);
    const q = (n * scale) / d; // floor
    const intPart = q / scale;
    const fracPart = q % scale;
    return `${intPart.toString()}.${fracPart.toString().padStart(fractionDigits, '0')}`;
  } catch {
    return '';
  }
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

function DashboardHeader({ isLive, liveStatus, lastLiveAt, setIsLive, setLiveStatus, onDownloadCSV, isMobile }: { 
  isLive: boolean; 
  liveStatus: 'idle' | 'connecting' | 'live' | 'error'; 
  lastLiveAt: number | null; 
  setIsLive: (v: boolean) => void; 
  setLiveStatus: (v: 'idle' | 'connecting' | 'live' | 'error') => void; 
  onDownloadCSV: () => void; 
  isMobile: boolean 
}){
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif';
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between', 
      marginBottom: isMobile ? '16px' : '20px',
      fontFamily 
    }}>
      <div>
        <h1 style={{ 
          fontSize: isMobile ? '18px' : '24px', 
          fontWeight: 600, 
          color: '#111827', 
          margin: 0, 
          lineHeight: 1.2,
          fontFamily 
        }}>
          Auto EVM (domain 0)
        </h1>
        <p style={{ 
          fontSize: isMobile ? '13px' : '14px', 
          color: '#64748b', 
          margin: '2px 0 0 0',
          fontFamily 
        }}>
          Epoch Staking & Rewards
        </p>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px' }}>
        {/* Live Status & Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            title={liveStatus}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
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
              padding: isMobile ? '6px 12px' : '8px 16px',
              fontSize: isMobile ? '12px' : '13px',
              border: '1px solid #d1d5db', 
              borderRadius: '6px', 
              background: isLive ? '#10B981' : 'white',
              color: isLive ? 'white' : '#374151',
              cursor: 'pointer', 
              transition: 'all 0.15s ease-in-out',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              fontWeight: 500,
              fontFamily
            }}
            onMouseEnter={(e) => {
              if (!isLive) {
                e.currentTarget.style.background = '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              if (!isLive) {
                e.currentTarget.style.background = 'white';
              }
            }}
          >
            Live {isLive ? 'On' : 'Off'}
          </button>
          {isLive && lastLiveAt && (
            <span style={{ fontSize: '11px', color: '#6b7280', fontFamily }}>
              {Math.max(0, Math.floor(((Date.now() - lastLiveAt) / 1000)))}s ago
            </span>
          )}
        </div>
        
        {/* Download CSV */}
        <button 
          onClick={onDownloadCSV}
          style={{ 
            padding: isMobile ? '6px 12px' : '8px 16px',
            fontSize: isMobile ? '12px' : '13px',
            border: '1px solid #d1d5db', 
            borderRadius: '6px', 
            background: 'white', 
            color: '#374151',
            cursor: 'pointer', 
            transition: 'all 0.15s ease-in-out',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
            fontWeight: 500,
            fontFamily
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f3f4f6';
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'white';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
          }}
        >
          Download CSV
        </button>
      </div>
    </div>
  );
}

function DomainSummary({ summary, isMobile }: { summary: any; isMobile: boolean }){
  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif';
  return (
    <div style={{ 
      background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', 
      borderRadius: '12px 12px 0 0', 
      border: '2px solid #d1d5db', 
      borderBottom: '1px solid #e2e8f0', 
      padding: isMobile ? '20px' : '24px', 
      fontFamily,
      boxShadow: '0 8px 16px rgba(0, 0, 0, 0.12), 0 4px 6px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
      position: 'relative'
    }}>
      {/* Subtle texture overlay */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.03), transparent 50%), radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.05), transparent 50%)',
        borderRadius: '12px 12px 0 0',
        pointerEvents: 'none'
      }} />
      
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: isMobile ? 16 : 20, alignItems: 'stretch', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: isMobile ? 12 : 13, color: '#64748b', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily }}>Epoch</div>
          <div style={{ fontSize: isMobile ? 28 : 32, fontWeight: 700, color: '#111827', lineHeight: 1.1, fontFamily, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{summary.lastEpoch}</div>
          <div style={{ fontSize: isMobile ? 11 : 12, color: '#64748b', marginTop: 4, fontFamily }}>Last updated</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: isMobile ? 12 : 13, color: '#64748b', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily }}>Total Stake</div>
          <div style={{ fontSize: isMobile ? 28 : 32, fontWeight: 700, color: '#111827', lineHeight: 1.1, fontFamily, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{summary.totalStake}</div>
          <div style={{ fontSize: isMobile ? 11 : 12, color: '#64748b', marginTop: 4, fontFamily }}>AI3</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: isMobile ? 12 : 13, color: '#64748b', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily }}>Latest Rewards</div>
          <div style={{ fontSize: isMobile ? 28 : 32, fontWeight: 700, color: '#111827', lineHeight: 1.1, fontFamily, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{summary.rewardsTotal}</div>
          <div style={{ fontSize: isMobile ? 11 : 12, color: '#64748b', marginTop: 4, fontFamily }}>AI3</div>
        </div>
      </div>
    </div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }){
  const w = 120;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = max === min ? 1 : (max - min) * 0.05;
  const lo = min - pad;
  const hi = max + pad;
  const points = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = h - ((v - lo) / Math.max(1e-9, (hi - lo))) * h;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} />
    </svg>
  );
}

function OperatorTable({ rows, latest, isMobile, showOp0, showOp1, setShowOp0, setShowOp1 }: { rows: any[]; latest: any; isMobile: boolean; showOp0: boolean; showOp1: boolean; setShowOp0: (v: boolean)=>void; setShowOp1: (v: boolean)=>void }){
  const opIds = (latest.latestSharePrices || []).map((r: any) => r.id);
  // Compute common prefix across all visible decimals
  const decimals: string[] = (latest.latestSharePrices || []).map((x: any) => String(x.decimal || ''));
  let commonPrefix = '';
  if (decimals.length >= 2){
    const L = Math.min(...decimals.map(s => s.length));
    let i = 0;
    for (; i < L; i++){
      const ch = decimals[0][i];
      if (!decimals.every(s => s[i] === ch)) break;
    }
    commonPrefix = decimals[0].slice(0, i);
  } else if (decimals.length === 1){
    commonPrefix = decimals[0];
  }

  const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif';
  const monoFamily = '"JetBrains Mono", "SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  
  return (
    <div style={{ 
      background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)', 
      borderRadius: '0 0 12px 12px', 
      border: '2px solid #d1d5db', 
      borderTop: 'none', 
      overflow: 'hidden',
      boxShadow: '0 8px 16px rgba(0, 0, 0, 0.12), 0 4px 6px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
      padding: isMobile ? '16px' : '20px'
    }}>
      {/* Subtle divider */}
      <div style={{ 
        height: '1px', 
        background: 'linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%)', 
        marginBottom: isMobile ? '16px' : '20px' 
      }} />
      
      {/* Operator Cards */}
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))', gap: isMobile ? 12 : 16 }}>
          {(opIds as any[]).map((id: any) => {
            const color = Number(id) % 2 === 0 ? '#60A5FA' : '#F59E0B';
            const colorBg = Number(id) % 2 === 0 ? '#EFF6FF' : '#FEF3C7';
            const stakes = rows[rows.length - 1]?.operatorStakes || {};
            const rewards = rows[rows.length - 1]?.rewards || {};
            const stakeStr = formatTokensIntegerFromShannons(stakes[id] || '0');
            const rewardStr = formatRewardsAmount(rewards[id] || '0', 'AI3');
            const valueStr = String((latest.latestSharePrices || []).find((x: any)=>x.id===id)?.decimal || '');
            const prefix = valueStr.startsWith(commonPrefix) ? commonPrefix : '';
            const suffix = valueStr.slice(prefix.length);
            const isChecked = String(id) === '0' ? showOp0 : showOp1;
            
            return (
              <div key={id} style={{ 
                border: '2px solid #d1d5db',
                borderRadius: '10px',
                padding: isMobile ? '16px' : '20px',
                background: 'linear-gradient(145deg, #ffffff 0%, #fafbfc 100%)',
                borderLeft: `6px solid ${color}`,
                transition: 'all 0.2s ease',
                position: 'relative',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
              }}>
                {/* Operator Header */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  marginBottom: 12
                }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8
                  }}>
                    <div style={{ 
                      width: 12, 
                      height: 12, 
                      borderRadius: '50%', 
                      background: color 
                    }} />
                    <h4 style={{ 
                      fontSize: isMobile ? 16 : 18, 
                      fontWeight: 700, 
                      color: '#111827', 
                      margin: 0,
                      fontFamily 
                    }}>
                      Operator {id}
                    </h4>
                  </div>
                  
                  {/* Show/Hide Toggle */}
                  <label style={{ 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: 4, 
                    fontSize: isMobile ? 11 : 12, 
                    padding: '4px 8px', 
                    borderRadius: '6px', 
                    background: isChecked ? colorBg : '#f8fafc', 
                    color: isChecked ? color : '#64748b',
                    border: `1px solid ${isChecked ? color : '#e2e8f0'}`, 
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontWeight: 500,
                    fontFamily
                  }}>
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={(e)=> (String(id)==='0' ? setShowOp0(e.target.checked) : setShowOp1(e.target.checked))} 
                      style={{ display: 'none' }} 
                    />
                    <span style={{ fontSize: '10px' }}>{isChecked ? '✓' : '+'}</span>
                    <span>Show in Charts</span>
                  </label>
                </div>

                {/* Stats Grid */}
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', 
                  gap: isMobile ? 12 : 16
                }}>
                  {/* Total Stake */}
                  <div>
                    <div style={{ 
                      fontSize: isMobile ? 11 : 12, 
                      color: '#64748b', 
                      fontWeight: 500, 
                      marginBottom: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily 
                    }}>
                      Total Stake
                    </div>
                    <div style={{ 
                      fontSize: isMobile ? 18 : 20, 
                      fontWeight: 700, 
                      color: color, 
                      lineHeight: 1.2,
                      fontFamily 
                    }}>
                      {stakeStr}
                    </div>
                    <div style={{ 
                      fontSize: isMobile ? 10 : 11, 
                      color: '#94a3b8', 
                      fontFamily 
                    }}>
                      AI3
                    </div>
                  </div>

                  {/* Epoch Rewards */}
                  <div>
                    <div style={{ 
                      fontSize: isMobile ? 11 : 12, 
                      color: '#64748b', 
                      fontWeight: 500, 
                      marginBottom: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontFamily 
                    }}>
                      Latest Rewards
                    </div>
                    <div style={{ 
                      fontSize: isMobile ? 18 : 20, 
                      fontWeight: 700, 
                      color: '#111827', 
                      lineHeight: 1.2,
                      fontFamily 
                    }}>
                      {rewardStr}
                    </div>
                    <div style={{ 
                      fontSize: isMobile ? 10 : 11, 
                      color: '#94a3b8', 
                      fontFamily 
                    }}>
                      AI3
                    </div>
                  </div>
                </div>

                {/* Share Price */}
                <div style={{ 
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px solid #f1f5f9'
                }}>
                  <div style={{ 
                    fontSize: isMobile ? 11 : 12, 
                    color: '#64748b', 
                    fontWeight: 500, 
                    marginBottom: 4,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    fontFamily 
                  }}>
                    Share Price
                  </div>
                  <div style={{ 
                    fontSize: isMobile ? 13 : 14, 
                    fontFamily: monoFamily,
                    color: '#111827',
                    fontWeight: 600,
                    lineHeight: 1.2
                  }} title={'Perquintill'}>
                    <span style={{ color: '#94a3b8' }}>{prefix}</span>
                    <span style={{ color: color }}>{suffix}</span>
                  </div>
                  <div style={{ 
                    fontSize: isMobile ? 10 : 11, 
                    color: '#94a3b8', 
                    fontFamily,
                    marginTop: 2
                  }}>
                    Perquintill
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
    rewards: r.rewards ?? {},
    operatorSharePrices: r.operatorSharePrices ?? {}
  })), [mergedRows]);

  const summary = useMemo(() => {
    const last: any = mergedRows[mergedRows.length - 1];
    if (!last) {
      return { lastEpoch: '-', totalStake: '-', operators: '-', rewardsTotal: '-', latestSharePrices: [] } as const;
    }
    const operators = Object.keys(last.operatorStakes ?? {}).length;
    const rewardsTotalBig = Object.values(last.rewards ?? {}).reduce((acc: bigint, v: any) => {
      try { return acc + BigInt(v as any); } catch { return acc; }
    }, BigInt(0));
    
    // Latest operator share prices and normalized ratios
    // Live data might not include operatorSharePrices, so fall back to last known static data
    let sp = (last.operatorSharePrices ?? {}) as Record<string, string>;
    
    // If no share prices in current row, find the most recent row that has share prices
    if (Object.keys(sp).length === 0) {
      for (let i = mergedRows.length - 2; i >= 0; i--) {
        const staticRow = mergedRows[i];
        if (staticRow?.operatorSharePrices && Object.keys(staticRow.operatorSharePrices).length > 0) {
          sp = staticRow.operatorSharePrices;
          break;
        }
      }
    }
    
    const opIds = Object.keys(sp).sort((a,b)=>Number(a)-Number(b));
    const values = opIds.map(id => perquintillToNumber(sp[id]) || 0);
    const max = values.length ? Math.max(...values) : 0;
    const min = values.length ? Math.min(...values) : 0;
    const latestSharePrices = opIds.map(id => ({
      id,
      raw: sp[id],
      decimal: formatPerquintillDecimalString(sp[id]),
      // normalize 0..1 across current operator set
      normalized: (function(){
        const v = perquintillToNumber(sp[id]) || 0;
        if (!Number.isFinite(v)) return 0;
        if (max === min) return 1; // degenerate case
        return (v - min) / (max - min);
      })()
    }));
    return {
      lastEpoch: last.epoch,
      totalStake: unit === 'AI3' ? formatTokensIntegerFromShannons(last.totalStake) : formatAmount(last.totalStake, unit),
      operators,
      rewardsTotal: formatRewardsAmount(rewardsTotalBig.toString(), unit),
      latestSharePrices
    } as const;
  }, [mergedRows, unit]);

  const [range, setRange] = useState<'50' | '200' | 'All'>('200');
  const [showOp0, setShowOp0] = useState(true);
  const [showOp1, setShowOp1] = useState(true);
  const [stakeScale, setStakeScale] = useState<'auto' | 'fit' | 'log'>('auto');
  const [rewardsScale, setRewardsScale] = useState<'auto' | 'fit' | 'log'>('log');
  const [shareScale, setShareScale] = useState<'auto' | 'fit' | 'log'>('auto');
  const [shareView, setShareView] = useState<'abs' | 'delta' | 'index'>('abs');

  const [brush, setBrush] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [fullscreenChart, setFullscreenChart] = useState<'stake' | 'rewards' | 'share' | null>(null);
  const [frozenChartData, setFrozenChartData] = useState<any[] | null>(null);

  function openFullscreen(type: 'stake' | 'rewards' | 'share'){
    if (!frozenChartData) setFrozenChartData(chartData);
    setFullscreenChart(type);
  }

  function closeFullscreen(){
    setFullscreenChart(null);
    setFrozenChartData(null);
  }

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

  const chartData = useMemo(() => {
    const base = chartRows.map((r: any) => {
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
      // Convert perquintill share prices (1e18 scale) to plain numbers for display
      const sp0Raw = r.operatorSharePrices?.['0'];
      const sp1Raw = r.operatorSharePrices?.['1'];
      let sp0 = 0; let sp1 = 0;
      try { sp0 = sp0Raw ? Number(tokensPlainFromShannons(sp0Raw, 18)) : 0; } catch { sp0 = 0; }
      try { sp1 = sp1Raw ? Number(tokensPlainFromShannons(sp1Raw, 18)) : 0; } catch { sp1 = 0; }

      return {
        epoch: r.epoch,
        totalStake: unit === 'AI3' ? tokensNumberFromShannons(r.totalStake) : Number(r.totalStake ?? '0'),
        stake0: unit === 'AI3' ? tokensNumberFromShannons(r.operatorStakes?.['0'] ?? '0') : Number(r.operatorStakes?.['0'] ?? '0'),
        stake1: unit === 'AI3' ? tokensNumberFromShannons(r.operatorStakes?.['1'] ?? '0') : Number(r.operatorStakes?.['1'] ?? '0'),
        rewards0: unit === 'AI3' ? tokensNumberFromShannons(r.rewards?.['0'] ?? '0') : Number(r.rewards?.['0'] ?? '0'),
        rewards1: unit === 'AI3' ? tokensNumberFromShannons(r.rewards?.['1'] ?? '0') : Number(r.rewards?.['1'] ?? '0'),
        rewardsTotal: rewardsTotalNum,
        share0: sp0 || 1,
        share1: sp1 || 1
      };
    });
    // derive deltas (bps) and indexed series
    let first0: number | null = null;
    let first1: number | null = null;
    let prev0: number | null = null;
    let prev1: number | null = null;
    for (let i = 0; i < base.length; i++){
      const row: any = base[i];
      if (first0 == null && row.share0) first0 = row.share0;
      if (first1 == null && row.share1) first1 = row.share1;
      const d0 = prev0 && prev0 !== 0 ? ((row.share0 - prev0) / prev0) * 10000 : 0;
      const d1 = prev1 && prev1 !== 0 ? ((row.share1 - prev1) / prev1) * 10000 : 0;
      row.share0Bps = Number.isFinite(d0) ? d0 : 0;
      row.share1Bps = Number.isFinite(d1) ? d1 : 0;
      row.share0Index = first0 && first0 !== 0 ? row.share0 / first0 : 1;
      row.share1Index = first1 && first1 !== 0 ? row.share1 / first1 : 1;
      prev0 = row.share0;
      prev1 = row.share1;
    }
    return base;
  }, [chartRows, unit]);

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

  const shareYDomain = useMemo(() => {
    const keys = shareView === 'delta'
      ? [ ...(showOp0 ? ['share0Bps'] : []), ...(showOp1 ? ['share1Bps'] : []) ]
      : shareView === 'index'
        ? [ ...(showOp0 ? ['share0Index'] : []), ...(showOp1 ? ['share1Index'] : []) ]
        : [ ...(showOp0 ? ['share0'] : []), ...(showOp1 ? ['share1'] : []) ];
    const mode = shareView === 'delta' && shareScale === 'log' ? 'fit' : shareScale;
    return computeYDomain(chartData, keys, mode);
  }, [chartData, showOp0, showOp1, shareScale, shareView]);

  const sharedBrushProps: any = brush ? { startIndex: brush.startIndex, endIndex: brush.endIndex } : {};
  function handleBrushChange(range: any){
    if (!range) return;
    const { startIndex, endIndex } = range as any;
    if (typeof startIndex === 'number' && typeof endIndex === 'number'){
      // Avoid redundant state updates that can cause render thrashing
      if (!brush || brush.startIndex !== startIndex || brush.endIndex !== endIndex){
        setBrush({ startIndex, endIndex });
      }
    }
  }

  // Fullscreen overlay component
  function FullscreenChart({ type, onClose }: { type: 'stake' | 'rewards' | 'share'; onClose: () => void }) {
    const fullscreenHeight = '90vh';
    const dataForChart = frozenChartData ?? chartData;

    const stakeYDomainFS = useMemo(() => computeYDomain(
      dataForChart,
      ['totalStake', ...(showOp0 ? ['stake0'] : []), ...(showOp1 ? ['stake1'] : [])],
      stakeScale
    ), [dataForChart, showOp0, showOp1, stakeScale]);

    const rewardsYDomainFS = useMemo(() => computeYDomain(
      dataForChart,
      ['rewardsTotal', ...(showOp0 ? ['rewards0'] : []), ...(showOp1 ? ['rewards1'] : [])],
      rewardsScale
    ), [dataForChart, showOp0, showOp1, rewardsScale]);

    const shareYDomainFS = useMemo(() => {
      const keys = shareView === 'delta'
        ? [ ...(showOp0 ? ['share0Bps'] : []), ...(showOp1 ? ['share1Bps'] : []) ]
        : shareView === 'index'
          ? [ ...(showOp0 ? ['share0Index'] : []), ...(showOp1 ? ['share1Index'] : []) ]
          : [ ...(showOp0 ? ['share0'] : []), ...(showOp1 ? ['share1'] : []) ];
      const mode = shareView === 'delta' && shareScale === 'log' ? 'fit' : shareScale;
      return computeYDomain(dataForChart, keys, mode);
    }, [dataForChart, showOp0, showOp1, shareScale, shareView]);
    
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{
          background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 25px 50px rgba(0, 0, 0, 0.25), 0 10px 20px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          width: '95vw',
          height: '95vh',
          padding: '24px',
          position: 'relative'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
            paddingBottom: '16px',
            borderBottom: '1px solid #f3f4f6'
          }}>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 600,
              color: '#111827',
              margin: 0,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif'
            }}>
              {type === 'stake' ? 'Total Stake by Epoch' : 
               type === 'rewards' ? 'Operator Rewards per Epoch' : 
               'Operator Share Price (Perquintill)'}
            </h2>
            <button
              onClick={onClose}
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                background: 'white',
                color: '#64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontWeight: 500
              }}
            >
              ✕ Close
            </button>
          </div>
          
          <div style={{ height: 'calc(100% - 80px)' }}>
            <ChartErrorBoundary>
              <ResponsiveContainer width="100%" height="100%">
                {type === 'stake' ? (
                  <LineChart data={dataForChart} margin={{ top: 20, right: 40, left: 20, bottom: 40 }}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                    <XAxis dataKey="epoch" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v)=>formatYAxisTick(Number(v), unit)} tick={{ fontSize: 12 }} domain={stakeYDomainFS} scale={stakeScale === 'log' ? 'log' : 'auto'} allowDataOverflow />
                    <Tooltip formatter={(v)=>`${formatTooltipNumber(Number(v), unit, 'stake')} ${unit}`} labelFormatter={(l)=>`Epoch ${l}`} />
                    <Line type="monotone" dataKey="totalStake" dot={false} name="Total Stake" strokeWidth={3} stroke={COLORS.total} />
                    {showOp0 && <Line type="monotone" dataKey="stake0" dot={false} name="Operator 0 Stake" stroke={COLORS.op0} strokeDasharray="6 3" strokeWidth={2} />}
                    {showOp1 && <Line type="monotone" dataKey="stake1" dot={false} name="Operator 1 Stake" stroke={COLORS.op1} strokeDasharray="6 3" strokeWidth={2} />}
                  </LineChart>
                ) : type === 'rewards' ? (
                  <ComposedChart data={dataForChart} margin={{ top: 20, right: 40, left: 20, bottom: 40 }}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                    <XAxis dataKey="epoch" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v)=>formatYAxisTick(Number(v), unit)} tick={{ fontSize: 12 }} domain={rewardsYDomainFS} scale={rewardsScale === 'log' ? 'log' : 'auto'} allowDataOverflow />
                    <Tooltip formatter={(v)=>`${formatTooltipNumber(Number(v), unit, 'rewards')} ${unit}`} labelFormatter={(l)=>`Epoch ${l}`} />
                    {showOp0 && <Bar dataKey="rewards0" name="Operator 0" fill={COLORS.op0} radius={[3,3,0,0]} />}
                    {showOp1 && <Bar dataKey="rewards1" name="Operator 1" fill={COLORS.op1} radius={[3,3,0,0]} />}
                    <Line type="monotone" dataKey="rewardsTotal" name="Total Rewards" dot={false} stroke={COLORS.total} strokeWidth={3} connectNulls />
                  </ComposedChart>
                ) : (
                  <LineChart data={dataForChart} margin={{ top: 20, right: 40, left: 20, bottom: 40 }}>
                    <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                    <XAxis dataKey="epoch" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(v)=> {
                      if (shareView === 'delta') return `${Number(v).toFixed(1)} bps`;
                      if (shareView === 'index') return Number(v).toExponential(2);
                      return Number(v).toExponential(2);
                    }} tick={{ fontSize: 12 }} domain={shareYDomainFS} scale={shareScale === 'log' ? 'log' : 'auto'} allowDataOverflow />
                    <Tooltip formatter={(v)=> {
                      if (shareView === 'delta') return `${Number(v).toFixed(2)} bps`;
                      if (shareView === 'index') return `${Number(v).toExponential(6)}×`;
                      return Number(v).toExponential(8);
                    }} labelFormatter={(l)=>`Epoch ${l}`} />
                    {showOp0 && <Line type="monotone" dataKey={shareView === 'delta' ? 'share0Bps' : (shareView === 'index' ? 'share0Index' : 'share0')} dot={false} name="Operator 0" stroke={COLORS.op0} strokeWidth={2} />}
                    {showOp1 && <Line type="monotone" dataKey={shareView === 'delta' ? 'share1Bps' : (shareView === 'index' ? 'share1Index' : 'share1')} dot={false} name="Operator 1" stroke={COLORS.op1} strokeWidth={2} />}
                  </LineChart>
                )}
              </ResponsiveContainer>
            </ChartErrorBoundary>
          </div>
        </div>
      </div>
    );
  }

  const handleDownloadCSV = () => {
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
  };

  return (
    <div style={{ minHeight: '100vh', padding: isMobile ? '12px' : '16px 3%', background: 'linear-gradient(135deg, #e5e7eb 0%, #f3f4f6 50%, #e5e7eb 100%)' }}>
      <DashboardHeader 
        isLive={isLive}
        liveStatus={liveStatus}
        lastLiveAt={lastLiveAt}
        setIsLive={setIsLive}
        setLiveStatus={setLiveStatus}
        onDownloadCSV={handleDownloadCSV}
        isMobile={isMobile}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0, marginBottom: isMobile ? 16 : 20 }}>
        <div>
          <DomainSummary summary={summary as any} isMobile={isMobile} />
        </div>
        {Array.isArray((summary as any).latestSharePrices) && (summary as any).latestSharePrices.length > 0 && (
          <div>
            <OperatorTable rows={displayRows} latest={summary as any} isMobile={isMobile} showOp0={showOp0} showOp1={showOp1} setShowOp0={setShowOp0} setShowOp1={setShowOp1} />
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: isMobile ? '12px' : '16px' }}>
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: isMobile ? '8px' : '10px', 
          alignItems: 'center', 
          background: 'linear-gradient(135deg, #e2e8f0 0%, #d1d5db 100%)', 
          border: '2px solid #9ca3af', 
          borderRadius: '10px', 
          padding: isMobile ? '12px 16px' : '16px 20px', 
          boxShadow: '0 6px 12px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255, 255, 255, 0.3)', 
          position: 'sticky', 
          top: 0, 
          zIndex: 20, 
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
          backdropFilter: 'blur(12px)'
        }}>
          <div style={{ fontSize: isMobile ? 12 : 13, color: '#374151', fontWeight: 600 }}>Chart Controls:</div>
          
          <div style={{ fontSize: microFont, color: '#6b7280' }}>Range:</div>
          <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
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
          
          <div style={{ width: '1px', height: '16px', background: '#d1d5db', margin: '0 4px' }} />
          
          <div style={{ fontSize: microFont, color: '#6b7280' }}>Unit:</div>
          <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
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
        </div>
        <div style={{ 
          background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)', 
          borderRadius: '12px', 
          border: '2px solid #9ca3af', 
          boxShadow: '0 8px 16px rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255, 255, 255, 0.3)', 
          padding: isMobile ? '16px' : '20px',
          position: 'relative'
        }}>
          <h2 style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            fontSize: '18px', 
            fontWeight: 600, 
            color: '#111827', 
            paddingBottom: '12px', 
            marginBottom: '16px', 
            borderBottom: '1px solid #f3f4f6', 
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Total Stake by Epoch</span>
              {isLive && <span title="Live" style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />}
            </div>
            <button
              onClick={() => (fullscreenChart === 'stake' ? closeFullscreen() : openFullscreen('stake'))}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                fontSize: isMobile ? '14px' : '16px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                background: fullscreenChart === 'stake' ? '#111827' : 'white',
                color: fullscreenChart === 'stake' ? 'white' : '#374151',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontWeight: 600,
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              title="Toggle fullscreen"
              onMouseEnter={(e) => {
                if (fullscreenChart !== 'stake') {
                  e.currentTarget.style.background = '#f3f4f6';
                }
              }}
              onMouseLeave={(e) => {
                if (fullscreenChart !== 'stake') {
                  e.currentTarget.style.background = 'white';
                }
              }}
            >
              {fullscreenChart === 'stake' ? '⤓' : '⤢'} {isMobile ? '' : 'Fullscreen'}
            </button>
          </h2>
          <div style={{ height: fullscreenChart === 'stake' ? '80vh' : chartHeight }}>
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
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginTop: 8, flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
              {(['auto','fit','log'] as const).map(key => (
                <button
                  key={key}
                  onClick={() => setStakeScale(key)}
                  style={{
                    padding: isMobile ? '3px 6px' : '4px 8px',
                    fontSize: microFont,
                    textTransform: 'capitalize',
                    background: stakeScale === key ? '#0f172a' : 'white',
                    color: stakeScale === key ? 'white' : '#64748b',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: stakeScale === key ? 500 : 400
                  }}
                >{key}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ 
          background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)', 
          borderRadius: '12px', 
          border: '2px solid #9ca3af', 
          boxShadow: '0 8px 16px rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255, 255, 255, 0.3)', 
          padding: isMobile ? '16px' : '20px',
          position: 'relative'
        }}>
          <h2 style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            fontSize: '18px', 
            fontWeight: 600, 
            color: '#111827', 
            paddingBottom: '12px', 
            marginBottom: '16px', 
            borderBottom: '1px solid #f3f4f6', 
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Operator Rewards per Epoch</span>
              {isLive && <span title="Live" style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />}
            </div>
            <button
              onClick={() => (fullscreenChart === 'rewards' ? closeFullscreen() : openFullscreen('rewards'))}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                fontSize: isMobile ? '14px' : '16px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                background: fullscreenChart === 'rewards' ? '#111827' : 'white',
                color: fullscreenChart === 'rewards' ? 'white' : '#374151',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontWeight: 600,
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              title="Toggle fullscreen"
              onMouseEnter={(e) => {
                if (fullscreenChart !== 'rewards') {
                  e.currentTarget.style.background = '#f3f4f6';
                }
              }}
              onMouseLeave={(e) => {
                if (fullscreenChart !== 'rewards') {
                  e.currentTarget.style.background = 'white';
                }
              }}
            >
              {fullscreenChart === 'rewards' ? '⤓' : '⤢'} {isMobile ? '' : 'Fullscreen'}
            </button>
          </h2>
          <div style={{ height: fullscreenChart === 'rewards' ? '80vh' : chartHeight }}>
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
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginTop: 8, flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
              {(['auto','fit','log'] as const).map(key => (
                <button
                  key={key}
                  onClick={() => setRewardsScale(key)}
                  style={{
                    padding: isMobile ? '3px 6px' : '4px 8px',
                    fontSize: microFont,
                    textTransform: 'capitalize',
                    background: rewardsScale === key ? '#0f172a' : 'white',
                    color: rewardsScale === key ? 'white' : '#64748b',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: rewardsScale === key ? 500 : 400
                  }}
                >{key}</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ 
          background: 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)', 
          borderRadius: '12px', 
          border: '2px solid #9ca3af', 
          boxShadow: '0 8px 16px rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255, 255, 255, 0.3)', 
          padding: isMobile ? '16px' : '20px',
          position: 'relative'
        }}>
          <h2 style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            fontSize: '18px', 
            fontWeight: 600, 
            color: '#111827', 
            paddingBottom: '12px', 
            marginBottom: '16px', 
            borderBottom: '1px solid #f3f4f6', 
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Operator Share Price (Perquintill)</span>
            </div>
            <button
              onClick={() => (fullscreenChart === 'share' ? closeFullscreen() : openFullscreen('share'))}
              style={{
                padding: isMobile ? '8px 12px' : '10px 16px',
                fontSize: isMobile ? '14px' : '16px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                background: fullscreenChart === 'share' ? '#111827' : 'white',
                color: fullscreenChart === 'share' ? 'white' : '#374151',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                fontWeight: 600,
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
              title="Toggle fullscreen"
              onMouseEnter={(e) => {
                if (fullscreenChart !== 'share') {
                  e.currentTarget.style.background = '#f3f4f6';
                }
              }}
              onMouseLeave={(e) => {
                if (fullscreenChart !== 'share') {
                  e.currentTarget.style.background = 'white';
                }
              }}
            >
              {fullscreenChart === 'share' ? '⤓' : '⤢'} {isMobile ? '' : 'Fullscreen'}
            </button>
          </h2>
          <div style={{ height: fullscreenChart === 'share' ? '80vh' : chartHeight }}>
            <ChartErrorBoundary>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 24 }} syncId="epochs" syncMethod="index">
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="epoch" tick={{ fontSize: microFont }} />
                <YAxis tickFormatter={(v)=> {
                  if (shareView === 'delta') return `${Number(v).toFixed(1)} bps`;
                  if (shareView === 'index') return Number(v).toExponential(2);
                  return Number(v).toExponential(2);
                }} tick={{ fontSize: microFont }} domain={shareYDomain} scale={shareScale === 'log' ? 'log' : 'auto'} allowDataOverflow />
                <Tooltip formatter={(v)=> {
                  if (shareView === 'delta') return `${Number(v).toFixed(2)} bps`;
                  if (shareView === 'index') return `${Number(v).toExponential(6)}×`;
                  return Number(v).toExponential(8);
                }} labelFormatter={(l)=>`Epoch ${l}`} />
                {showOp0 && <Line type="monotone" dataKey={shareView === 'delta' ? 'share0Bps' : (shareView === 'index' ? 'share0Index' : 'share0')} dot={false} name="Operator 0" stroke={COLORS.op0} />}
                {showOp1 && <Line type="monotone" dataKey={shareView === 'delta' ? 'share1Bps' : (shareView === 'index' ? 'share1Index' : 'share1')} dot={false} name="Operator 1" stroke={COLORS.op1} />}
                <Brush dataKey="epoch" height={isMobile ? 12 : 14} stroke="#9CA3AF" travellerWidth={isMobile ? 6 : 8} onChange={handleBrushChange} {...sharedBrushProps} />
              </LineChart>
            </ResponsiveContainer>
            </ChartErrorBoundary>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', marginTop: 8, flexWrap: 'wrap', gap: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
              {(['auto','fit','log'] as const).map(key => (
                <button
                  key={key}
                  onClick={() => setShareScale(key)}
                  style={{
                    padding: isMobile ? '3px 6px' : '4px 8px',
                    fontSize: microFont,
                    textTransform: 'capitalize',
                    background: shareScale === key ? '#0f172a' : 'white',
                    color: shareScale === key ? 'white' : '#64748b',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: shareScale === key ? 500 : 400
                  }}
                >{key}</button>
              ))}
            </div>
            <div style={{ display: 'inline-flex', border: '1px solid #e2e8f0', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
              {(['delta','index','abs'] as const).map(key => (
                <button
                  key={key}
                  onClick={() => setShareView(key)}
                  style={{
                    padding: isMobile ? '3px 6px' : '4px 8px',
                    fontSize: microFont,
                    textTransform: 'capitalize',
                    background: shareView === key ? '#0f172a' : 'white',
                    color: shareView === key ? 'white' : '#64748b',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: shareView === key ? 500 : 400
                  }}
                >{key}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Chart Overlay */}
      {fullscreenChart && (
        <FullscreenChart 
          type={fullscreenChart} 
          onClose={closeFullscreen} 
        />
      )}
    </div>
  );
}
