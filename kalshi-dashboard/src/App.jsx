// File: src/App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Settings, Play, Pause, TrendingUp, DollarSign, AlertCircle, Briefcase, Activity, Trophy, Clock, Zap, Link as LinkIcon, Unlink, Wallet, Upload, X, Check, Key, Lock, Loader2, Hash, ArrowUp, ArrowDown, Calendar, Trash2, XCircle, Bot, Wifi, WifiOff, Info, FileText, Droplets, Calculator, ChevronRight, ChevronDown } from 'lucide-react';
import { SPORT_MAPPING, findKalshiMatch, TEAM_ABBR } from './utils/kalshiMatching';

// ==========================================
// 0. LIBRARY LOADER
// ==========================================
const useForge = () => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (window.forge) {
      setIsReady(true);
      return;
    }

    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/forge/1.3.1/forge.min.js";
    script.async = true;
    script.onload = () => setIsReady(true);
    document.body.appendChild(script);
  }, []);

  return isReady;
};

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

const REFRESH_COOLDOWN = 10000; 
const WS_RECONNECT_INTERVAL = 3000;

// ==========================================
// 2. UTILITY & HELPER FUNCTIONS
// ==========================================

const americanToProbability = (odds) => {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
};

const calculateVolatility = (history) => {
    if (!history || history.length < 2) return 0;
    const values = history.map(h => h.v);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
};

// Helper to check if a ticker is from a past date
const isTickerExpired = (ticker) => {
    try {
        if (!ticker) return false;
        // Format is usually SERIES-YYMMMDD-
        const parts = ticker.split('-');
        if (parts.length < 2) return false;
        
        const dateStr = parts[1]; // "23OCT26"
        if (dateStr.length !== 7) return false;

        const yy = parseInt(dateStr.substring(0, 2), 10);
        const mmm = dateStr.substring(2, 5);
        const dd = parseInt(dateStr.substring(5, 7), 10);

        const months = {JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11};
        const monthIndex = months[mmm];
        
        if (isNaN(yy) || monthIndex === undefined || isNaN(dd)) return false;

        // Construct Expiry Date (Assume 2000s)
        const expiry = new Date(2000 + yy, monthIndex, dd);
        // Set expiry to end of that day
        expiry.setHours(23, 59, 59, 999);
        
        // Check if expiry was before "yesterday"
        const yesterday = new Date();
        yesterday.setHours(0, 0, 0, 0);
        yesterday.setDate(yesterday.getDate() - 1);

        return expiry < yesterday;
    } catch (e) {
        return false;
    }
};

const probabilityToAmericanOdds = (prob) => {
    if (prob <= 0 || prob >= 1) return 0;
    if (prob >= 0.5) {
        const odds = - (prob / (1 - prob)) * 100;
        return Math.round(odds);
    } else {
        const odds = ((1 - prob) / prob) * 100;
        return Math.round(odds);
    }
};

const formatDuration = (ms) => {
    if (!ms) return '-';
    const s = Math.abs(ms / 1000).toFixed(1);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
};

const formatMoney = (val) => val ? `$${(val / 100).toFixed(2)}` : '$0.00';

const formatOrderDate = (ts) => !ts ? '-' : new Date(ts).toLocaleString('en-US', { 
    month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true 
});

const hasOpenExposure = (positions, marketTicker) => {
    return positions.some(p => {
        if (p.marketId !== marketTicker) return false;
        if (!p.isOrder && p.quantity > 0) return true;
        if (p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status.toLowerCase())) return true;
        return false;
    });
};

const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: -100, maxWillingToPay: 0 };

    const probToUse = market.vigFreeProb || market.impliedProb;
    const fairValue = Math.floor(probToUse); 
    
    const maxWillingToPay = Math.floor(fairValue * (1 - marginPercent / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = currentBestBid + 1;
    let reason = "Beat Market";

    if (smartBid > maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    }
    
    if (smartBid > 99) smartBid = 99;

    return { smartBid, maxWillingToPay, edge, reason };
};

// --- CRYPTOGRAPHIC SIGNING ENGINE ---
const signRequest = (privateKeyPem, method, path, timestamp) => {
    try {
        const forge = window.forge;
        if (!forge) throw new Error("Forge library not loaded");

        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        const md = forge.md.sha256.create();
        const cleanPath = path.split('?')[0];
        const message = `${timestamp}${method}${cleanPath}`;
        md.update(message, 'utf8');
        const pss = forge.pss.create({
            md: forge.md.sha256.create(),
            mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
            saltLength: 32 
        });
        const signature = privateKey.sign(md, pss);
        return forge.util.encode64(signature);
    } catch (e) {
        console.error("Signing failed:", e);
        throw new Error("Failed to sign request. Check your private key.");
    }
};

// ==========================================
// 3. SUB-COMPONENTS
// ==========================================

const SportFilter = ({ selected, options, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={containerRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
                <Trophy size={14} className="text-blue-500"/>
                {selected.length === 0 ? 'Select Sports' : `${selected.length} Sport${selected.length > 1 ? 's' : ''}`}
                <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}/>
            </button>
            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-[600px] bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-3">
                        <div className="flex justify-between items-center mb-2 px-1">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Available Sports</div>
                            {selected.length > 0 && (
                                <button 
                                    onClick={() => onChange([])}
                                    className="text-[10px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1"
                                >
                                    <XCircle size={12}/> Clear
                                </button>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto p-1 custom-scrollbar">
                            {options.map(opt => {
                                const isSelected = selected.includes(opt.key);
                                const isIntegrated = !!opt.kalshiSeries;
                                return (
                                    <button
                                        key={opt.key}
                                        onClick={() => {
                                            if (isSelected) onChange(selected.filter(s => s !== opt.key));
                                            else onChange([...selected, opt.key]);
                                        }}
                                        className={`text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all border ${
                                            isSelected
                                                ? 'bg-blue-50 border-blue-200 text-blue-700'
                                                : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50 hover:border-slate-200'
                                        } ${isIntegrated ? 'font-bold' : 'font-normal'}`}
                                        title={isIntegrated ? "Integrated with Kalshi" : "Odds Only"}
                                    >
                                        <span className="truncate mr-2">{opt.title}</span>
                                        {isSelected && <Check size={14} className="text-blue-600 flex-shrink-0"/>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const CancellationModal = ({ isOpen, progress }) => {
    if (!isOpen) return null;
    const percentage = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-4 animate-in fade-in zoom-in duration-200">
                <div className="flex flex-col items-center gap-4">
                    <div className="p-3 bg-slate-100 rounded-full">
                        <Loader2 className="animate-spin text-slate-600" size={32} />
                    </div>
                    <div className="text-center">
                        <h3 className="font-bold text-lg text-slate-800">Stopping Auto-Bid</h3>
                        <p className="text-slate-500 text-sm mt-1">Cancelling open orders to prevent rate limits...</p>
                    </div>
                    
                    <div className="w-full mt-2">
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
                            <span>Progress</span>
                            <span>{progress.current} / {progress.total}</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div 
                                className="bg-blue-600 h-full transition-all duration-300 ease-out" 
                                style={{width: `${percentage}%`}}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatsBanner = ({ positions, tradeHistory, balance, sessionStart, isRunning }) => {
    const exposure = positions.reduce((acc, p) => {
        if (p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status?.toLowerCase())) {
            return acc + (p.price * (p.quantity - p.filled));
        }
        if (!p.isOrder && p.status === 'HELD') {
            return acc + p.cost;
        }
        return acc;
    }, 0);

    const historyItems = positions.filter(p => !p.isOrder && (p.settlementStatus === 'settled' || p.realizedPnl));
    const totalRealizedPnl = historyItems.reduce((acc, p) => acc + (p.realizedPnl || 0), 0);

    const heldPositions = positions.filter(p => !p.isOrder && p.status === 'HELD');
    const totalPotentialReturn = heldPositions.reduce((acc, p) => acc + ((p.quantity * 100) - p.cost), 0);

    const winCount = historyItems.filter(p => (p.realizedPnl || 0) > 0).length;
    const totalSettled = historyItems.length;
    const winRate = totalSettled > 0 ? Math.round((winCount / totalSettled) * 100) : 0;

    // --- T-STATISTIC CALCULATION ---
    const botHistory = historyItems.filter(p => tradeHistory && tradeHistory[p.marketId]);

    let tStat = 0;
    let isSignificant = false;
    let tCrit = 0;

    if (botHistory.length > 1) {
        const pnls = botHistory.map(p => p.realizedPnl || 0);
        const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
        const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (pnls.length - 1);
        const stdDev = Math.sqrt(variance);

        if (stdDev > 0) {
            const stdError = stdDev / Math.sqrt(pnls.length);
            tStat = mean / stdError;
        }

        // Critical Value Lookup (Two-tailed, alpha=0.05)
        const df = pnls.length - 1;
        const tTable = {
            1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
            6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
            11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
            16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
            21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060,
            26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
            40: 2.021, 50: 2.009, 60: 2.000, 80: 1.990, 100: 1.984
        };

        // Find closest lower key or default to 1.96 (Z-score approx for large N)
        const keys = Object.keys(tTable).map(Number).sort((a, b) => a - b);
        let closestDf = keys[0];
        for (const k of keys) {
            if (k <= df) closestDf = k;
            else break;
        }

        tCrit = df > 100 ? 1.96 : tTable[closestDf];
        isSignificant = Math.abs(tStat) > tCrit;
    }
    // -------------------------------

    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (!sessionStart || !isRunning) return;
        const i = setInterval(() => setElapsed(Date.now() - sessionStart), 1000);
        return () => clearInterval(i);
    }, [sessionStart, isRunning]);

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
             <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Wallet size={12} /> Total Exposure
                </div>
                <div className="text-2xl font-bold text-slate-800 mt-1">
                    {formatMoney(exposure)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                    Locked in trades & orders
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <TrendingUp size={12} /> Potential Profit
                </div>
                <div className="text-2xl font-bold text-emerald-600 mt-1">
                    +{formatMoney(totalPotentialReturn)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                    If all positions win
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Trophy size={12} /> Realized PnL
                </div>
                <div className={`text-2xl font-bold mt-1 ${totalRealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {totalRealizedPnl > 0 ? '+' : ''}{formatMoney(totalRealizedPnl)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                    {historyItems.length} settled events
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Activity size={12} /> Win Rate
                </div>
                <div className="text-2xl font-bold text-slate-800 mt-1">
                    {winRate}%
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-emerald-500 h-full" style={{width: `${winRate}%`}}></div>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Calculator size={12} /> Statistical Sig.
                </div>
                <div className={`text-2xl font-bold mt-1 ${isSignificant ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {tStat.toFixed(2)}
                </div>
                <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    {isSignificant ? <Check size={12} className="text-emerald-500"/> : <XCircle size={12}/>}
                    {isSignificant ? 'Significant' : 'Not Sig'} (α=0.05)
                </div>
            </div>

             <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Clock size={12} /> Session Time
                </div>
                <div className="text-2xl font-bold text-slate-800 mt-1 font-mono">
                    {sessionStart ? formatDuration(elapsed || (Date.now() - sessionStart)) : '0s'}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                    {isRunning ? 'Bot is running' : 'Bot is paused'}
                </div>
            </div>
        </div>
    );
};

const SettingsModal = ({ isOpen, onClose, config, setConfig, oddsApiKey, setOddsApiKey, sportsList }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Settings size={18}/> Bot Configuration</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-6">
                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-2"><span>Auto-Bid Margin</span><span className="text-blue-600">{config.marginPercent}%</span></div>
                        <input type="range" min="1" max="30" value={config.marginPercent} onChange={e => setConfig({...config, marginPercent: parseInt(e.target.value)})} className="w-full accent-blue-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"/>
                        <p className="text-[10px] text-slate-400 mt-1">Bot will bid <code>FairValue * (1 - Margin)</code></p>
                    </div>

                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-2"><span>Auto-Close Margin</span><span className="text-emerald-600">{config.autoCloseMarginPercent}%</span></div>
                        <input type="range" min="1" max="50" value={config.autoCloseMarginPercent} onChange={e => setConfig({...config, autoCloseMarginPercent: parseInt(e.target.value)})} className="w-full accent-emerald-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"/>
                        <p className="text-[10px] text-slate-400 mt-1">Bot will ask <code>AvgPrice * (1 + Margin)</code></p>
                    </div>

                    <div>
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-2"><span>Max Positions</span><span className="text-rose-600">{config.maxPositions}</span></div>
                        <input type="range" min="1" max="20" value={config.maxPositions} onChange={e => setConfig({...config, maxPositions: parseInt(e.target.value)})} className="w-full accent-rose-600 h-1.5 bg-slate-200 rounded-lg cursor-pointer"/>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Trade Size (Contracts)</label>
                            <input type="number" value={config.tradeSize} onChange={e => setConfig({...config, tradeSize: parseInt(e.target.value) || 1})} className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"/>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">The-Odds-API Key</label>
                        <input type="password" value={oddsApiKey} onChange={e => {setOddsApiKey(e.target.value); localStorage.setItem('odds_api_key', e.target.value)}} className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"/>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
                    <button onClick={onClose} className="px-6 py-2 bg-slate-900 text-white rounded-lg font-bold text-sm hover:bg-slate-800">Done</button>
                </div>
            </div>
        </div>
    );
};

const ActionToast = ({ action }) => {
    if (!action) return null;
    const isBid = action.type === 'BID';
    
    return (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white p-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-10 fade-in duration-300 z-50 max-w-sm border border-slate-700/50">
            <div className={`p-3 rounded-full flex-shrink-0 ${isBid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                <Bot size={24} />
            </div>
            <div>
                <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${isBid ? 'bg-emerald-500 text-slate-900' : 'bg-amber-500 text-slate-900'}`}>
                        {isBid ? 'AUTO-BID' : 'AUTO-CLOSE'}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{formatDuration(0)} ago</span>
                </div>
                <div className="font-medium text-sm leading-tight text-slate-100">
                    {action.ticker}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                    Price: <span className="text-white font-bold">{action.price}¢</span>
                </div>
            </div>
        </div>
    );
};

const LiquidityBadge = ({ volume, openInterest }) => {
    const style = volume > 5000 ? 'text-emerald-700 bg-emerald-100 border-emerald-200' :
                  volume > 500  ? 'text-amber-700 bg-amber-100 border-amber-200' : 
                                  'text-rose-700 bg-rose-50 border-rose-100';
    return (
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide w-fit ${style}`} title={`Vol: ${volume} | OI: ${openInterest}`}>
            <Droplets size={10} /> {volume > 5000 ? 'High Liq' : volume > 500 ? 'Med Liq' : 'Thin Mkt'}
        </div>
    );
};

const Header = ({ balance, isRunning, setIsRunning, lastUpdated, isTurboMode, onConnect, connected, wsStatus, onOpenSettings, onOpenExport, apiUsage }) => (
    <header className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><TrendingUp className="text-blue-600" /> Kalshi ArbBot</h1>
            <div className="flex items-center gap-2 mt-1">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${wsStatus === 'OPEN' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {wsStatus === 'OPEN' ? <Wifi size={10}/> : <WifiOff size={10}/>} {wsStatus === 'OPEN' ? 'WS LIVE' : 'WS OFF'}
                </span>
                {lastUpdated && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 text-slate-500"><Clock size={10} /> {lastUpdated.toLocaleTimeString()}</span>}
                {apiUsage && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-indigo-50 text-indigo-600 border-indigo-100" title={`Used: ${apiUsage.used} | Remaining: ${apiUsage.remaining}`}>
                        <Hash size={10} /> {apiUsage.used}/{apiUsage.used + apiUsage.remaining}
                    </span>
                )}
                {isTurboMode && <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200 animate-pulse flex items-center gap-1"><Zap size={10} fill="currentColor"/> TURBO</span>}
            </div>
        </div>
        <div className="flex items-center gap-3">
             <button onClick={onOpenExport} className="p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors" title="Session Reports">
                <FileText size={20} />
            </button>
             <button onClick={onOpenSettings} className="p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors" title="Settings">
                <Settings size={20} />
            </button>
            <button onClick={onConnect} className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${connected ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
                {connected ? <Check size={16} /> : <Wallet size={16} />} <span className="font-medium text-sm">{connected ? "Wallet Active" : "Connect Wallet"}</span>
            </button>
            <div className="bg-slate-100 px-4 py-2 rounded-lg border border-slate-200 flex items-center gap-2 min-w-[100px] justify-end">
                <DollarSign size={16} className={connected ? 'text-emerald-600' : 'text-slate-400'}/><span className="font-mono font-bold text-lg text-slate-700">{connected && balance !== null ? (balance / 100).toFixed(2) : '-'}</span>
            </div>
            <button onClick={() => setIsRunning(!isRunning)} className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white transition-all shadow-sm active:scale-95 ${isRunning ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>{isRunning ? <><Pause size={18}/> Pause</> : <><Play size={18}/> Start</>}</button>
        </div>
    </header>
);

const ConnectModal = ({ isOpen, onClose, onConnect }) => {
    const [keyId, setKeyId] = useState('');
    const [privateKey, setPrivateKey] = useState('');
    const [fileName, setFileName] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [validationError, setValidationError] = useState('');

    if (!isOpen) return null;

    const handleFile = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (ev) => {
            setPrivateKey(ev.target.result);
            setValidationError('');
        };
        reader.readAsText(file);
    };

    const handleSave = async () => {
        if (!keyId || !privateKey) {
            setValidationError("Please provide both Key ID and Private Key file.");
            return;
        }
        setIsValidating(true);
        try {
            signRequest(privateKey, "GET", "/test", Date.now());
            onConnect({keyId, privateKey});
            onClose();
        } catch (e) {
            setValidationError(e.message);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-4">
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800">Connect Kalshi API</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400" /></button>
                </div>
                <div className="space-y-4">
                    {validationError && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded break-words">
                            <strong>Connection Failed:</strong><br/>{validationError}
                        </div>
                    )}
                    <div className="text-xs bg-blue-50 text-blue-800 p-3 rounded">
                        Keys stored locally. Supports standard PKCS#1 keys.
                    </div>
                    <input type="text" value={keyId} onChange={e => setKeyId(e.target.value)} placeholder="API Key ID" className="w-full p-2 border rounded" />
                    <div className="border-2 border-dashed rounded p-4 text-center cursor-pointer relative">
                        <input type="file" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer" />
                        {fileName ? <span className="text-emerald-600 font-bold">{fileName}</span> : <span className="text-slate-400">Upload Private Key (.key)</span>}
                    </div>
                    <button onClick={handleSave} disabled={isValidating} className="w-full bg-slate-900 text-white py-3 rounded font-bold hover:bg-blue-600 disabled:opacity-50">
                        {isValidating ? 'Validating...' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const AnalysisModal = ({ data, onClose }) => {
    if (!data) return null;
    const latency = data.orderPlacedAt - data.oddsTime;

    const targetVigFreeProb = (data.vigFreeProb || 0) / 100;
    const opposingVigFreeProb = 1 - targetVigFreeProb;

    const targetFairOdds = probabilityToAmericanOdds(targetVigFreeProb);
    const opposingFairOdds = probabilityToAmericanOdds(opposingVigFreeProb);

    let displayOpposingOdds = '-';
    if (data.opposingOdds !== undefined && data.opposingOdds !== null) {
        displayOpposingOdds = (data.opposingOdds > 0 ? '+' : '') + data.opposingOdds;
    } else if (data.sportsbookOdds && data.vigFreeProb) {
        const targetRaw = americanToProbability(data.sportsbookOdds);
        const vigFreeDecimal = data.vigFreeProb / 100;
        
        if (vigFreeDecimal > 0.001) {
            const totalImplied = targetRaw / vigFreeDecimal;
            const opponentRaw = totalImplied - targetRaw;
            
            if (opponentRaw > 0 && opponentRaw < 1) {
                const calcOdds = probabilityToAmericanOdds(opponentRaw);
                displayOpposingOdds = (calcOdds > 0 ? '+' : '') + calcOdds + ' (Est)';
            }
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-slate-900 p-4 flex justify-between items-center">
                    <div className="text-white font-bold flex items-center gap-2"><Calculator size={18} className="text-blue-400"/> Trade Analysis</div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
                </div>
                <div className="p-6">
                    <div className="mb-6"><h3 className="text-lg font-bold text-slate-800 leading-tight mb-1">{data.event}</h3><p className="text-sm text-slate-500 font-mono">{data.ticker}</p></div>
                    
                    <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider flex justify-between">
                            <span>Vig-Free Fair Value Calculator</span>
                        </div>
                        <table className="w-full text-sm text-left">
                            <thead className="bg-white text-slate-500 text-xs">
                                <tr>
                                    <th className="px-4 py-2 font-medium">Outcome</th>
                                    <th className="px-4 py-2 font-medium">Odds</th>
                                    <th className="px-4 py-2 font-medium">No-Vig %</th>
                                    <th className="px-4 py-2 font-medium text-right">Fair Odds</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                <tr className="bg-blue-50/50">
                                    <td className="px-4 py-2 font-bold text-blue-800">Target</td>
                                    <td className="px-4 py-2 font-mono">{data.sportsbookOdds > 0 ? '+' : ''}{data.sportsbookOdds}</td>
                                    <td className="px-4 py-2 font-mono font-bold text-emerald-600">
                                        {(data.vigFreeProb || 0).toFixed(2)}%
                                        {data.bookmakerCount && <span className="text-[9px] text-slate-400 block font-normal">Avg of {data.bookmakerCount} bks</span>}
                                    </td>
                                    <td className="px-4 py-2 font-mono text-right">{targetFairOdds > 0 ? '+' : ''}{targetFairOdds}</td>
                                </tr>
                                <tr>
                                    <td className="px-4 py-2 text-slate-500">Opponent</td>
                                    <td className="px-4 py-2 font-mono">{displayOpposingOdds}</td>
                                    <td className="px-4 py-2 font-mono text-slate-600">{(opposingVigFreeProb * 100).toFixed(2)}%</td>
                                    <td className="px-4 py-2 font-mono text-right">{opposingFairOdds > 0 ? '+' : ''}{opposingFairOdds}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                            <div className="text-xs text-blue-600 font-bold uppercase mb-1">Execution</div>
                            <div className="text-2xl font-bold text-slate-800">{data.bidPrice}¢</div>
                            <div className="text-xs text-slate-500 mt-1">Paid Price</div>
                        </div>
                        <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-100">
                            <div className="text-xs text-emerald-600 font-bold uppercase mb-1">True Value</div>
                            <div className="text-2xl font-bold text-slate-800">{data.fairValue}¢</div>
                            <div className="text-xs text-slate-500 mt-1">Fair Value (Cents)</div>
                        </div>
                    </div>

                    <div className="space-y-3 border-t border-slate-100 pt-4">
                        <div className="flex justify-between items-center text-sm"><span className="text-slate-500">Sportsbook Updated</span><span className="font-mono text-slate-700">{formatOrderDate(data.oddsTime)}</span></div>
                        <div className="flex justify-between items-center text-sm"><span className="text-slate-500">Order Placed</span><span className="font-mono text-slate-700">{formatOrderDate(data.orderPlacedAt)}</span></div>
                         <div className="flex justify-between items-center text-sm bg-amber-50 p-2 rounded border border-amber-100"><span className="text-amber-800 font-medium flex items-center gap-2"><Clock size={14}/> Data Latency</span><span className="font-mono font-bold text-amber-700">{formatDuration(latency)}</span></div>
                         
                         <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500">Status</span>
                            <span className="font-mono font-bold text-slate-700 uppercase">{data.currentStatus || '-'}</span>
                         </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const DataExportModal = ({ isOpen, onClose, tradeHistory, positions }) => {
    if (!isOpen) return null;

    const generateSessionData = () => {
        return Object.entries(tradeHistory).map(([ticker, data]) => {
            const position = positions.find(p => p.marketId === ticker);
            return {
                timestamp: data.orderPlacedAt,
                ticker: ticker,
                event: data.event,
                action: 'BID',
                odds: data.sportsbookOdds,
                fairValue: data.fairValue,
                bidPrice: data.bidPrice,
                edge: data.fairValue - data.bidPrice,
                status: position ? (position.settlementStatus || position.status) : 'Closed/Unknown',
                pnl: position ? (position.realizedPnl || 0) : 0,
                outcome: position ? position.side : 'Yes',
                latency: (data.orderPlacedAt && data.oddsTime) ? (data.orderPlacedAt - data.oddsTime) : null,
                bookmakerCount: data.bookmakerCount || 0,
                oddsSpread: data.oddsSpread || 0,
                vigFreeProb: data.vigFreeProb || 0
            };
        }).sort((a, b) => b.timestamp - a.timestamp);
    };

    const downloadCSV = () => {
        const data = generateSessionData();
        const headers = ["Timestamp", "Ticker", "Event", "Action", "Sportsbook Odds", "Fair Value", "Bid Price", "Edge", "Status", "PnL", "Outcome", "Data Latency (ms)", "Bookmakers", "Odds Spread", "Vig-Free Prob"];
        const rows = data.map(d => [
            new Date(d.timestamp).toISOString(),
            d.ticker,
            `"${d.event.replace(/"/g, '""')}"`,
            d.action,
            d.odds,
            d.fairValue,
            d.bidPrice,
            d.edge,
            d.status,
            d.pnl,
            d.outcome,
            d.latency !== null ? d.latency : '',
            d.bookmakerCount,
            Number(d.oddsSpread).toFixed(3),
            Number(d.vigFreeProb).toFixed(2)
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(r => r.join(","))
        ].join("\n");

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `kalshi_session_${new Date().toISOString().slice(0,10)}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const downloadJSON = () => {
        const data = generateSessionData();
        const jsonContent = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `kalshi_session_${new Date().toISOString().slice(0,10)}.json`;
        link.click();
    };

    const printReport = () => {
        const data = generateSessionData();
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
            <head>
                <title>Kalshi Session Report</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; }
                    h1 { margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; font-size: 12px; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    .positive { color: green; font-weight: bold; }
                    .negative { color: red; font-weight: bold; }
                </style>
            </head>
            <body>
                <h1>Kalshi Session Report - ${new Date().toLocaleString()}</h1>
                <table>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Event</th>
                            <th>Ticker</th>
                            <th>Fair Value</th>
                            <th>Bid</th>
                            <th>Edge</th>
                            <th>Latency (ms)</th>
                            <th>Spread</th>
                            <th>Status</th>
                            <th>PnL</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(d => `
                            <tr>
                                <td>${new Date(d.timestamp).toLocaleString()}</td>
                                <td>${d.event}</td>
                                <td>${d.ticker}</td>
                                <td>${d.fairValue}</td>
                                <td>${d.bidPrice}</td>
                                <td>${d.edge}</td>
                                <td>${d.latency !== null ? d.latency : '-'}</td>
                                <td>${Number(d.oddsSpread).toFixed(3)}</td>
                                <td>${d.status}</td>
                                <td class="${d.pnl >= 0 ? 'positive' : 'negative'}">${(d.pnl / 100).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <script>
                    window.onload = function() { window.print(); }
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <FileText size={20} className="text-blue-600"/> Session Reports
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="space-y-3">
                    <button onClick={downloadCSV} className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all group">
                        <span className="font-medium text-slate-700 group-hover:text-blue-700">Download CSV (Excel)</span>
                        <ArrowDown size={18} className="text-slate-400 group-hover:text-blue-600"/>
                    </button>
                    <button onClick={downloadJSON} className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all group">
                        <span className="font-medium text-slate-700 group-hover:text-blue-700">Download JSON</span>
                        <Hash size={18} className="text-slate-400 group-hover:text-blue-600"/>
                    </button>
                     <button onClick={printReport} className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all group">
                        <span className="font-medium text-slate-700 group-hover:text-blue-700">Print / Save PDF</span>
                        <FileText size={18} className="text-slate-400 group-hover:text-blue-600"/>
                    </button>
                </div>
            </div>
        </div>
    );
};

const PositionDetailsModal = ({ position, market, onClose }) => {
    if (!position) return null;

    const formatMoney = (val) => val ? `$${(val / 100).toFixed(2)}` : '$0.00';
    const formatDate = (ts) => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' EST' : '-';

    const safeAvgPrice = typeof position.avgPrice === 'number' ? position.avgPrice : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800">Position Details</h3>
                    <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                
                <div className="p-6">
                    <div className="flex items-start gap-4 mb-8">
                        <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                            <Briefcase className="text-emerald-600" size={20} />
                        </div>
                        <div>
                            <div className="text-sm text-slate-500 font-medium mb-1">
                                {market ? market.event : position.marketId}
                            </div>
                            <div className="text-2xl font-bold text-slate-900">
                                {position.side}
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="text-slate-400 border-b border-slate-100">
                                    <th className="pb-3 font-normal">Market</th>
                                    <th className="pb-3 font-normal text-right">Avg price</th>
                                    <th className="pb-3 font-normal text-right">Contracts filled</th>
                                    <th className="pb-3 font-normal text-right">Cost</th>
                                    <th className="pb-3 font-normal text-right">Fees</th>
                                    <th className="pb-3 font-normal text-right">Last updated</th>
                                </tr>
                            </thead>
                            <tbody className="text-slate-700">
                                <tr>
                                    <td className="py-4 font-medium text-blue-600">Bought {position.side}</td>
                                    <td className="py-4 text-right font-mono">{safeAvgPrice.toFixed(2)}¢</td>
                                    <td className="py-4 text-right font-mono">{position.quantity}</td>
                                    <td className="py-4 text-right font-mono">{formatMoney(position.cost)}</td>
                                    <td className="py-4 text-right font-mono">{formatMoney(position.fees)}</td>
                                    <td className="py-4 text-right font-mono text-slate-500 text-xs">
                                        {formatDate(position.created || Date.now())}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SortableHeader = ({ label, sortKey, currentSort, onSort, align = 'left' }) => {
    const isActive = currentSort.key === sortKey;
    return (
        <th className={`px-4 py-3 text-${align} cursor-pointer hover:bg-slate-100 transition-colors group select-none`} onClick={() => onSort(sortKey)}>
            <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
                {label}
                <span className={`text-slate-400 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                    {isActive && currentSort.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                </span>
            </div>
        </th>
    );
};

const LatencyDisplay = ({ timestamp }) => {
    const [ago, setAgo] = useState(0);

    useEffect(() => {
        if (!timestamp) return;
        setAgo(Date.now() - timestamp);
        const i = setInterval(() => setAgo(Date.now() - timestamp), 1000);
        return () => clearInterval(i);
    }, [timestamp]);

    if (!timestamp) return <span className="text-[9px] text-slate-300 block mt-0.5">-</span>;

    let color = 'text-slate-400';
    if (ago < 5000) color = 'text-emerald-500 font-bold';
    else if (ago < 30000) color = 'text-amber-500';
    else color = 'text-rose-500';

    return (
        <div className={`text-[9px] font-mono mt-0.5 ${color}`}>
           {formatDuration(ago)} ago
        </div>
    );
};

const MarketRow = ({ market, onExecute, marginPercent, tradeSize }) => {
    return (
        <tr key={market.id} className="hover:bg-slate-50 transition-colors">
            <td className="px-4 py-3">
                <div className="font-medium text-slate-700">{market.event}</div>
                <div className="flex items-center gap-2 mt-1">
                    {market.isMatchFound ? <LiquidityBadge volume={market.volume} openInterest={market.openInterest}/> : <span className="text-[10px] bg-slate-100 text-slate-400 px-1 rounded">No Match</span>}
                    <span className="text-[10px] text-slate-400 font-mono">Odds: {market.oddsDisplay || market.americanOdds}</span>
                </div>
            </td>
            <td className="px-4 py-3 text-center">
                <div className="font-bold text-slate-700">{market.fairValue}¢</div>
                <LatencyDisplay timestamp={market.oddsLastUpdate} />
            </td>
            <td className="px-4 py-3 text-center">
                <div className={`font-bold ${market.volatility > 1.0 ? 'text-amber-600' : 'text-slate-400'}`}>
                    {market.volatility.toFixed(2)}
                </div>
                {market.volatility > 1.0 && <div className="text-[9px] text-amber-500 font-bold uppercase tracking-wider flex justify-center items-center gap-1"><Activity size={8}/> Volatile</div>}
            </td>
            <td className="px-4 py-3 text-center">
                <div className="font-mono text-slate-500">{market.bestBid}¢ / {market.bestAsk}¢</div>
                <LatencyDisplay timestamp={market.kalshiLastUpdate} />
            </td>
            <td className="px-4 py-3 text-right text-slate-400">{market.maxWillingToPay}¢</td>
            <td className="px-4 py-3 text-right">
                {market.smartBid ? <div className="flex flex-col items-end"><span className="font-bold text-emerald-600">{market.smartBid}¢</span><span className="text-[9px] text-slate-400 uppercase">{market.reason}</span></div> : '-'}
            </td>
            <td className="px-4 py-3 text-center">
                <button onClick={() => onExecute(market, market.smartBid, false)} disabled={!market.smartBid} className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold hover:bg-blue-600 disabled:opacity-20 disabled:cursor-not-allowed">Bid {market.smartBid}¢</button>
            </td>
        </tr>
    );
};

const PortfolioSection = ({ activeTab, positions, markets, tradeHistory, onAnalysis, onCancel, onExecute, sortConfig, onSort }) => {
    
    const getGameName = (ticker) => {
        const liveMarket = markets.find(m => m.realMarketId === ticker);
        if (liveMarket) return liveMarket.event;
        if (tradeHistory[ticker]) return tradeHistory[ticker].event;
        return ticker; 
    };

    const getCurrentFV = (ticker) => {
        const liveMarket = markets.find(m => m.realMarketId === ticker);
        return liveMarket ? liveMarket.fairValue : 0;
    };

    const getCurrentPrice = (ticker) => {
        const liveMarket = markets.find(m => m.realMarketId === ticker);
        return liveMarket ? liveMarket.bestBid : 0;
    };

    const getSortValue = (item, key) => {
        if (key === 'created') return item.created || 0;
        if (key === 'details') return item.side;
        if (key === 'fvBuy') return tradeHistory[item.marketId]?.fairValue || 0;
        if (key === 'fvNow') return getCurrentFV(item.marketId);
        if (key === 'filled') return item.filled || 0;
        if (key === 'price') return item.price || 0;
        if (key === 'cash') return (item.price || 0) * ((item.quantity || 0) - (item.filled || 0));
        if (key === 'payout') return item.payout || 0;
        if (key === 'quantity') return item.quantity || 0;
        if (key === 'mktValue') return (item.quantity || 0) * getCurrentPrice(item.marketId);
        return 0;
    };

    const groupedItems = useMemo(() => {
        const groups = {};
        positions.forEach(item => {
            const game = getGameName(item.marketId);
            if (!groups[game]) groups[game] = [];
            groups[game].push(item);
        });

        // Sort items within groups
        Object.keys(groups).forEach(game => {
            groups[game].sort((a, b) => {
                const valA = getSortValue(a, sortConfig.key);
                const valB = getSortValue(b, sortConfig.key);
                if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        });

        // Sort groups by their first item (best representative)
        const sortedGroups = Object.entries(groups).sort((a, b) => {
            const itemA = a[1][0];
            const itemB = b[1][0];
            const valA = getSortValue(itemA, sortConfig.key);
            const valB = getSortValue(itemB, sortConfig.key);
            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });

        return sortedGroups;
    }, [positions, markets, tradeHistory, sortConfig]);

    const formatMoney = (val) => val ? `$${(val / 100).toFixed(2)}` : '$0.00';
    const formatDate = (ts) => ts ? new Date(ts).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-';

    return (
        <div className="overflow-auto flex-1">
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                    <tr>
                        <SortableHeader label="Details" sortKey="details" currentSort={sortConfig} onSort={onSort} />
                        
                        {activeTab === 'positions' && (
                            <>
                                <SortableHeader label="Qty" sortKey="quantity" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Mkt Value" sortKey="mktValue" currentSort={sortConfig} onSort={onSort} align="right" />
                                <SortableHeader label="FV @ Buy" sortKey="fvBuy" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="FV Now" sortKey="fvNow" currentSort={sortConfig} onSort={onSort} align="center" />
                            </>
                        )}

                        {activeTab === 'resting' && (
                            <>
                                <SortableHeader label="Filled / Qty" sortKey="filled" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Limit" sortKey="price" currentSort={sortConfig} onSort={onSort} align="right" />
                                <SortableHeader label="Cash" sortKey="cash" currentSort={sortConfig} onSort={onSort} align="right" />
                                <SortableHeader label="Placed / Exp" sortKey="created" currentSort={sortConfig} onSort={onSort} align="right" />
                            </>
                        )}

                        {activeTab === 'history' && (
                            <>
                                <SortableHeader label="FV @ Buy" sortKey="fvBuy" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Payout" sortKey="payout" currentSort={sortConfig} onSort={onSort} align="right" />
                                <SortableHeader label="Settled" sortKey="created" currentSort={sortConfig} onSort={onSort} align="right" />
                            </>
                        )}
                        <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                </thead>
                
                {groupedItems.map(([gameName, items]) => (
                    <React.Fragment key={gameName}>
                        <tbody className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <td colSpan={activeTab === 'history' ? 5 : 6} className="px-4 py-2 font-bold text-xs text-slate-700 uppercase tracking-wider bg-slate-100/50">
                                    {gameName}
                                </td>
                            </tr>
                        </tbody>
                        <tbody className="divide-y divide-slate-50">
                            {items.map(item => {
                                const history = tradeHistory[item.marketId];
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50 group">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-bold ${item.side === 'Yes' ? 'text-blue-600' : 'text-rose-600'}`}>{item.side}</span>
                                                <span className="text-slate-400">for</span>
                                                <span className="font-medium text-slate-700">{item.marketId.split('-').pop()}</span>
                                            </div>
                                        </td>

                                        {activeTab === 'positions' && (
                                            <>
                                                <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                                                    {item.quantity}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                    {formatMoney(item.quantity * getCurrentPrice(item.marketId))}
                                                </td>
                                                <td className="px-4 py-3 text-center font-mono text-slate-500">
                                                    {history ? `${history.fairValue}¢` : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-center font-mono font-bold text-emerald-600">
                                                    {getCurrentFV(item.marketId)}¢
                                                </td>
                                            </>
                                        )}

                                        {activeTab === 'resting' && (
                                            <>
                                                <td className="px-4 py-3 text-center font-mono">
                                                    <span className="font-bold">{item.filled}</span> <span className="text-slate-400">/ {item.quantity}</span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono">{item.price}¢</td>
                                                <td className="px-4 py-3 text-right font-mono text-slate-600">
                                                    {formatMoney(item.price * (item.quantity - item.filled))}
                                                </td>
                                                <td className="px-4 py-3 text-right text-xs text-slate-500">
                                                    <div>{formatDate(item.created)}</div>
                                                    <div className="text-[10px] text-slate-400">{item.expiration ? formatDate(item.expiration) : 'GTC'}</div>
                                                </td>
                                            </>
                                        )}

                                        {activeTab === 'history' && (
                                            <>
                                                <td className="px-4 py-3 text-center font-mono text-slate-500">
                                                    {history ? `${history.fairValue}¢` : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600">
                                                    {item.payout ? formatMoney(item.payout) : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-right text-xs text-slate-500">
                                                    {formatDate(item.created)} 
                                                </td>
                                            </>
                                        )}

                                        <td className="px-4 py-3 text-center flex justify-center gap-2">
                                            {item.isOrder && (
                                                <button onClick={() => onCancel(item.id)} className="text-slate-400 hover:text-rose-600 transition-colors" title="Cancel Order">
                                                    <XCircle size={16}/>
                                                </button>
                                            )}
                                            <button 
                                                onClick={() => onAnalysis(item)}
                                                disabled={!history} 
                                                className="text-slate-300 hover:text-blue-600 disabled:opacity-20"
                                            >
                                                <Info size={16}/>
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </React.Fragment>
                ))}
                {positions.length === 0 && (
                    <tbody>
                        <tr><td colSpan={6} className="p-8 text-center text-slate-400 italic">No items found</td></tr>
                    </tbody>
                )}
            </table>
        </div>
    );
};

const EventLog = ({ logs }) => {
    const scrollRef = useRef(null);
    useEffect(() => {
        if (scrollRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
            if (isNearBottom || logs.length === 1) {
                scrollRef.current.scrollTop = scrollHeight;
            }
        }
    }, [logs]);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[300px]">
             <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-700 flex items-center gap-2"><FileText size={18} className="text-slate-400"/> Event Log</h3>
            </div>
            <div ref={scrollRef} className="overflow-y-auto p-4 space-y-2 flex-1 font-mono text-xs">
                {logs.length === 0 && <div className="text-slate-400 text-center italic mt-10">No events yet</div>}
                {logs.map(log => (
                    <div key={log.id} className="flex gap-2 border-b border-slate-50 pb-1 last:border-0">
                        <span className="text-slate-400 min-w-[60px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span className={`font-bold w-[60px] ${
                            log.type === 'BID' ? 'text-blue-600' :
                            log.type === 'CANCEL' ? 'text-rose-400' :
                            log.type === 'FILL' ? 'text-emerald-600' :
                            log.type === 'CLOSE' ? 'text-amber-600' :
                            log.type === 'UPDATE' ? 'text-purple-600' :
                            'text-slate-700'
                        }`}>[{log.type}]</span>
                        <span className="text-slate-700 truncate">{log.message}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ==========================================
// 4. MAIN DASHBOARD
// ==========================================

const KalshiDashboard = () => {
  const isForgeReady = useForge(); 
  
  const [markets, setMarkets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [balance, setBalance] = useState(null); 
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState(''); 
  const [lastUpdated, setLastUpdated] = useState(null);
  const [wsStatus, setWsStatus] = useState('CLOSED'); 
  const [walletKeys, setWalletKeys] = useState(null);
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('resting');
  const [analysisModalData, setAnalysisModalData] = useState(null);
  const [oddsApiKey, setOddsApiKey] = useState('');
  const [apiUsage, setApiUsage] = useState(null);
  
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [sessionStart, setSessionStart] = useState(null);
  const [eventLogs, setEventLogs] = useState([]);

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationProgress, setCancellationProgress] = useState({ current: 0, total: 0 });

  const [sortConfig, setSortConfig] = useState({ key: 'edge', direction: 'desc' });
  const [portfolioSortConfig, setPortfolioSortConfig] = useState({ key: 'created', direction: 'desc' });

  const [config, setConfig] = useState({
      marginPercent: 15,
      autoCloseMarginPercent: 15,
      tradeSize: 10,
      maxPositions: 5,
      isAutoBid: false,
      isAutoClose: true,
      holdStrategy: 'sell_limit',
      selectedSports: ['americanfootball_nfl'],
      isTurboMode: false
  });

  const [sportsList, setSportsList] = useState(SPORT_MAPPING);
  const [isLoadingSports, setIsLoadingSports] = useState(false);
  
  const lastFetchTimeRef = useRef(0);
  const abortControllerRef = useRef(null);
  const autoBidTracker = useRef(new Set()); 
  const isAutoBidProcessing = useRef(false);
  const closingTracker = useRef(new Set()); 
  const wsRef = useRef(null);
  const lastOrdersRef = useRef({});
  const isFirstFetchRef = useRef(true);

  const addLog = useCallback((message, type) => {
      const log = { id: Date.now() + Math.random(), timestamp: Date.now(), message, type };
      setEventLogs(prev => [...prev.slice(-99), log]);
  }, []);
  
  const [tradeHistory, setTradeHistory] = useState(() => JSON.parse(localStorage.getItem('kalshi_trade_history') || '{}'));
  useEffect(() => localStorage.setItem('kalshi_trade_history', JSON.stringify(tradeHistory)), [tradeHistory]);

  useEffect(() => {
      const k = localStorage.getItem('kalshi_keys');
      if (k) setWalletKeys(JSON.parse(k));
      const o = localStorage.getItem('odds_api_key');
      if (o) setOddsApiKey(o);
  }, []);

  useEffect(() => {
      if (isRunning && !sessionStart) setSessionStart(Date.now());
  }, [isRunning, sessionStart]);

  useEffect(() => {
    if (!oddsApiKey) return;
    setIsLoadingSports(true);
    fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${oddsApiKey}`)
        .then(res => res.json())
        .then(data => {
            if (Array.isArray(data)) setSportsList(data.filter(s => s.key).map(s => {
                const map = SPORT_MAPPING.find(m => m.key === s.key);
                return map ? { ...s, kalshiSeries: map.kalshiSeries } : s;
            }));
        })
        .finally(() => setIsLoadingSports(false));
  }, [oddsApiKey]);

  const fetchLiveOdds = useCallback(async (force = false) => {
      if (!oddsApiKey) return;
      const now = Date.now();
      const cooldown = config.isTurboMode ? 2000 : 10000;
      if (!force && (now - lastFetchTimeRef.current < cooldown)) return;
      
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      try {
          setErrorMsg('');
          
          const selectedSportsList = sportsList.filter(s => config.selectedSports.includes(s.key));
          if (selectedSportsList.length === 0) {
              setMarkets([]);
              return;
          }

          const requests = selectedSportsList.map(async (sportConfig) => {
               const seriesTicker = sportConfig.kalshiSeries || '';
               const [oddsRes, kalshiMarkets] = await Promise.all([
                  fetch(`https://api.the-odds-api.com/v4/sports/${sportConfig.key}/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${oddsApiKey}`, { signal: abortControllerRef.current.signal }),
                  fetch(`/api/kalshi/markets?limit=300&status=open${seriesTicker ? `&series_ticker=${seriesTicker}` : ''}`, { signal: abortControllerRef.current.signal }).then(r => r.json()).then(d => d.markets || []).catch(() => [])
               ]);
               
               const used = oddsRes.headers.get('x-requests-used');
               const remaining = oddsRes.headers.get('x-requests-remaining');

               const oddsData = await oddsRes.json();
               if (!Array.isArray(oddsData)) throw new Error(oddsData.message || `API Error for ${sportConfig.key}`);
               
               return { oddsData, kalshiMarkets, seriesTicker, apiUsage: (used && remaining) ? { used: parseInt(used), remaining: parseInt(remaining) } : null };
          });

          const results = await Promise.all(requests);
          
          // Update API usage from the last successful request
          const lastUsage = results.find(r => r.apiUsage)?.apiUsage;
          if (lastUsage) setApiUsage(lastUsage);

          lastFetchTimeRef.current = Date.now();
          setLastUpdated(new Date());

          // Flatten results
          const allOddsData = results.flatMap(r => r.oddsData.map(o => ({ ...o, _kalshiMarkets: r.kalshiMarkets, _seriesTicker: r.seriesTicker })));

          setMarkets(prev => {
              const processed = allOddsData.slice(0, 50).map(game => {
                  const kalshiData = game._kalshiMarkets;
                  const seriesTicker = game._seriesTicker;

                  const bookmakers = game.bookmakers || [];
                  if (bookmakers.length === 0) return null;

                  const refBookmaker = bookmakers[0];
                  const refOutcomes = refBookmaker.markets?.[0]?.outcomes;
                  
                  if (!refOutcomes || refOutcomes.length < 2) return null;

                  const targetOutcome = refOutcomes.find(o => o.price < 0) || refOutcomes[0];
                  const targetName = targetOutcome.name;
                  
                  const opposingOutcome = refOutcomes.find(o => o.name !== targetName);
                  const oddsDisplay = opposingOutcome 
                    ? `${targetOutcome.price > 0 ? '+' : ''}${targetOutcome.price} / ${opposingOutcome.price > 0 ? '+' : ''}${opposingOutcome.price}`
                    : `${targetOutcome.price}`;

                  const vigFreeProbs = [];
                  let maxLastUpdate = 0;

                  for (const bm of bookmakers) {
                      if (bm.last_update) {
                          const ts = new Date(bm.last_update).getTime();
                          if (ts > maxLastUpdate) maxLastUpdate = ts;
                      }

                      const outcomes = bm.markets?.[0]?.outcomes;
                      if (!outcomes || outcomes.length < 2) continue;

                      let totalImplied = 0;
                      const probs = outcomes.map(o => {
                          const p = americanToProbability(o.price);
                          totalImplied += p;
                          return { name: o.name, p };
                      });

                      const tProb = probs.find(o => o.name === targetName);
                      if (tProb) {
                          vigFreeProbs.push(tProb.p / totalImplied);
                      }
                  }

                  if (vigFreeProbs.length === 0) return null;

                  const minProb = Math.min(...vigFreeProbs);
                  const maxProb = Math.max(...vigFreeProbs);
                  const spread = maxProb - minProb;

                  if (spread > 0.15) {
                      console.warn(`Market rejected due to high variance: ${spread.toFixed(2)}`);
                      return null;
                  }

                  const vigFreeProb = vigFreeProbs.reduce((a, b) => a + b, 0) / vigFreeProbs.length;

                  // Legacy support for impliedProb display (using reference bookmaker)
                  const refTotalImplied = refOutcomes.reduce((acc, o) => acc + americanToProbability(o.price), 0);
                  const refTargetImplied = americanToProbability(targetOutcome.price);
                  const refImpliedProb = (refTargetImplied / refTotalImplied) * 100;

                  const realMatch = findKalshiMatch(targetOutcome.name, game.home_team, game.away_team, game.commence_time, kalshiData, seriesTicker);
                  const prevMarket = prev.find(m => m.id === game.id);

                  // --- VOLATILITY TRACKING ---
                  const now = Date.now();
                  const currentVal = vigFreeProb * 100;
                  let history = prevMarket?.history ? [...prevMarket.history] : [];
                  history.push({ t: now, v: currentVal });
                  // Keep last 60 mins of history for volatility calculation
                  const cutoff = now - 60 * 60 * 1000;
                  history = history.filter(h => h.t > cutoff);
                  const volatility = calculateVolatility(history);
                  // ---------------------------
                  
                  let { yes_bid: bestBid, yes_ask: bestAsk, volume, open_interest: openInterest } = realMatch || {};
                  if (prevMarket && prevMarket.realMarketId === realMatch?.ticker) {
                      bestBid = prevMarket.bestBid;
                      bestAsk = prevMarket.bestAsk;
                  }

                  return {
                      id: game.id,
                      event: `${targetOutcome.name} vs ${targetOutcome.name === game.home_team ? game.away_team : game.home_team}`,
                      commenceTime: game.commence_time,
                      americanOdds: targetOutcome.price, 
                      sportsbookOdds: targetOutcome.price, 
                      opposingOdds: opposingOutcome ? opposingOutcome.price : null, 
                      oddsDisplay: oddsDisplay, 
                      impliedProb: refImpliedProb,
                      vigFreeProb: vigFreeProb * 100, 
                      bestBid: bestBid || 0,
                      bestAsk: bestAsk || 0,
                      isMatchFound: !!realMatch,
                      realMarketId: realMatch?.ticker,
                      volume: volume || 0,
                      openInterest: openInterest || 0,
                      lastChange: Date.now(),
                      kalshiLastUpdate: Date.now(),
                      oddsLastUpdate: maxLastUpdate,
                      fairValue: Math.floor(vigFreeProb * 100), 
                      history: history,
                      volatility: volatility,
                      bookmakerCount: vigFreeProbs.length,
                      oddsSpread: spread
                  };
              }).filter(Boolean);
              
              return processed;
          });
      } catch (e) { if (e.name !== 'AbortError') setErrorMsg(e.message); }
  }, [oddsApiKey, config.selectedSports, config.isTurboMode, sportsList]);

  useEffect(() => { setMarkets([]); fetchLiveOdds(true); }, [config.selectedSport, fetchLiveOdds]);

  useEffect(() => {
      if (!isRunning) return;
      fetchLiveOdds(true);
      const interval = setInterval(() => fetchLiveOdds(false), config.isTurboMode ? 3000 : 15000);
      return () => clearInterval(interval);
  }, [isRunning, fetchLiveOdds, config.isTurboMode]);

  useEffect(() => {
      if (!isRunning || !walletKeys || !isForgeReady) return;
      const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/kalshi-ws';
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
          setWsStatus('OPEN');
          const ts = Date.now();
          const sig = signRequest(walletKeys.privateKey, "GET", "/users/current/user", ts);
          ws.send(JSON.stringify({ id: 1, cmd: "connect", params: { key: walletKeys.keyId, signature: sig, timestamp: ts } }));
      };
      ws.onmessage = (e) => {
          const d = JSON.parse(e.data);
          if (d.type === 'ticker' && d.msg) {
              setMarkets(curr => curr.map(m => {
                  if (m.realMarketId === d.msg.ticker) return {
                      ...m,
                      bestBid: d.msg.yes_bid,
                      bestAsk: d.msg.yes_ask,
                      lastChange: Date.now(),
                      kalshiLastUpdate: Date.now()
                  };
                  return m;
              }));
          }
      };
      ws.onclose = () => setWsStatus('CLOSED');
      wsRef.current = ws;
      return () => ws.close();
  }, [isRunning, walletKeys, isForgeReady]);

  useEffect(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN && markets.length) {
          const tickers = markets.filter(m => m.realMarketId).map(m => m.realMarketId);
          if (tickers.length) wsRef.current.send(JSON.stringify({ id: 2, cmd: "subscribe", params: { channels: ["ticker"], market_tickers: tickers } }));
      }
  }, [markets.length, wsStatus]);

  const fetchPortfolio = useCallback(async () => {
      if (!walletKeys || !isForgeReady) return;
      try {
          const ts = Date.now();
          const headers = (path) => ({ 
              'KALSHI-ACCESS-KEY': walletKeys.keyId, 
              'KALSHI-ACCESS-SIGNATURE': signRequest(walletKeys.privateKey, "GET", path, ts), 
              'KALSHI-ACCESS-TIMESTAMP': ts.toString() 
          });

          const [balRes, ordersRes, posRes, settledPosRes] = await Promise.all([
              fetch('/api/kalshi/portfolio/balance', { headers: headers('/trade-api/v2/portfolio/balance') }),
              fetch('/api/kalshi/portfolio/orders', { headers: headers('/trade-api/v2/portfolio/orders') }),
              fetch('/api/kalshi/portfolio/positions', { headers: headers('/trade-api/v2/portfolio/positions') }),
              fetch('/api/kalshi/portfolio/positions?settlement_status=settled', { headers: headers('/trade-api/v2/portfolio/positions') })
          ]);

          if (!balRes.ok || !ordersRes.ok || !posRes.ok) {
              console.error("Portfolio Fetch Failed");
              if (!posRes.ok) console.error("Positions Error:", await posRes.text());
              return;
          }

          const bal = await balRes.json();
          const orders = await ordersRes.json();
          const pos = await posRes.json();
          const settledPos = settledPosRes.ok ? await settledPosRes.json() : { market_positions: [] };

          if (bal?.balance) setBalance(bal.balance);
          
          // Process fills
          (orders.orders || []).forEach(o => {
              const prev = lastOrdersRef.current[o.order_id];
              if (prev && o.fill_count > prev.filled) {
                 const filledAmount = o.fill_count - prev.filled;
                 const price = o.yes_price || o.no_price;
                 addLog(`Filled ${filledAmount}x ${o.ticker} @ ${price}¢`, 'FILL');
              } else if (!prev && o.fill_count > 0) {
                 // New order already partially filled, only log if not first fetch
                 if (!isFirstFetchRef.current) {
                     const price = o.yes_price || o.no_price;
                     addLog(`Filled ${o.fill_count}x ${o.ticker} @ ${price}¢`, 'FILL');
                 }
              }
              lastOrdersRef.current[o.order_id] = { filled: o.fill_count };
          });

          isFirstFetchRef.current = false;

          const mappedItems = [
              // ORDERS
              ...(orders.orders || []).map(o => ({
                  id: o.order_id, 
                  marketId: o.ticker, 
                  action: o.action,
                  side: o.side === 'yes' ? 'Yes' : 'No', 
                  quantity: o.count || (o.fill_count + o.remaining_count),
                  filled: o.fill_count, 
                  price: o.yes_price || o.no_price, 
                  status: o.status, 
                  isOrder: true, 
                  created: o.created_time,
                  expiration: o.expiration_time 
              })),
              // POSITIONS
              ...([
                  ...(pos.market_positions && pos.market_positions.length > 0 ? pos.market_positions : (pos.event_positions || pos.positions || [])),
                  ...(settledPos.market_positions && settledPos.market_positions.length > 0 ? settledPos.market_positions : (settledPos.event_positions || settledPos.positions || []))
              ]).map(p => {
                  const ticker = p.ticker || p.market_ticker || p.event_ticker;
                  const qty = p.position || p.total_cost_shares || 0;
                  let avg = 0;
                  if (p.avg_price) avg = p.avg_price;
                  else if (p.total_cost && qty) avg = p.total_cost / qty;
                  else if (p.fees_paid && qty) avg = p.fees_paid / Math.abs(qty);

                  return {
                      id: ticker, 
                      marketId: ticker, 
                      side: 'Yes', 
                      quantity: Math.abs(qty), 
                      avgPrice: avg, 
                      cost: Math.abs(p.total_cost || 0), 
                      fees: Math.abs(p.fees_paid || 0),   
                      status: 'HELD', 
                      isOrder: false,
                      settlementStatus: p.settlement_status,
                      realizedPnl: p.realized_pnl
                  };
              })
          ].filter(p => {
             if (p.isOrder) return true;
             // Allow items with 0 quantity if they have PnL (history)
             if (p.quantity <= 0 && (!p.realizedPnl && !p.settlementStatus)) return false;
             return true;
          });
          
          setPositions(mappedItems);
      } catch (e) { console.error("Portfolio Error", e); }
  }, [walletKeys, isForgeReady]);

  useEffect(() => { 
      if (walletKeys) { fetchPortfolio(); const i = setInterval(fetchPortfolio, 5000); return () => clearInterval(i); }
  }, [walletKeys, fetchPortfolio]);

  const executeOrder = async (marketOrTicker, price, isSell, qtyOverride, source = 'manual') => {
      if (!walletKeys) return setIsWalletOpen(true);
      if (!isForgeReady) return alert("Security library loading...");
      
      const ticker = isSell ? marketOrTicker : marketOrTicker.realMarketId;
      const qty = qtyOverride || config.tradeSize;
      
      if (source !== 'manual') {
          setActiveAction({ type: isSell ? 'CLOSE' : 'BID', ticker, price });
          setTimeout(() => setActiveAction(null), 3000);
      }

      try {
          const ts = Date.now();
          // For sell orders (auto-close), we use limit order at 1 cent to ensure execution at best bid
          // This avoids the "missing price" error and guarantees a fill if any bid exists >= 1 cent.
          const effectivePrice = isSell ? (price || 1) : price;

          const body = JSON.stringify({
              action: isSell ? 'sell' : 'buy',
              ticker,
              count: qty,
              type: 'limit',
              side: 'yes',
              yes_price: effectivePrice
          });
          const sig = signRequest(walletKeys.privateKey, "POST", '/trade-api/v2/portfolio/orders', ts);
          
          const res = await fetch('/api/kalshi/portfolio/orders', {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'KALSHI-ACCESS-KEY': walletKeys.keyId, 'KALSHI-ACCESS-SIGNATURE': sig, 'KALSHI-ACCESS-TIMESTAMP': ts.toString() },
              body
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || "Order Failed");

          console.log(`Order Placed: ${data.order_id}`);

          if (isSell) {
             addLog(`Closing position on ${ticker} (Qty: ${qty})`, 'CLOSE');
          } else {
             const mktId = marketOrTicker.realMarketId || marketOrTicker.id;
             addLog(`Placed bid on ${mktId} @ ${price}¢ (Qty: ${qty})`, 'BID');
          }

          if (!isSell) {
              autoBidTracker.current.add(ticker);
              setTradeHistory(prev => ({ ...prev, [ticker]: { 
                  ticker, orderId: data.order_id, event: marketOrTicker.event, oddsTime: marketOrTicker.lastChange, 
                  orderPlacedAt: Date.now(), 
                  sportsbookOdds: marketOrTicker.sportsbookOdds,
                  opposingOdds: marketOrTicker.opposingOdds, 
                  oddsDisplay: marketOrTicker.oddsDisplay, 
                  impliedProb: marketOrTicker.impliedProb, 
                  vigFreeProb: marketOrTicker.vigFreeProb,
                  fairValue: marketOrTicker.fairValue, bidPrice: price,
                  bookmakerCount: marketOrTicker.bookmakerCount,
                  oddsSpread: marketOrTicker.oddsSpread
              }}));
          }
          fetchPortfolio();
      } catch (e) { 
          console.error(e); 
          if (!config.isAutoBid && !config.isAutoClose) alert(e.message);
          if (isSell) closingTracker.current.delete(ticker);
          else autoBidTracker.current.delete(ticker);
      }
  };

  useEffect(() => {
      if (!isRunning || !config.isAutoBid || !walletKeys) return;

      const runAutoBid = async () => {
          if (isAutoBidProcessing.current) return;
          isAutoBidProcessing.current = true;

          try {
            // Fix: Only count currently open/held positions towards the limit, ignoring settled history.
            // SCOPE: Only consider markets currently displayed in the scanner to support sport switching without interference.
            const currentMarketIds = new Set(markets.map(m => m.realMarketId));

            const executedHoldings = new Set(positions.filter(p => 
                !p.isOrder && 
                p.quantity > 0 && 
                p.settlementStatus !== 'settled' &&
                currentMarketIds.has(p.marketId)
            ).map(p => p.marketId));

            // Filter activeOrders to only those in the current market list
            const activeOrders = positions.filter(p => 
                p.isOrder && 
                ['active', 'resting', 'bidding', 'pending'].includes(p.status.toLowerCase()) &&
                currentMarketIds.has(p.marketId)
            );

            // We don't want to exceed max positions, but we also want to manage existing bids.
            // So effectiveCount should track held positions + pending bids for *new* markets.
            // We calculate effective count based on held positions AND active orders for current markets.
            const marketsWithOrders = new Set(activeOrders.map(o => o.marketId));
            const occupiedMarkets = new Set([...executedHoldings, ...marketsWithOrders]);
            let effectiveCount = occupiedMarkets.size;

            // --- LIMIT ENFORCEMENT ---
            // If we have reached the max positions, ensure no pending buy orders remain for *new* positions.
            // Note: executedHoldings tracks markets where we have a filled position.
            if (executedHoldings.size >= config.maxPositions) {
                const activeBuyOrders = activeOrders.filter(o => o.action === 'buy');

                if (activeBuyOrders.length > 0) {
                     console.log(`[AUTO-BID] Max positions reached (${executedHoldings.size}/${config.maxPositions}). Cancelling ${activeBuyOrders.length} active buy orders.`);
                     for (const o of activeBuyOrders) {
                         await cancelOrder(o.id, true, true);
                         await new Promise(r => setTimeout(r, 200));
                     }
                     fetchPortfolio();
                }
                isAutoBidProcessing.current = false;
                return;
            }

            // --- DUPLICATE PROTECTION ---
            const orderMap = new Map();
            const duplicates = [];

            for (const o of activeOrders) {
                if (orderMap.has(o.marketId)) {
                    duplicates.push(o);
                } else {
                    orderMap.set(o.marketId, o);
                }
            }
            
            if (duplicates.length > 0) {
                console.log("[AUTO-BID] Cleaning up duplicates...", duplicates);
                for (const d of duplicates) {
                    await cancelOrder(d.id, true, true);
                    await new Promise(r => setTimeout(r, 100));
                }
                fetchPortfolio();
                return; // Exit to let state settle
            }
            // ---------------------------

            const activeOrderTickers = new Set(activeOrders.map(o => o.marketId));

            for (const m of markets) {
                if (!m.isMatchFound) continue;

                // Check for held position
                if (executedHoldings.has(m.realMarketId)) {
                    if (autoBidTracker.current.has(m.realMarketId)) autoBidTracker.current.delete(m.realMarketId);
                    continue;
                }

                const existingOrder = activeOrders.find(o => o.marketId === m.realMarketId);

                if (existingOrder && autoBidTracker.current.has(m.realMarketId)) {
                    autoBidTracker.current.delete(m.realMarketId);
                }

                // Prevent race condition if we are already acting on this market
                if (autoBidTracker.current.has(m.realMarketId)) continue;

                const { smartBid, maxWillingToPay } = calculateStrategy(m, config.marginPercent);

                if (existingOrder) {
                    // 1. Check if order is stale or bad
                    if (smartBid === null || smartBid > maxWillingToPay) {
                        // Strategy says don't bid (loss of edge), but we have an order. Cancel it.
                        console.log(`[AUTO-BID] Cancelling stale/bad order ${m.realMarketId} (Bid: ${existingOrder.price}, Max: ${maxWillingToPay})`);
                        autoBidTracker.current.add(m.realMarketId);
                        await cancelOrder(existingOrder.id, true);
                        await new Promise(r => setTimeout(r, 200)); // Delay
                        continue;
                    }

                    if (existingOrder.price !== smartBid) {
                        // Price improvement or adjustment needed
                        console.log(`[AUTO-BID] Updating ${m.realMarketId}: ${existingOrder.price}¢ -> ${smartBid}¢`);
                        addLog(`Updating bid ${m.realMarketId}: ${existingOrder.price}¢ -> ${smartBid}¢`, 'UPDATE');
                        autoBidTracker.current.add(m.realMarketId);

                        // Cancel then Place
                        try {
                            await cancelOrder(existingOrder.id, true);
                            await new Promise(r => setTimeout(r, 200)); // Delay
                            await executeOrder(m, smartBid, false, null, 'auto');
                            await new Promise(r => setTimeout(r, 200)); // Delay
                        } catch (e) {
                            console.error("Update failed", e);
                            autoBidTracker.current.delete(m.realMarketId);
                        }
                    }
                    // Else: Order is good, do nothing.
                    continue;
                }

                // New Bid Logic
                if (effectiveCount >= config.maxPositions) continue;

                // Check if we already have an active order (should be covered by existingOrder check, but double check)
                if (activeOrderTickers.has(m.realMarketId)) continue;

                if (smartBid && smartBid <= maxWillingToPay) {
                    console.log(`[AUTO-BID] New Bid ${m.realMarketId} @ ${smartBid}¢`);
                    effectiveCount++;
                    autoBidTracker.current.add(m.realMarketId);
                    await executeOrder(m, smartBid, false, null, 'auto');
                    await new Promise(r => setTimeout(r, 200)); // Delay
                }
            }
          } finally {
              isAutoBidProcessing.current = false;
          }
      };
      
      runAutoBid();

  }, [isRunning, config.isAutoBid, markets, positions, config.marginPercent, config.maxPositions]);

  useEffect(() => {
      if (!isRunning || !config.isAutoClose || !walletKeys) return;
      
      const runAutoClose = async () => {
          const heldPositions = positions.filter(p => !p.isOrder && p.status === 'HELD' && p.quantity > 0 && p.settlementStatus !== 'settled');
          
          for (const pos of heldPositions) {
              if (closingTracker.current.has(pos.marketId)) continue;

              // Check 1: Must be opened by bot (in tradeHistory)
              const history = tradeHistory[pos.marketId];
              if (!history) continue;

              const m = markets.find(x => x.realMarketId === pos.marketId);
              const currentBid = m ? m.bestBid : 0; 
              const target = pos.avgPrice * (1 + config.autoCloseMarginPercent/100);

              if (currentBid >= target) {
                  console.log(`[AUTO-CLOSE] ${pos.marketId}: ${currentBid} >= ${target}`);
                  closingTracker.current.add(pos.marketId);
                  await executeOrder(pos.marketId, 0, true, pos.quantity, 'auto');
                  await new Promise(r => setTimeout(r, 200)); // Delay
              }
          }
      };

      runAutoClose();
  }, [isRunning, config.isAutoClose, markets, positions]);

  // --- CANCEL ALL ON STOP ---
  const isAutoBidActive = isRunning && config.isAutoBid;
  const prevAutoBidActiveRef = useRef(isAutoBidActive);

  useEffect(() => {
      const wasActive = prevAutoBidActiveRef.current;
      const isActive = isAutoBidActive;

      if (wasActive && !isActive) {
          const openOrders = positions.filter(p => p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status.toLowerCase()));

          const cancelAllSafe = async () => {
              if (openOrders.length > 0) {
                  console.log(`[AUTO-STOP] Bot stopped. Cancelling ${openOrders.length} open orders sequentially.`);
                  setIsCancelling(true);
                  setCancellationProgress({ current: 0, total: openOrders.length });

                  let processed = 0;
                  for (const o of openOrders) {
                      await cancelOrder(o.id, true, true);
                      processed++;
                      setCancellationProgress(prev => ({ ...prev, current: processed }));
                      await new Promise(r => setTimeout(r, 200)); // Rate limit protection
                  }
                  console.log("[AUTO-STOP] All orders cancelled.");
                  fetchPortfolio();
              }
              setIsCancelling(false);
          };

          cancelAllSafe().catch(e => {
              console.error("Failed to cancel orders on stop", e);
              setIsCancelling(false);
          });
      }
      prevAutoBidActiveRef.current = isActive;
  }, [isAutoBidActive, positions]);

  const handleSort = (key) => {
      setSortConfig(current => ({
          key,
          direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
      }));
  };

  const handlePortfolioSort = (key) => {
      setPortfolioSortConfig(current => ({
          key,
          direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
      }));
  };

  const cancelOrder = async (id, skipConfirm = false, skipRefresh = false) => {
      if (!skipConfirm && !confirm("Cancel Order?")) return;
      const ts = Date.now();
      const sig = signRequest(walletKeys.privateKey, "DELETE", `/trade-api/v2/portfolio/orders/${id}`, ts);
      const res = await fetch(`/api/kalshi/portfolio/orders/${id}`, { method: 'DELETE', headers: { 'KALSHI-ACCESS-KEY': walletKeys.keyId, 'KALSHI-ACCESS-SIGNATURE': sig, 'KALSHI-ACCESS-TIMESTAMP': ts.toString() }});
      if (res.ok) {
          addLog(`Canceled order ${id}`, 'CANCEL');
      }
      if (!skipRefresh) fetchPortfolio();
      return res;
  };

  const groupedMarkets = useMemo(() => {
      const enriched = markets.map(m => {
          const { smartBid, edge, reason, maxWillingToPay } = calculateStrategy(m, config.marginPercent);
          return { ...m, smartBid, edge, reason, maxWillingToPay };
      });

      const groups = {};
      enriched.forEach(market => {
          const dateObj = new Date(market.commenceTime);
          const dateKey = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          if (!groups[dateKey]) groups[dateKey] = [];
          groups[dateKey].push(market);
      });

      Object.keys(groups).forEach(key => {
          groups[key].sort((a, b) => {
              if (!a.isMatchFound && b.isMatchFound) return 1;
              if (a.isMatchFound && !b.isMatchFound) return -1;
              const aVal = a[sortConfig.key];
              const bVal = b[sortConfig.key];
              if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
              if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
              return 0;
          });
      });

      return Object.entries(groups).sort((a, b) => {
           const dateA = new Date(a[1][0].commenceTime);
           const dateB = new Date(b[1][0].commenceTime);
           return dateA - dateB;
      });
  }, [markets, config.marginPercent, sortConfig]);

  if (!isForgeReady) {
      return (
          <div className="flex h-screen items-center justify-center bg-slate-50 text-slate-500">
              <div className="flex flex-col items-center gap-2">
                  <Loader2 className="animate-spin text-blue-600" size={32} />
                  <p>Initializing Security Libraries...</p>
              </div>
          </div>
      );
  }

  const activeContent = positions.filter(p => {
      if (activeTab === 'positions') {
          return !p.isOrder && p.quantity > 0 && (!p.settlementStatus || p.settlementStatus === 'unsettled');
      }
      if (activeTab === 'resting') {
          return p.isOrder && ['active', 'resting', 'pending'].includes(p.status.toLowerCase());
      }
      if (activeTab === 'history') {
          return !p.isOrder && ((p.settlementStatus && p.settlementStatus !== 'unsettled') || p.quantity === 0);
      }
      return false;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <CancellationModal isOpen={isCancelling} progress={cancellationProgress} />
      <Header balance={balance} isRunning={isRunning} setIsRunning={setIsRunning} lastUpdated={lastUpdated} isTurboMode={config.isTurboMode} onConnect={() => setIsWalletOpen(true)} connected={!!walletKeys} wsStatus={wsStatus} onOpenSettings={() => setIsSettingsOpen(true)} onOpenExport={() => setIsExportOpen(true)} apiUsage={apiUsage} />

      <StatsBanner positions={positions} tradeHistory={tradeHistory} balance={balance} sessionStart={sessionStart} isRunning={isRunning} />

      <ConnectModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} onConnect={k => {setWalletKeys(k); localStorage.setItem('kalshi_keys', JSON.stringify(k));}} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={config} setConfig={setConfig} oddsApiKey={oddsApiKey} setOddsApiKey={setOddsApiKey} sportsList={sportsList} />
      <DataExportModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} tradeHistory={tradeHistory} positions={positions} />

      <AnalysisModal data={analysisModalData} onClose={() => setAnalysisModalData(null)} />
      
      <PositionDetailsModal 
          position={selectedPosition} 
          market={selectedPosition ? markets.find(m => m.realMarketId === selectedPosition.marketId) : null}
          onClose={() => setSelectedPosition(null)} 
      />

      <ActionToast action={activeAction} />
      
      {errorMsg && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded flex items-center gap-2"><AlertCircle size={16}/>{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col max-h-[800px]">
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-3">
                    <h2 className="font-bold text-slate-700 flex items-center gap-2"><Activity size={18} className={isRunning ? "text-emerald-500" : "text-slate-400"}/> Market Scanner</h2>
                    <SportFilter selected={config.selectedSports} options={sportsList} onChange={(s) => setConfig({...config, selectedSports: s})}/>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setConfig(c => ({...c, isAutoBid: !c.isAutoBid}))} className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1 ${config.isAutoBid ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-500' : 'bg-slate-100 text-slate-400'}`}><Bot size={14}/> Auto-Bid {config.isAutoBid ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setConfig(c => ({...c, isAutoClose: !c.isAutoClose}))} className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1 ${config.isAutoClose ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-500' : 'bg-slate-100 text-slate-400'}`}><Bot size={14}/> Auto-Close {config.isAutoClose ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setConfig(c => ({...c, isTurboMode: !c.isTurboMode}))} className={`p-1.5 rounded transition-all ${config.isTurboMode ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-400'}`}><Zap size={16} fill={config.isTurboMode ? "currentColor" : "none"}/></button>
                </div>
            </div>
            <div className="overflow-auto flex-1">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                        <tr>
                            <SortableHeader label="Event" sortKey="event" currentSort={sortConfig} onSort={handleSort} />
                            <SortableHeader label="Implied Fair Value" sortKey="fairValue" currentSort={sortConfig} onSort={handleSort} align="center" />
                            <SortableHeader label="Vol" sortKey="volatility" currentSort={sortConfig} onSort={handleSort} align="center" />
                            <SortableHeader label="Bid / Ask" sortKey="bestBid" currentSort={sortConfig} onSort={handleSort} align="center" />
                            <SortableHeader label="Max Limit" sortKey="maxWillingToPay" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortableHeader label="Smart Bid" sortKey="smartBid" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                    </thead>
                    {groupedMarkets.map(([dateKey, groupMarkets]) => (
                        <React.Fragment key={dateKey}>
                            <tbody className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <td colSpan={6} className="px-4 py-2 font-bold text-xs text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                        <Calendar size={14} /> {dateKey}
                                    </td>
                                </tr>
                            </tbody>
                            <tbody className="divide-y divide-slate-50">
                                {groupMarkets.map(m => (
                                    <MarketRow key={m.id} market={m} onExecute={(mkt, price, isSell, qty) => executeOrder(mkt, price, isSell, qty, 'manual')} marginPercent={config.marginPercent} tradeSize={config.tradeSize} />
                                ))}
                            </tbody>
                        </React.Fragment>
                    ))}
                </table>
                {markets.length === 0 && <div className="p-10 text-center text-slate-400">Loading Markets...</div>}
            </div>
        </div>

        <div className="space-y-6 flex flex-col h-full lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col min-h-[300px]">
                <div className="flex border-b border-slate-100 bg-slate-50/50">
                    {['positions', 'resting', 'history'].map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${activeTab === tab ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-slate-400'}`}>{tab}</button>
                    ))}
                </div>
                
                <PortfolioSection 
                    activeTab={activeTab} 
                    positions={activeContent} 
                    markets={markets} 
                    tradeHistory={tradeHistory}
                    onAnalysis={(item) => setAnalysisModalData({ ...tradeHistory[item.marketId], currentStatus: item.settlementStatus || item.status })}
                    onCancel={cancelOrder}
                    onExecute={executeOrder}
                    sortConfig={portfolioSortConfig}
                    onSort={handlePortfolioSort}
                />
            </div>
            <EventLog logs={eventLogs} />
        </div>
      </div>
    </div>
  );
};

export default KalshiDashboard;
