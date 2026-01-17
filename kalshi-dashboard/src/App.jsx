// File: src/App.jsx
import React, { useState, useEffect, useCallback, useRef, useMemo, useId } from 'react';
import { Settings, Play, Pause, TrendingUp, DollarSign, AlertCircle, Briefcase, Activity, Trophy, Clock, Zap, Wallet, X, Check, Loader2, Hash, ArrowUp, ArrowDown, Calendar, XCircle, Bot, Wifi, WifiOff, Info, FileText, Droplets, Calculator, ChevronDown, Eye, EyeOff, Upload, Trash2 } from 'lucide-react';
import { SPORT_MAPPING } from './utils/kalshiMatching';
import { buildKalshiIndex, findMatchInIndex, logIndexStats } from './utils/marketIndexing';
import {
    americanToProbability,
    calculateVolatility,
    probabilityToAmericanOdds,
    formatDuration,
    formatMoney,
    formatOrderDate,
    formatGameTime,
    calculateStrategy,
    calculateKalshiFees,
    signRequest,
    calculateUnrealizedPnL,
    calculateBreakEvenPrice,
    calculateHoldDuration,
    formatHoldDuration,
    calculateEdge,
    calculateDistanceFromMarket,
    calculateTargetPnL,
    formatPercentReturn,
    calculateSessionMetrics
} from './utils/core';
import { createOrderManager } from './bot/orderManager';
import { runAutoBid } from './bot/autoBid';
import { runAutoClose } from './bot/autoClose';

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

const REFRESH_COOLDOWN = 10000; 
const STALE_DATA_THRESHOLD = 30000; // 30 seconds

// ==========================================
// 3. SUB-COMPONENTS
// ==========================================

const TimeContext = React.createContext(Date.now());

const TimeProvider = ({ children }) => {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const i = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(i);
    }, []);
    return <TimeContext.Provider value={now}>{children}</TimeContext.Provider>;
};

const useModalClose = (isOpen, onClose) => {
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    return {
        onClick: (e) => {
            if (e.target === e.currentTarget) onClose();
        }
    };
};

const ScheduleModal = ({ isOpen, onClose, schedule, setSchedule, config }) => {
    const backdropProps = useModalClose(isOpen, onClose);

    if (!isOpen) return null;

    // Helper to calculate estimate
    const calculateEstimate = () => {
        if (!schedule.start || !schedule.end) return 0;
        const [startH, startM] = schedule.start.split(':').map(Number);
        const [endH, endM] = schedule.end.split(':').map(Number);

        let startMin = startH * 60 + startM;
        let endMin = endH * 60 + endM;

        if (endMin <= startMin) endMin += 24 * 60;

        const durationMinutes = endMin - startMin;
        if (durationMinutes <= 0) return 0;

        const intervalSeconds = config.isTurboMode ? 3 : 15;
        const requestsPerMinute = 60 / intervalSeconds;
        const numSports = config.selectedSports.length;

        // Total requests = duration * requests/min * numSports
        return Math.round(durationMinutes * requestsPerMinute * numSports);
    };

    const estimate = calculateEstimate();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" {...backdropProps}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Clock size={18}/> Schedule Run</h3>
                    <button aria-label="Close" onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between">
                         <span className="font-bold text-slate-700">Enable Schedule</span>
                         <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" aria-label="Enable Schedule" checked={schedule.enabled} onChange={e => setSchedule({...schedule, enabled: e.target.checked})} className="sr-only peer"/>
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="schedule-start" className="block text-xs font-bold text-slate-500 mb-1">Start Time</label>
                            <input id="schedule-start" type="time" value={schedule.start} onChange={e => setSchedule({...schedule, start: e.target.value})} className="w-full p-2 border rounded" />
                        </div>
                        <div>
                            <label htmlFor="schedule-end" className="block text-xs font-bold text-slate-500 mb-1">End Time</label>
                            <input id="schedule-end" type="time" value={schedule.end} onChange={e => setSchedule({...schedule, end: e.target.value})} className="w-full p-2 border rounded" />
                        </div>
                    </div>

                     <div>
                        <label className="block text-xs font-bold text-slate-500 mb-2">Active Days</label>
                        <div className="flex justify-between gap-1">
                            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((dayName, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    aria-label={dayName}
                                    aria-pressed={schedule.days.includes(i)}
                                    title={dayName}
                                    onClick={() => {
                                        const newDays = schedule.days.includes(i) ? schedule.days.filter(d => d !== i) : [...schedule.days, i];
                                        setSchedule({...schedule, days: newDays});
                                    }}
                                    className={`w-8 h-8 rounded-full text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${schedule.days.includes(i) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                                >
                                    {dayName[0]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                         <div className="text-xs font-bold text-slate-500 uppercase mb-2">Resource Estimate</div>
                         <div className="flex justify-between items-center mb-1">
                             <span className="text-sm text-slate-600">Selected Sports</span>
                             <span className="font-mono font-bold">{config.selectedSports.length}</span>
                         </div>
                         <div className="flex justify-between items-center mb-1">
                             <span className="text-sm text-slate-600">Update Interval</span>
                             <span className="font-mono font-bold">{config.isTurboMode ? '3s' : '15s'}</span>
                         </div>
                         <div className="border-t border-slate-200 my-2 pt-2 flex justify-between items-center">
                             <span className="text-sm font-bold text-slate-700">Estimated Tokens</span>
                             <span className="font-mono font-bold text-blue-600">{estimate.toLocaleString()}</span>
                         </div>
                          <p className="text-[10px] text-slate-400 mt-1">
                            * Based on currently selected sports and update speed. Actual usage may vary.
                        </p>
                    </div>

                </div>
                 <div className="p-4 bg-slate-50 border-t border-slate-100 text-right">
                    <button onClick={onClose} className="px-6 py-2 bg-slate-900 text-white rounded-lg font-bold text-sm hover:bg-slate-800">Save</button>
                </div>
            </div>
        </div>
    );
};

const SportFilter = ({ selected, options, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);
    const dropdownId = useId();

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    return (
        <div className="relative" ref={containerRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-controls={dropdownId}
                aria-label="Filter by Sport"
                className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
                <Trophy size={14} className="text-blue-500"/>
                {selected.length === 0 ? 'Select Sports' : `${selected.length} Sport${selected.length > 1 ? 's' : ''}`}
                <ChevronDown size={12} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}/>
            </button>
            {isOpen && (
                <div
                    id={dropdownId}
                    role="dialog"
                    aria-label="Select Sports"
                    className="absolute top-full left-0 mt-2 w-[85vw] md:w-[600px] max-w-[600px] bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                >
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
                                        className={`text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all border focus:outline-none focus:ring-2 focus:ring-blue-500 ${
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
                        <div
                            role="progressbar"
                            aria-valuenow={percentage}
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-label="Cancellation Progress"
                            className="w-full bg-slate-100 h-2 rounded-full overflow-hidden"
                        >
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

// Performance Alerts Component
const PerformanceAlerts = ({ positions, tradeHistory, sessionStart }) => {
    const alerts = useMemo(() => {
        const warnings = [];
        const sessionMetrics = calculateSessionMetrics(positions, tradeHistory);

        // Alert: Negative P&L with significant sample
        if (sessionMetrics.settledTrades >= 5 && sessionMetrics.totalRealizedPnL < -500) {
            warnings.push({
                level: 'error',
                icon: '⛔',
                message: `Session is down ${formatMoney(sessionMetrics.totalRealizedPnL)}. Consider reviewing strategy settings.`
            });
        }

        // Alert: Low win rate
        if (sessionMetrics.settledTrades >= 10 && sessionMetrics.winRate < 40) {
            warnings.push({
                level: 'warning',
                icon: '⚠️',
                message: `Win rate is ${sessionMetrics.winRate.toFixed(0)}% (target: 50%+). Check margin settings.`
            });
        }

        // Alert: Large drawdown
        if (sessionMetrics.maxDrawdown < -1000) {
            warnings.push({
                level: 'error',
                icon: '📉',
                message: `Max drawdown: ${formatMoney(sessionMetrics.maxDrawdown)}. Consider reducing position size.`
            });
        }

        // Alert: Poor Sharpe ratio with enough trades
        if (sessionMetrics.settledTrades >= 15 && sessionMetrics.sharpeRatio < 0.5) {
            warnings.push({
                level: 'warning',
                icon: '📊',
                message: `Sharpe ratio is ${sessionMetrics.sharpeRatio.toFixed(2)} (target: 1.0+). Risk-adjusted returns are low.`
            });
        }

        // Info: Great session
        if (sessionMetrics.settledTrades >= 5 && sessionMetrics.totalRealizedPnL > 500 && sessionMetrics.winRate > 60) {
            warnings.push({
                level: 'success',
                icon: '🎉',
                message: `Strong session! +${formatMoney(sessionMetrics.totalRealizedPnL)} with ${sessionMetrics.winRate.toFixed(0)}% win rate.`
            });
        }

        // Info: Long running session
        if (sessionStart && (Date.now() - sessionStart) > 3 * 60 * 60 * 1000) { // 3 hours
            warnings.push({
                level: 'info',
                icon: '⏰',
                message: `Session has been running for ${formatDuration(Date.now() - sessionStart)}. Consider saving progress.`
            });
        }

        return warnings;
    }, [positions, tradeHistory, sessionStart]);

    if (alerts.length === 0) return null;

    return (
        <div className="mb-6 space-y-2">
            {alerts.map((alert, i) => (
                <div
                    key={i}
                    className={`p-3 rounded-lg border flex items-start gap-3 ${
                        alert.level === 'error' ? 'bg-rose-50 border-rose-200' :
                        alert.level === 'warning' ? 'bg-amber-50 border-amber-200' :
                        alert.level === 'success' ? 'bg-emerald-50 border-emerald-200' :
                        'bg-blue-50 border-blue-200'
                    }`}
                >
                    <span className="text-lg">{alert.icon}</span>
                    <p className={`text-sm font-medium ${
                        alert.level === 'error' ? 'text-rose-800' :
                        alert.level === 'warning' ? 'text-amber-800' :
                        alert.level === 'success' ? 'text-emerald-800' :
                        'text-blue-800'
                    }`}>
                        {alert.message}
                    </p>
                </div>
            ))}
        </div>
    );
};

const StatsBanner = ({ positions, tradeHistory, balance, sessionStart, isRunning }) => {
    const now = React.useContext(TimeContext);

    // Optimization: Memoize expensive stats calculations to prevent re-computation on every timer tick
    const stats = useMemo(() => {
        let exposure = 0;
        let totalRealizedPnl = 0;
        let totalPotentialReturn = 0;
        let historyCount = 0;

        let autoBidCount = 0;
        let autoBidWins = 0;
        let sumPnl = 0;
        let sumSqPnl = 0;

        // ⚡ Bolt Optimization: Consolidated multiple array traversals into a single O(N) loop
        for (const p of positions) {
            // Exposure Logic
            if (p.isOrder && ['active', 'resting', 'bidding', 'pending'].includes(p.status?.toLowerCase())) {
                exposure += (p.price * (p.quantity - p.filled));
            } else if (!p.isOrder && p.status === 'HELD') {
                exposure += p.cost;
                // Potential Return
                totalPotentialReturn += ((p.quantity * 100) - p.cost);
            }

            // History / Realized PnL Logic
            if (!p.isOrder && (p.settlementStatus === 'settled' || p.realizedPnl)) {
                const rPnl = p.realizedPnl || 0;
                totalRealizedPnl += rPnl;
                historyCount++;

                // Auto-Bid Stats for Win Rate & T-Stat
                if (tradeHistory && tradeHistory[p.marketId] && tradeHistory[p.marketId].source === 'auto') {
                    autoBidCount++;
                    if (rPnl > 0) autoBidWins++;
                    sumPnl += rPnl;
                    sumSqPnl += rPnl * rPnl;
                }
            }
        }

        const winRate = autoBidCount > 0 ? Math.round((autoBidWins / autoBidCount) * 100) : 0;

        // Inline T-Statistic Calculation (Welford/Standard Variance) to avoid creating intermediate PnL array
        let tStat = 0;
        let isSignificant = false;

        if (autoBidCount >= 5) {
            const mean = sumPnl / autoBidCount;
            const variance = (sumSqPnl - (sumPnl * sumPnl) / autoBidCount) / (autoBidCount - 1);
            const stdDev = Math.sqrt(Math.max(0, variance));

            if (stdDev > 0) {
                const stdError = stdDev / Math.sqrt(autoBidCount);
                tStat = mean / stdError;
                isSignificant = Math.abs(tStat) > 2.0;
            }
        }

        return { exposure, totalRealizedPnl, totalPotentialReturn, winRate, tStat, isSignificant, historyCount };
    }, [positions, tradeHistory]);

    const elapsed = sessionStart ? now - sessionStart : 0;

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
             <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Wallet size={12} /> Total Exposure
                </div>
                <div className="text-2xl font-bold text-slate-800 mt-1">
                    {formatMoney(stats.exposure)}
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
                    +{formatMoney(stats.totalPotentialReturn)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                    If all positions win
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Trophy size={12} /> Realized PnL
                </div>
                <div className={`text-2xl font-bold mt-1 ${stats.totalRealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {stats.totalRealizedPnl > 0 ? '+' : ''}{formatMoney(stats.totalRealizedPnl)}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                    {stats.historyCount} settled events
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Activity size={12} /> Win Rate
                </div>
                <div className="text-2xl font-bold text-slate-800 mt-1">
                    {stats.winRate}%
                </div>
                <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-emerald-500 h-full" style={{width: `${stats.winRate}%`}}></div>
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Calculator size={12} /> Statistical Sig.
                </div>
                <div className={`text-2xl font-bold mt-1 ${stats.isSignificant ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {stats.tStat.toFixed(2)}
                </div>
                <div className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    {stats.isSignificant ? <Check size={12} className="text-emerald-500"/> : <XCircle size={12}/>}
                    {stats.isSignificant ? 'Significant' : 'Not Sig'} (α=0.05)
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

const RangeSetting = ({ id, label, value, onChange, min, max, unit = '', colorClass, accentClass, helpText }) => {
    return (
        <div>
            <div className="flex justify-between items-center mb-2">
                <label htmlFor={`${id}-input`} className="text-xs font-bold text-slate-500">{label}</label>
                <div className="flex items-center gap-1">
                    <input
                        type="number"
                        id={`${id}-input`}
                        min={min}
                        max={max}
                        value={value}
                        onChange={e => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val)) onChange(Math.max(min, Math.min(max, val)));
                        }}
                        className={`w-12 text-right text-xs font-bold ${colorClass} border-b border-slate-200 focus:outline-none focus:border-current bg-transparent p-0`}
                    />
                    <span className={`text-xs font-bold ${colorClass}`}>{unit}</span>
                </div>
            </div>
            <input
                id={id}
                type="range"
                aria-label={label}
                aria-describedby={helpText ? `${id}-help` : undefined}
                min={min}
                max={max}
                value={value}
                onChange={e => onChange(parseInt(e.target.value))}
                className={`w-full ${accentClass} h-1.5 bg-slate-200 rounded-lg cursor-pointer`}
            />
            {helpText && <p id={`${id}-help`} className="text-[10px] text-slate-400 mt-1">{helpText}</p>}
        </div>
    );
};

const SettingsModal = ({ isOpen, onClose, config, setConfig, oddsApiKey, setOddsApiKey, sportsList }) => {
    const backdropProps = useModalClose(isOpen, onClose);
    const bidMarginId = useId();
    const closeMarginId = useId();
    const minFvId = useId();
    const maxPosId = useId();
    const [showApiKey, setShowApiKey] = useState(false);

    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" {...backdropProps}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-100 flex-shrink-0">
                    <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Settings size={18}/> Bot Configuration</h3>
                    <button aria-label="Close" onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto flex-1">
                    <RangeSetting
                        id={bidMarginId}
                        label="Auto-Bid Margin"
                        value={config.marginPercent}
                        onChange={v => setConfig({...config, marginPercent: v})}
                        min={1}
                        max={30}
                        unit="%"
                        colorClass="text-blue-600"
                        accentClass="accent-blue-600"
                        helpText={<>Bot will bid <code>FairValue * (1 - Margin)</code></>}
                    />

                    <RangeSetting
                        id={closeMarginId}
                        label="Auto-Close Margin"
                        value={config.autoCloseMarginPercent}
                        onChange={v => setConfig({...config, autoCloseMarginPercent: v})}
                        min={1}
                        max={50}
                        unit="%"
                        colorClass="text-emerald-600"
                        accentClass="accent-emerald-600"
                        helpText={<>Bot will ask <code>(FairValue or BreakEven) * (1 + Margin)</code></>}
                    />

                    <RangeSetting
                        id={minFvId}
                        label="Min Fair Value"
                        value={config.minFairValue}
                        onChange={v => setConfig({...config, minFairValue: v})}
                        min={1}
                        max={80}
                        unit="¢"
                        colorClass="text-indigo-600"
                        accentClass="accent-indigo-600"
                        helpText="Bot will ignore markets with a Fair Value below this threshold."
                    />

                    <RangeSetting
                        id={maxPosId}
                        label="Max Positions"
                        value={config.maxPositions}
                        onChange={v => setConfig({...config, maxPositions: v})}
                        min={1}
                        max={20}
                        colorClass="text-rose-600"
                        accentClass="accent-rose-600"
                    />

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="trade-size" className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Trade Size (Contracts)</label>
                            <input id="trade-size" type="number" value={config.tradeSize} onChange={e => setConfig({...config, tradeSize: parseInt(e.target.value) || 1})} className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"/>
                        </div>
                    </div>

                    {/* Risk Management Section */}
                    <div className="border-t border-slate-200 pt-6">
                        <h4 className="text-xs font-bold text-slate-600 uppercase mb-4 flex items-center gap-2">
                            <AlertCircle size={14} />
                            Risk Management
                        </h4>

                        <div className="space-y-4">
                            {/* Sport Diversification */}
                            <div className="flex items-center justify-between">
                                <label htmlFor="enable-sport-div" className="text-sm text-slate-700 flex-1">
                                    Sport Diversification
                                    <div className="text-xs text-slate-500 mt-0.5">Limit positions per sport to reduce correlation risk</div>
                                </label>
                                <input
                                    id="enable-sport-div"
                                    type="checkbox"
                                    checked={config.enableSportDiversification}
                                    onChange={e => setConfig({...config, enableSportDiversification: e.target.checked})}
                                    className="w-4 h-4 accent-blue-600"
                                />
                            </div>

                            {config.enableSportDiversification && (
                                <div className="ml-4">
                                    <label htmlFor="max-per-sport" className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Max Per Sport</label>
                                    <input
                                        id="max-per-sport"
                                        type="number"
                                        value={config.maxPositionsPerSport}
                                        onChange={e => setConfig({...config, maxPositionsPerSport: parseInt(e.target.value) || 1})}
                                        min={1}
                                        max={config.maxPositions}
                                        className="w-24 p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            )}

                            {/* Liquidity Checks */}
                            <div className="flex items-center justify-between">
                                <label htmlFor="enable-liquidity" className="text-sm text-slate-700 flex-1">
                                    Liquidity Filtering
                                    <div className="text-xs text-slate-500 mt-0.5">Only bid on markets with sufficient volume and tight spreads</div>
                                </label>
                                <input
                                    id="enable-liquidity"
                                    type="checkbox"
                                    checked={config.enableLiquidityChecks}
                                    onChange={e => setConfig({...config, enableLiquidityChecks: e.target.checked})}
                                    className="w-4 h-4 accent-blue-600"
                                />
                            </div>

                            {config.enableLiquidityChecks && (
                                <div className="ml-4 grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="min-liquidity" className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Min Volume</label>
                                        <input
                                            id="min-liquidity"
                                            type="number"
                                            value={config.minLiquidity}
                                            onChange={e => setConfig({...config, minLiquidity: parseInt(e.target.value) || 0})}
                                            min={0}
                                            className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="max-spread" className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Max Spread (¢)</label>
                                        <input
                                            id="max-spread"
                                            type="number"
                                            value={config.maxBidAskSpread}
                                            onChange={e => setConfig({...config, maxBidAskSpread: parseInt(e.target.value) || 1})}
                                            min={1}
                                            max={20}
                                            className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <label htmlFor="odds-api-key" className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">The-Odds-API Key</label>
                        <div className="relative">
                            <input
                                id="odds-api-key"
                                type={showApiKey ? "text" : "password"}
                                value={oddsApiKey}
                                onChange={e => {setOddsApiKey(e.target.value); sessionStorage.setItem('odds_api_key', e.target.value)}}
                                maxLength={100}
                                className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                aria-label={showApiKey ? "Hide API Key" : "Show API Key"}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none focus:text-blue-600"
                            >
                                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    {/* Data Management Section */}
                    <div className="border-t border-slate-200 pt-6">
                        <h4 className="text-xs font-bold text-slate-600 uppercase mb-4 flex items-center gap-2">
                            <Trash2 size={14} />
                            Data Management
                        </h4>

                        <div className="space-y-3">
                            <button
                                onClick={() => {
                                    if (confirm('Clear all trade history and session data? This cannot be undone.')) {
                                        localStorage.removeItem('kalshi_trade_history');
                                        localStorage.removeItem('kalshi_session_history');
                                        window.location.reload();
                                    }
                                }}
                                className="w-full flex items-center justify-between p-3 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors group"
                            >
                                <div className="text-left">
                                    <div className="text-sm font-medium text-rose-800">Clear All History</div>
                                    <div className="text-xs text-rose-600 mt-0.5">Remove all trade history and saved sessions</div>
                                </div>
                                <Trash2 size={18} className="text-rose-600 group-hover:text-rose-700"/>
                            </button>
                        </div>
                    </div>
                </div>
                <div className="p-4 bg-slate-50 border-t border-slate-100 text-right flex-shrink-0">
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
        <div role="status" aria-live="polite" className="fixed bottom-6 right-6 bg-slate-900 text-white p-4 rounded-xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-10 fade-in duration-300 z-50 max-w-sm border border-slate-700/50">
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
    let style = 'text-rose-700 bg-rose-50 border-rose-100';
    let label = 'Thin Mkt';

    if (volume > 5000) {
        style = 'text-emerald-700 bg-emerald-100 border-emerald-200';
        label = 'High Liq';
    } else if (volume > 500) {
        style = 'text-amber-700 bg-amber-100 border-amber-200';
        label = 'Med Liq';
    }

    return (
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide w-fit ${style}`} title={`Vol: ${volume} | OI: ${openInterest}`}>
            <Droplets size={10} /> {label}
        </div>
    );
};

const Header = ({ balance, isRunning, setIsRunning, lastUpdated, isTurboMode, onConnect, connected, wsStatus, wsStats, onOpenSettings, onOpenExport, onOpenSchedule, apiUsage, isScheduled }) => {
    const wsTooltip = wsStats ? `Subscribed: ${wsStats.subscribed} | Confirmed: ${wsStats.confirmed} | Pending: ${wsStats.pending} | Failed: ${wsStats.failed}` : '';

    return (
    <header className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><TrendingUp className="text-blue-600" /> Kalshi ArbBot</h1>
            <div className="flex items-center gap-2 mt-1">
                <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 cursor-help ${
                        wsStatus === 'OPEN' ? 'bg-green-100 text-green-700 border-green-200' :
                        wsStatus === 'ERROR' ? 'bg-red-100 text-red-700 border-red-200' :
                        'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                    title={wsTooltip}
                >
                    {wsStatus === 'OPEN' ? <Wifi size={10}/> : <WifiOff size={10}/>}
                    {wsStatus === 'OPEN' ? `WS LIVE ${wsStats ? `(${wsStats.subscribed})` : ''}` :
                     wsStatus === 'ERROR' ? 'WS ERROR' :
                     'WS OFF'}
                </span>
                {lastUpdated && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 text-slate-500"><Clock size={10} /> {lastUpdated.toLocaleTimeString()}</span>}
                {apiUsage && (
                    <span
                        className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-indigo-50 text-indigo-600 border-indigo-100"
                        title={`Used: ${apiUsage.used} | Remaining: ${apiUsage.remaining}`}
                        aria-label={`API Usage: ${apiUsage.used} requests used of ${apiUsage.used + apiUsage.remaining} total`}
                    >
                        <Hash size={10} /> {apiUsage.used}/{apiUsage.used + apiUsage.remaining}
                    </span>
                )}
                {isTurboMode && <span title="⚠️ Turbo Mode uses 5x more API requests (3s vs 15s polling)" className="text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200 animate-pulse flex items-center gap-1 cursor-help"><Zap size={10} fill="currentColor"/> TURBO</span>}
            </div>
        </div>
        <div className="flex items-center gap-3">
             <button aria-label="Run Schedule" onClick={onOpenSchedule} className={`p-2.5 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${isScheduled ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`} title="Run Schedule">
                <Clock size={20} className={isScheduled ? 'animate-pulse' : ''}/>
            </button>
             <button aria-label="Session Reports" onClick={onOpenExport} className="p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500" title="Session Reports">
                <FileText size={20} />
            </button>
             <button aria-label="Settings" onClick={onOpenSettings} className="p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500" title="Settings">
                <Settings size={20} />
            </button>
            <button onClick={onConnect} className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${connected ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
                {connected ? <Check size={16} /> : <Wallet size={16} />} <span className="font-medium text-sm">{connected ? "Wallet Active" : "Connect Wallet"}</span>
            </button>
            <div className="bg-slate-100 px-4 py-2 rounded-lg border border-slate-200 flex items-center gap-2 min-w-[100px] justify-end">
                <DollarSign size={16} className={connected ? 'text-emerald-600' : 'text-slate-400'}/><span className="font-mono font-bold text-lg text-slate-700">{connected && balance !== null ? (balance / 100).toFixed(2) : '-'}</span>
            </div>
            <button
                onClick={() => {
                    if (isRunning) {
                        // Stopping the bot - save current session
                        saveCurrentSession();
                    }
                    setIsRunning(!isRunning);
                }}
                disabled={isScheduled}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white transition-all shadow-sm active:scale-95 ${
                    isScheduled
                        ? 'bg-slate-300 cursor-not-allowed'
                        : isRunning
                            ? 'bg-amber-500 hover:bg-amber-600'
                            : 'bg-blue-600 hover:bg-blue-700'
                }`}
                title={isScheduled ? "Managed by Schedule" : ""}
            >
                {isScheduled
                    ? <><Clock size={18}/> {isRunning ? 'Running' : 'Waiting'}</>
                    : isRunning
                        ? <><Pause size={18}/> Pause</>
                        : <><Play size={18}/> Start</>
                }
            </button>
        </div>
    </header>
    );
};

const ConnectModal = ({ isOpen, onClose, onConnect }) => {
    const backdropProps = useModalClose(isOpen, onClose);
    const [keyId, setKeyId] = useState('');
    const [privateKey, setPrivateKey] = useState('');
    const [fileName, setFileName] = useState('');
    const [isValidating, setIsValidating] = useState(false);
    const [validationError, setValidationError] = useState('');

    if (!isOpen) return null;

    const handleFile = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Security Enhancement: Limit file size to 10KB to prevent DoS
        const MAX_KEY_SIZE = 10240; // 10KB
        if (file.size > MAX_KEY_SIZE) {
            setValidationError(`File too large (${(file.size/1024).toFixed(1)}KB). Max allowed is 10KB.`);
            setFileName('');
            return;
        }

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
            await signRequest(privateKey, "GET", "/test", Date.now());
            onConnect({keyId, privateKey});
            onClose();
        } catch (e) {
            setValidationError(e.message);
        } finally {
            setIsValidating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" {...backdropProps}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-4">
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800">Connect Kalshi API</h3>
                    <button aria-label="Close" onClick={onClose}><X size={20} className="text-slate-400" /></button>
                </div>
                <div className="space-y-4">
                    {validationError && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded break-words">
                            <strong>Connection Failed:</strong><br/>{validationError}
                        </div>
                    )}
                    <div className="text-xs bg-blue-50 text-blue-800 p-3 rounded flex items-start gap-2">
                        <Info size={14} className="mt-0.5 flex-shrink-0"/>
                        <span>Keys stored locally. Supports standard PKCS#1 keys.</span>
                    </div>

                    <div>
                        <label htmlFor="api-key-id" className="block text-xs font-bold text-slate-500 mb-1 uppercase">
                            API Key ID <span className="text-red-500 ml-1" aria-hidden="true">*</span>
                        </label>
                        <input id="api-key-id" type="text" required value={keyId} onChange={e => setKeyId(e.target.value)} maxLength={100} placeholder="Enter your Key ID" className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>

                    <div>
                        <label htmlFor="private-key-upload" className="block text-xs font-bold text-slate-500 mb-1 uppercase">
                            Private Key <span className="text-red-500 ml-1" aria-hidden="true">*</span>
                        </label>
                        <div className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer relative transition-all group ${fileName ? 'border-emerald-500 bg-emerald-50/30' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'} focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2`}>
                            <input id="private-key-upload" type="file" required aria-label="Upload Private Key" onChange={handleFile} className="absolute inset-0 opacity-0 cursor-pointer" accept=".key,.pem,.txt" />
                            <div className="flex flex-col items-center gap-2">
                                {fileName ? (
                                    <>
                                        <div className="p-2 bg-emerald-100 rounded-full text-emerald-600"><Check size={20} /></div>
                                        <span className="text-emerald-700 font-bold text-sm truncate max-w-[200px]">{fileName}</span>
                                        <span className="text-[10px] text-emerald-500">Ready to sign</span>
                                    </>
                                ) : (
                                    <>
                                        <div className="p-2 bg-slate-100 rounded-full text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-500 transition-colors"><Upload size={20} /></div>
                                        <span className="text-slate-600 font-medium text-sm">Click to upload .key file</span>
                                        <span className="text-[10px] text-slate-400">or drag and drop here</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <button onClick={handleSave} disabled={isValidating} className="w-full bg-slate-900 text-white py-3 rounded font-bold hover:bg-blue-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 outline-none">
                        {isValidating ? 'Validating...' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const AnalysisModal = ({ data, onClose }) => {
    const backdropProps = useModalClose(!!data, onClose);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" {...backdropProps}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-slate-900 p-4 flex justify-between items-center">
                    <div className="text-white font-bold flex items-center gap-2"><Calculator size={18} className="text-blue-400"/> Trade Analysis</div>
                    <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white transition-colors"><X size={20} /></button>
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

const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const escapeCSV = (str) => {
    if (str === null || str === undefined) return '';
    const s = String(str);
    // Sentinel: Prevent CSV Injection (Formula Injection) by quoting fields starting with = + - @
    let safe = s;
    if (/^[=+\-@]/.test(s)) {
        safe = "'" + s;
    }
    // Sentinel: Standard CSV Escaping (wrap in quotes if contains comma, quote, or newline)
    if (/[",\n\r]/.test(safe)) {
        return '"' + safe.replace(/"/g, '""') + '"';
    }
    return safe;
};

const SessionReportModal = ({ isOpen, onClose, tradeHistory, positions, sessionStart, sessionHistory = [] }) => {
    const backdropProps = useModalClose(isOpen, onClose);
    const [activeTab, setActiveTab] = useState('summary');

    if (!isOpen) return null;

    // Calculate comprehensive session metrics
    const sessionMetrics = useMemo(() => calculateSessionMetrics(positions, tradeHistory), [positions, tradeHistory]);
    const sessionDuration = sessionStart ? Date.now() - sessionStart : 0;

    const generateSessionData = () => {
        return Object.entries(tradeHistory).map(([ticker, data]) => {
            const position = positions.find(p => p.marketId === ticker && !p.isOrder);
            const entryTimestamp = data.orderPlacedAt;

            // Use exit tracking data if available, otherwise fallback to position data
            const exitTimestamp = data.exitTimestamp || position?.settled || position?.created;
            const exitPrice = data.exitPrice || (position?.payout && position?.quantity ? Math.floor(position.payout / position.quantity) : null);
            const exitFairValue = data.exitFairValue;
            const exitMethod = data.exitMethod || 'unknown';

            const entryPrice = data.bidPrice;
            const holdDuration = entryTimestamp && exitTimestamp ? exitTimestamp - entryTimestamp : null;

            return {
                // Entry data
                entryTimestamp,
                ticker,
                event: data.event,
                side: position?.side || 'Yes',
                quantity: data.quantity || position?.quantity || 0,

                // Pricing
                entryPrice,
                fairValueAtEntry: data.fairValue,
                entryEdge: data.fairValue - entryPrice,
                exitPrice,
                exitFairValue,
                exitEdge: exitPrice && exitFairValue ? exitPrice - exitFairValue : null,

                // P&L
                pnl: data.realizedPnl || position?.realizedPnl || 0,
                fees: data.totalFees || position?.fees || 0,
                netPnl: (data.realizedPnl || position?.realizedPnl || 0) - (data.totalFees || position?.fees || 0),

                // Status
                status: position ? (position.settlementStatus || position.status) : 'Unknown',
                exitTimestamp,
                exitMethod,
                holdDuration,

                // Market data
                sportsbookOdds: data.sportsbookOdds,
                vigFreeProb: data.vigFreeProb || 0,
                bookmakerCount: Number(data.bookmakerCount || 0),
                oddsSpread: data.oddsSpread || 0,
                latency: (data.orderPlacedAt && data.oddsTime) ? (data.orderPlacedAt - data.oddsTime) : null
            };
        }).sort((a, b) => b.entryTimestamp - a.entryTimestamp);
    };

    const downloadCSV = () => {
        const data = generateSessionData();

        // Enhanced headers with all missing data
        const headers = [
            "Entry Timestamp", "Exit Timestamp", "Hold Duration (ms)",
            "Ticker", "Event", "Side", "Quantity",
            "Entry Price", "Fair Value @ Entry", "Entry Edge",
            "Exit Price", "Fair Value @ Exit", "Exit Edge", "Exit Method",
            "Realized P&L", "Fees", "Net P&L",
            "Status",
            "Sportsbook Odds", "Bookmakers", "Odds Spread", "Vig-Free Prob", "Data Latency (ms)"
        ];

        const rows = data.map(d => [
            d.entryTimestamp ? new Date(d.entryTimestamp).toISOString() : '',
            d.exitTimestamp ? new Date(d.exitTimestamp).toISOString() : '',
            d.holdDuration || '',
            escapeCSV(d.ticker),
            escapeCSV(d.event),
            escapeCSV(d.side),
            d.quantity,
            d.entryPrice,
            d.fairValueAtEntry,
            d.entryEdge.toFixed(2),
            d.exitPrice || '',
            d.exitFairValue || '',
            d.exitEdge !== null ? d.exitEdge.toFixed(2) : '',
            escapeCSV(d.exitMethod),
            (d.pnl / 100).toFixed(2),
            (d.fees / 100).toFixed(2),
            (d.netPnl / 100).toFixed(2),
            escapeCSV(d.status),
            escapeCSV(d.sportsbookOdds),
            d.bookmakerCount,
            Number(d.oddsSpread).toFixed(3),
            Number(d.vigFreeProb).toFixed(2),
            d.latency !== null ? d.latency : ''
        ]);

        // Add session summary as first row
        const summary = [
            `Session Summary: ${sessionMetrics.totalTrades} trades | ${sessionMetrics.settledTrades} settled | Win Rate: ${sessionMetrics.winRate.toFixed(1)}% | Total P&L: $${(sessionMetrics.totalRealizedPnL / 100).toFixed(2)} | ROI: ${sessionMetrics.roi.toFixed(1)}% | Sharpe: ${sessionMetrics.sharpeRatio.toFixed(2)}`
        ];

        const csvContent = [
            summary.join(""),
            "",  // Blank line
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
                                <td>${escapeHtml(d.event)}</td>
                                <td>${escapeHtml(d.ticker)}</td>
                                <td>${escapeHtml(d.fairValue)}</td>
                                <td>${escapeHtml(d.bidPrice)}</td>
                                <td>${escapeHtml(d.edge)}</td>
                                <td>${d.latency !== null ? d.latency : '-'}</td>
                                <td>${Number(d.oddsSpread).toFixed(3)}</td>
                                <td>${escapeHtml(d.status)}</td>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" {...backdropProps}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-200">
                    <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                        <Trophy size={24} className="text-emerald-600"/> Session Report
                    </h3>
                    <button aria-label="Close" onClick={onClose}>
                        <X size={24} className="text-slate-400 hover:text-slate-600" />
                    </button>
                </div>

                {/* Executive Summary */}
                <div className="p-6 bg-gradient-to-br from-emerald-50 to-blue-50 border-b border-slate-200">
                    <div className="text-sm text-slate-600 mb-3">
                        Session: {sessionStart ? new Date(sessionStart).toLocaleString() : 'N/A'} • Duration: {formatHoldDuration(sessionDuration)}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white/80 p-3 rounded-lg">
                            <div className="text-xs text-slate-500 font-bold uppercase">Net P&L</div>
                            <div className={`text-2xl font-bold ${sessionMetrics.netPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {sessionMetrics.netPnL >= 0 ? '+' : ''}{formatMoney(sessionMetrics.netPnL)}
                            </div>
                            <div className="text-xs text-slate-500">ROI: {sessionMetrics.roi >= 0 ? '+' : ''}{sessionMetrics.roi.toFixed(1)}%</div>
                        </div>

                        <div className="bg-white/80 p-3 rounded-lg">
                            <div className="text-xs text-slate-500 font-bold uppercase">Trades</div>
                            <div className="text-2xl font-bold text-slate-800">{sessionMetrics.totalTrades}</div>
                            <div className="text-xs text-slate-500">{sessionMetrics.settledTrades} settled, {sessionMetrics.pendingTrades} pending</div>
                        </div>

                        <div className="bg-white/80 p-3 rounded-lg">
                            <div className="text-xs text-slate-500 font-bold uppercase">Win Rate</div>
                            <div className="text-2xl font-bold text-emerald-600">{sessionMetrics.winRate.toFixed(0)}%</div>
                            <div className="text-xs text-slate-500">{sessionMetrics.wins}W-{sessionMetrics.losses}L-{sessionMetrics.breakevens}BE</div>
                        </div>

                        <div className="bg-white/80 p-3 rounded-lg">
                            <div className="text-xs text-slate-500 font-bold uppercase">Sharpe</div>
                            <div className={`text-2xl font-bold ${sessionMetrics.sharpeRatio > 2 ? 'text-emerald-600' : 'text-slate-600'}`}>
                                {sessionMetrics.sharpeRatio.toFixed(2)}
                            </div>
                            <div className="text-xs text-slate-500">Avg Hold: {formatHoldDuration(sessionMetrics.avgHoldTime)}</div>
                        </div>
                    </div>

                    {/* Best/Worst Trades */}
                    <div className="mt-4 grid grid-cols-2 gap-4">
                        <div className="text-sm">
                            <span className="text-slate-600">🏆 Best: </span>
                            <span className="font-bold text-emerald-600">
                                {sessionMetrics.bestTrade ? `${sessionMetrics.bestTrade.marketId.split('-').pop()} → ${formatMoney(sessionMetrics.largestWin)}` : 'N/A'}
                            </span>
                        </div>
                        <div className="text-sm">
                            <span className="text-slate-600">📉 Worst: </span>
                            <span className="font-bold text-rose-600">
                                {sessionMetrics.worstTrade ? `${sessionMetrics.worstTrade.marketId.split('-').pop()} → ${formatMoney(sessionMetrics.largestLoss)}` : 'N/A'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 px-6">
                    {['summary', 'performance', 'risk', 'history', 'export'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-3 font-medium text-sm capitalize transition-colors ${
                                activeTab === tab
                                    ? 'text-blue-600 border-b-2 border-blue-600'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'summary' && (
                        <div className="space-y-4">
                            <h4 className="font-bold text-slate-800">Key Metrics</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <MetricCard label="Total Trades" value={sessionMetrics.totalTrades} />
                                <MetricCard label="Settled Trades" value={sessionMetrics.settledTrades} />
                                <MetricCard label="Pending Trades" value={sessionMetrics.pendingTrades} />
                                <MetricCard label="Avg Entry Edge" value={`${sessionMetrics.avgEntryEdge.toFixed(1)}¢`} />
                                <MetricCard label="Avg Exit Edge" value={sessionMetrics.avgExitEdge ? `${sessionMetrics.avgExitEdge.toFixed(1)}¢` : 'N/A'} />
                                <MetricCard label="Edge Capture" value={sessionMetrics.edgeCaptureRate ? `${sessionMetrics.edgeCaptureRate.toFixed(0)}%` : 'N/A'} />
                                <MetricCard label="Total Fees" value={formatMoney(sessionMetrics.totalFees)} />
                                <MetricCard label="Gross Profit" value={formatMoney(sessionMetrics.grossProfit)} />
                                <MetricCard label="Gross Loss" value={formatMoney(sessionMetrics.grossLoss)} />
                                <MetricCard label="Unique Markets" value={sessionMetrics.uniqueMarkets} />
                                <MetricCard label="Min Hold Time" value={formatHoldDuration(sessionMetrics.minHoldTime)} />
                                <MetricCard label="Max Hold Time" value={formatHoldDuration(sessionMetrics.maxHoldTime)} />
                            </div>

                            <h4 className="font-bold text-slate-800 mt-6">Sport Breakdown</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {Object.entries(sessionMetrics.sportBreakdown).map(([sport, count]) => (
                                    <div key={sport} className="bg-slate-50 p-3 rounded-lg">
                                        <div className="text-sm text-slate-600">{sport}</div>
                                        <div className="text-xl font-bold text-slate-800">{count}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === 'performance' && (
                        <div className="space-y-4">
                            <h4 className="font-bold text-slate-800">Performance Analysis</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <MetricCard label="Win Rate" value={`${sessionMetrics.winRate.toFixed(1)}%`} />
                                <MetricCard label="Profit Factor" value={(sessionMetrics.grossProfit / Math.max(sessionMetrics.grossLoss, 1)).toFixed(2)} />
                                <MetricCard label="Avg Win" value={sessionMetrics.wins > 0 ? formatMoney(sessionMetrics.grossProfit / sessionMetrics.wins) : '$0.00'} />
                                <MetricCard label="Avg Loss" value={sessionMetrics.losses > 0 ? formatMoney(sessionMetrics.grossLoss / sessionMetrics.losses) : '$0.00'} />
                                <MetricCard label="Largest Win" value={formatMoney(sessionMetrics.largestWin)} />
                                <MetricCard label="Largest Loss" value={formatMoney(sessionMetrics.largestLoss)} />
                            </div>

                            {/* Simple P&L Chart */}
                            <div className="mt-6">
                                <h4 className="font-bold text-slate-800 mb-3">Trade-by-Trade P&L</h4>
                                <div className="bg-slate-50 p-4 rounded-lg font-mono text-sm">
                                    {(() => {
                                        const trades = generateSessionData().filter(t => t.netPnl !== 0).sort((a, b) => a.entryTimestamp - b.entryTimestamp);
                                        if (trades.length === 0) return <div className="text-slate-500 text-center">No settled trades yet</div>;

                                        const maxPnl = Math.max(...trades.map(t => Math.abs(t.netPnl)));
                                        const chartWidth = 50;

                                        return (
                                            <div className="space-y-1">
                                                {trades.map((trade, i) => {
                                                    const barLength = Math.max(1, Math.floor((Math.abs(trade.netPnl) / maxPnl) * chartWidth));
                                                    const isProfit = trade.netPnl >= 0;
                                                    const bar = isProfit ? '█'.repeat(barLength) : '█'.repeat(barLength);

                                                    return (
                                                        <div key={i} className="flex items-center gap-2">
                                                            <span className="text-xs text-slate-500 w-12">{trade.ticker.split('-').pop().slice(0, 5)}</span>
                                                            <span className={`${isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                {isProfit ? bar : bar}
                                                            </span>
                                                            <span className={`text-xs font-bold ${isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                {formatMoney(trade.netPnl)}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Cumulative P&L Line */}
                                <div className="mt-4">
                                    <h4 className="font-bold text-slate-800 mb-3">Cumulative P&L</h4>
                                    <div className="bg-slate-50 p-4 rounded-lg font-mono text-xs">
                                        {(() => {
                                            const trades = generateSessionData().filter(t => t.netPnl !== 0).sort((a, b) => a.entryTimestamp - b.entryTimestamp);
                                            if (trades.length === 0) return <div className="text-slate-500 text-center">No settled trades yet</div>;

                                            let cumulative = 0;
                                            const points = trades.map(t => {
                                                cumulative += t.netPnl;
                                                return cumulative;
                                            });

                                            const maxCum = Math.max(...points, 0);
                                            const minCum = Math.min(...points, 0);
                                            const range = maxCum - minCum || 1;
                                            const chartHeight = 15;

                                            // Create ASCII chart
                                            const chart = Array(chartHeight).fill(null).map(() => Array(trades.length).fill(' '));

                                            points.forEach((point, i) => {
                                                const normalizedHeight = Math.floor(((point - minCum) / range) * (chartHeight - 1));
                                                chart[chartHeight - 1 - normalizedHeight][i] = '●';
                                            });

                                            return (
                                                <div className="space-y-0">
                                                    <div className="text-emerald-600 text-right mb-1">+{formatMoney(maxCum)}</div>
                                                    {chart.map((row, i) => (
                                                        <div key={i} className="leading-none">
                                                            {row.map((char, j) => (
                                                                <span key={j} className={char === '●' ? 'text-blue-600' : 'text-slate-300'}>
                                                                    {char === '●' ? '●' : '·'}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ))}
                                                    <div className="text-rose-600 text-right mt-1">{formatMoney(minCum)}</div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'risk' && (
                        <div className="space-y-4">
                            <h4 className="font-bold text-slate-800">Risk Metrics</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <MetricCard label="Sharpe Ratio" value={sessionMetrics.sharpeRatio.toFixed(2)} />
                                <MetricCard label="Max Drawdown" value={formatMoney(sessionMetrics.maxDrawdown)} />
                                <MetricCard label="Volatility" value={formatMoney(sessionMetrics.volatility)} />
                                <MetricCard label="Current Exposure" value={formatMoney(sessionMetrics.currentExposure)} />
                            </div>
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600 mb-4">
                                View and compare past trading sessions to track long-term performance.
                            </p>

                            {sessionHistory.length === 0 ? (
                                <div className="text-center py-12 text-slate-500">
                                    <p className="mb-2">No saved sessions yet.</p>
                                    <p className="text-sm">Sessions are automatically saved when you stop the bot.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {sessionHistory.map(session => (
                                        <div key={session.sessionId} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <div className="font-bold text-slate-800">
                                                        {new Date(session.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                    </div>
                                                    <div className="text-sm text-slate-500">
                                                        {new Date(session.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - {new Date(session.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                                                    </div>
                                                    <div className="text-xs text-slate-400 mt-1">
                                                        Duration: {formatHoldDuration(session.duration)}
                                                    </div>
                                                </div>
                                                <div className={`text-xl font-bold ${session.metrics.totalRealizedPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {formatMoney(session.metrics.totalRealizedPnL)}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-4 gap-3 text-sm">
                                                <div>
                                                    <div className="text-xs text-slate-500">Trades</div>
                                                    <div className="font-bold text-slate-700">{session.metrics.totalTrades}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-slate-500">Win Rate</div>
                                                    <div className="font-bold text-slate-700">{session.metrics.winRate.toFixed(0)}%</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-slate-500">ROI</div>
                                                    <div className="font-bold text-slate-700">{session.metrics.roi.toFixed(1)}%</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-slate-500">Sharpe</div>
                                                    <div className="font-bold text-slate-700">{session.metrics.sharpeRatio.toFixed(2)}</div>
                                                </div>
                                            </div>

                                            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                                                Config: {session.config.marginPercent}% margin | {session.config.maxPositions} max positions | ${(session.config.tradeSize / 100).toFixed(0)} per trade
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'export' && (
                        <div className="space-y-3">
                            <p className="text-sm text-slate-600 mb-4">
                                Export your complete session data with all entry/exit information, P&L, fees, and hold times.
                            </p>
                            <button onClick={downloadCSV} className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all group">
                                <span className="font-medium text-slate-700 group-hover:text-blue-700">Download Enhanced CSV (Excel)</span>
                                <ArrowDown size={18} className="text-slate-400 group-hover:text-blue-600"/>
                            </button>
                            <button onClick={downloadJSON} className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all group">
                                <span className="font-medium text-slate-700 group-hover:text-blue-700">Download Complete JSON</span>
                                <Hash size={18} className="text-slate-400 group-hover:text-blue-600"/>
                            </button>
                            <button onClick={printReport} className="w-full flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-all group">
                                <span className="font-medium text-slate-700 group-hover:text-blue-700">Print / Save PDF</span>
                                <FileText size={18} className="text-slate-400 group-hover:text-blue-600"/>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Helper component for metric cards
const MetricCard = ({ label, value }) => (
    <div className="bg-slate-50 p-3 rounded-lg">
        <div className="text-xs text-slate-500 font-medium">{label}</div>
        <div className="text-lg font-bold text-slate-800 mt-1">{value}</div>
    </div>
);

const PositionDetailsModal = ({ position, market, onClose }) => {
    const backdropProps = useModalClose(!!position, onClose);
    if (!position) return null;

    const formatDate = (ts) => ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' EST' : '-';

    const safeAvgPrice = typeof position.avgPrice === 'number' ? position.avgPrice : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" {...backdropProps}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center p-4 border-b border-slate-100">
                    <h3 className="font-bold text-lg text-slate-800">Position Details</h3>
                    <button aria-label="Close" onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
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
    const ariaSort = isActive ? (currentSort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
    const justifyClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';

    return (
        <th className="p-0 bg-slate-50 border-b border-slate-200 select-none font-medium text-slate-500" aria-sort={ariaSort}>
            <button
                onClick={() => onSort(sortKey)}
                className={`w-full h-full px-4 py-3 flex items-center gap-1 hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 outline-none transition-colors group ${justifyClass}`}
            >
                <span className={align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}>
                    {label}
                </span>
                <span className={`text-slate-400 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                    {isActive && currentSort.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                </span>
            </button>
        </th>
    );
};

const LatencyDisplay = ({ timestamp }) => {
    const now = React.useContext(TimeContext);
    const ago = timestamp ? now - timestamp : 0;

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

const MarketExpandedDetails = ({ market }) => {
    const targetFairOdds = probabilityToAmericanOdds(market.vigFreeProb / 100);
    const opposingVigFreeProb = 1 - (market.vigFreeProb / 100);
    const opposingFairOdds = probabilityToAmericanOdds(opposingVigFreeProb);

    return (
        <div className="p-4 border-b border-slate-200 bg-slate-50 animate-in slide-in-from-top-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* 1. Odds Sources */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Briefcase size={12}/> Odds Sources ({market.bookmakerCount})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {market.oddsSources && market.oddsSources.map((source, i) => (
                            <span key={i} className="px-2 py-1 bg-white border border-slate-200 rounded text-xs font-medium text-slate-600 shadow-sm">
                                {source}
                            </span>
                        ))}
                    </div>
                     <div className="text-[10px] text-slate-400 mt-1">
                        Spread: <span className="font-mono text-slate-600">{(market.oddsSpread * 100).toFixed(2)}%</span> (Max variance)
                    </div>
                </div>

                {/* 2. Calculator */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Calculator size={12}/> Vig-Free Valuation
                    </div>
                     <div className="bg-white border border-slate-200 rounded p-2 text-xs">
                        <div className="flex justify-between mb-1">
                            <span className="text-slate-500">Target No-Vig Prob:</span>
                            <span className="font-mono font-bold text-emerald-600">{(market.vigFreeProb).toFixed(2)}%</span>
                        </div>
                         <div className="flex justify-between mb-1">
                            <span className="text-slate-500">Fair Odds:</span>
                            <span className="font-mono font-bold text-slate-700">{targetFairOdds > 0 ? '+' : ''}{targetFairOdds}</span>
                        </div>
                        <div className="border-t border-slate-100 my-1 pt-1 flex justify-between">
                             <span className="text-slate-500">Opponent Fair Odds:</span>
                             <span className="font-mono text-slate-600">{opposingFairOdds > 0 ? '+' : ''}{opposingFairOdds}</span>
                        </div>
                    </div>
                </div>

                {/* 3. Latency & Timings */}
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Clock size={12}/> Data Freshness
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-white p-2 border border-slate-200 rounded">
                            <div className="text-slate-400 text-[10px] mb-0.5">Odds Update</div>
                            <div className="font-mono text-slate-700">{formatDuration(Date.now() - market.oddsLastUpdate)} ago</div>
                        </div>
                        <div className="bg-white p-2 border border-slate-200 rounded">
                             <div className="text-slate-400 text-[10px] mb-0.5">Kalshi Update</div>
                            <div className="font-mono text-slate-700">{formatDuration(Date.now() - market.kalshiLastUpdate)} ago</div>
                        </div>
                    </div>
                     <div className="text-[10px] text-slate-400 text-right">
                        Refreshed: {new Date(market.lastChange).toLocaleTimeString()}
                    </div>
                </div>
            </div>
        </div>
    );
};

const MarketRow = React.memo(({ market, onExecute, marginPercent, tradeSize, isSelected, onToggleSelect }) => {
    const [expanded, setExpanded] = useState(false);
    const [isBidding, setIsBidding] = useState(false);

    const handleBid = async (e) => {
        e.stopPropagation();
        setIsBidding(true);
        try {
            await onExecute(market, market.smartBid, false);
        } finally {
            setIsBidding(false);
        }
    };

    return (
        <>
            <tr key={market.id} onClick={() => setExpanded(!expanded)} className={`hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-100 ${!isSelected ? 'opacity-60 bg-slate-50' : ''}`}>
                <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                     <input
                        type="checkbox"
                        aria-label={`Select ${market.event}`}
                        checked={isSelected}
                        onChange={() => onToggleSelect(market.id)}
                        className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                </td>
                <td className="px-4 py-3">
                    <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        aria-expanded={expanded}
                        aria-controls={`details-${market.id}`}
                        className="w-full text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded p-1 -m-1"
                    >
                        <div className="font-medium text-slate-700 flex items-center gap-2">
                            {market.event}
                            <ChevronDown size={14} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Clock size={10} /> {formatGameTime(market.commenceTime)}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            {market.isMatchFound ? <LiquidityBadge volume={market.volume} openInterest={market.openInterest}/> : <span className="text-[10px] bg-slate-100 text-slate-400 px-1 rounded">No Match</span>}
                            <span className="text-[10px] text-slate-400 font-mono">Odds: {market.oddsDisplay}</span>
                        </div>
                    </button>
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
                    <div className="font-mono text-slate-500 flex items-center justify-center gap-1">
                        {/* WebSocket Status Indicators */}
                        {market.isWsSubscribed && market.priceSource === 'WS' && (
                            <Zap size={12} className="text-emerald-500" title="✓ Live WebSocket Data" />
                        )}
                        {market.isWsSubscribed && market.priceSource === 'HTTP' && (
                            <Zap size={12} className="text-amber-500" title="⏳ WebSocket Subscribed (using HTTP fallback)" />
                        )}
                        {!market.isWsSubscribed && market.isMatchFound && (
                            <Zap size={12} className="text-slate-500" title="HTTP Only" />
                        )}
                        {market.bestBid}¢ / {market.bestAsk}¢
                    </div>
                    <LatencyDisplay timestamp={market.kalshiLastUpdate} />
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{market.maxWillingToPay}¢</td>
                <td className="px-4 py-3 text-right">
                    {market.smartBid ? <div className="flex flex-col items-end"><span className="font-bold text-emerald-600">{market.smartBid}¢</span><span className="text-[9px] text-slate-400 uppercase">{market.reason}</span></div> : '-'}
                </td>
                <td className="px-4 py-3 text-center">
                    <button
                        onClick={handleBid}
                        disabled={!market.smartBid || isBidding}
                        className="px-3 py-1.5 bg-slate-900 text-white rounded text-xs font-bold hover:bg-blue-600 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center min-w-[60px]"
                    >
                        {isBidding ? (
                            <>
                                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                                <span className="sr-only">Placing Bid...</span>
                            </>
                        ) : `Bid ${market.smartBid}¢`}
                    </button>
                </td>
            </tr>
            {expanded && (
                <tr className="bg-slate-50/50">
                    <td colSpan={8} className="p-0">
                        <div id={`details-${market.id}`}>
                            <MarketExpandedDetails market={market} />
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
});

const arePortfolioPropsEqual = (prev, next) => {
    if (prev.activeTab !== next.activeTab) return false;
    if (prev.currentPrice !== next.currentPrice) return false;
    if (prev.currentFV !== next.currentFV) return false;

    const p = prev.item;
    const n = next.item;

    if (p.id !== n.id) return false;
    if (p.quantity !== n.quantity) return false;
    if (p.filled !== n.filled) return false;
    if (p.price !== n.price) return false;
    if (p.status !== n.status) return false;
    if (p.settlementStatus !== n.settlementStatus) return false;
    if (p.payout !== n.payout) return false;
    if (p.realizedPnl !== n.realizedPnl) return false;
    if (p.side !== n.side) return false;

    // Check historyEntry reference
    if (prev.historyEntry !== next.historyEntry) return false;

    return true;
};

const PortfolioRow = React.memo(({ item, activeTab, historyEntry, currentPrice, currentFV, onCancel, onAnalysis, exitOrder }) => {
    // Calculate metrics for positions
    const entryPrice = item.avgPrice || 0;
    const unrealizedPnL = activeTab === 'positions' ? calculateUnrealizedPnL(item.quantity, entryPrice, currentPrice) : 0;
    const unrealizedPnLPercent = item.cost > 0 ? (unrealizedPnL / item.cost) * 100 : 0;
    const entryEdge = historyEntry ? calculateEdge(historyEntry.fairValue, entryPrice) : null;
    const currentEdge = activeTab === 'positions' && currentFV ? calculateEdge(currentFV, currentPrice) : null;
    const holdDuration = historyEntry?.orderPlacedAt ? calculateHoldDuration(historyEntry.orderPlacedAt) : null;
    const source = historyEntry?.source;

    return (
        <tr className="hover:bg-slate-50 group">
            <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className={`font-bold ${item.side === 'Yes' ? 'text-blue-600' : 'text-rose-600'}`}>{item.side}</span>
                    <span className="text-slate-400">for</span>
                    <span className="font-medium text-slate-700">{item.marketId.split('-').pop()}</span>
                    {source === 'auto' && <span className="px-1.5 py-0.5 text-[9px] font-bold bg-indigo-100 text-indigo-700 rounded uppercase">AUTO</span>}
                </div>
            </td>

            {activeTab === 'positions' && (
                <>
                    <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                        {item.quantity}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-slate-600">
                        {entryPrice}¢
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-slate-600">
                        {currentPrice}¢
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                        <div className={`font-bold ${unrealizedPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {unrealizedPnL >= 0 ? '+' : ''}{formatMoney(unrealizedPnL)}
                        </div>
                        <div className={`text-[10px] ${unrealizedPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {unrealizedPnLPercent >= 0 ? '+' : ''}{unrealizedPnLPercent.toFixed(1)}%
                        </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                        <div className={`font-mono text-sm ${entryEdge !== null && entryEdge >= 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {entryEdge !== null ? `${entryEdge >= 0 ? '+' : ''}${entryEdge}¢` : '-'}
                        </div>
                        <div className={`font-mono text-sm ${currentEdge !== null && currentEdge >= 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                            {currentEdge !== null ? `${currentEdge >= 0 ? '+' : ''}${currentEdge}¢` : '-'}
                        </div>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-500">
                        {holdDuration ? formatHoldDuration(holdDuration) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                        {exitOrder ? (
                            <div className="text-xs">
                                <div className="font-mono text-emerald-600 font-bold">{exitOrder.price}¢</div>
                                <div className="text-[10px] text-slate-400">
                                    {exitOrder.filled > 0 ? `${exitOrder.filled}/${item.quantity}` : 'Resting'}
                                </div>
                            </div>
                        ) : (
                            <span className="text-slate-300">-</span>
                        )}
                    </td>
                </>
            )}

            {activeTab === 'resting' && (
                <>
                    <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded ${item.action === 'buy' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {item.action?.toUpperCase() || 'BUY'}
                        </span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono">
                        <span className="font-bold">{item.filled}</span> <span className="text-slate-400">/ {item.quantity}</span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono">{item.price}¢</td>
                    <td className="px-4 py-3 text-center font-mono text-slate-600">
                        {currentFV ? `${currentFV}¢` : '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-mono">
                        {(() => {
                            const isBuy = item.action === 'buy';
                            const market = currentPrice ? { bestBid: currentPrice, bestAsk: currentPrice } : null;
                            if (!market) return <span className="text-slate-400">-</span>;
                            const distance = calculateDistanceFromMarket(item.price, market.bestBid, market.bestAsk, isBuy);
                            return (
                                <span className={distance < 0 ? 'text-rose-500' : distance > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                                    {distance > 0 ? '+' : ''}{distance}¢
                                </span>
                            );
                        })()}
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-mono text-slate-500">
                        {item.created ? formatHoldDuration(Date.now() - item.created) : '-'}
                    </td>
                </>
            )}

            {activeTab === 'history' && (
                <>
                    <td className="px-4 py-3 text-center">
                        <div className="font-mono text-sm text-slate-600">{entryPrice}¢</div>
                        <div className="font-mono text-[10px] text-slate-400">
                            {historyEntry ? `(${historyEntry.fairValue}¢ FV)` : ''}
                        </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                        {(() => {
                            const exitPrice = item.payout ? Math.floor(item.payout / item.quantity) : null;
                            return exitPrice !== null ? (
                                <>
                                    <div className="font-mono text-sm text-slate-600">{exitPrice}¢</div>
                                    <div className="font-mono text-[10px] text-slate-400">
                                        {item.payout ? formatMoney(item.payout) : ''}
                                    </div>
                                </>
                            ) : '-';
                        })()}
                    </td>
                    <td className="px-4 py-3 text-right">
                        {item.realizedPnl !== undefined ? (
                            <>
                                <div className={`font-mono font-bold ${item.realizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    {item.realizedPnl >= 0 ? '+' : ''}{formatMoney(item.realizedPnl)}
                                </div>
                                <div className={`text-[10px] font-mono ${item.realizedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                    {formatPercentReturn(item.realizedPnl, item.cost)}
                                </div>
                            </>
                        ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                        {(() => {
                            const exitPrice = item.payout ? Math.floor(item.payout / item.quantity) : null;
                            const edgeCaptured = exitPrice && entryPrice ? exitPrice - entryPrice : null;
                            const fvEdge = historyEntry ? historyEntry.fairValue - entryPrice : null;
                            return (
                                <>
                                    <div className={`font-mono text-sm ${edgeCaptured && edgeCaptured > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        {edgeCaptured !== null ? `${edgeCaptured >= 0 ? '+' : ''}${edgeCaptured}¢` : '-'}
                                    </div>
                                    {fvEdge !== null && (
                                        <div className="text-[10px] text-slate-400">
                                            / {fvEdge >= 0 ? '+' : ''}{fvEdge}¢ FV
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-500">
                        {historyEntry?.orderPlacedAt && item.settled ?
                            formatHoldDuration(item.settled - historyEntry.orderPlacedAt) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-xs text-slate-500">
                        {item.fees ? formatMoney(item.fees) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-slate-500">
                        {item.settled ? formatOrderDate(item.settled) : formatOrderDate(item.created)}
                    </td>
                </>
            )}

            <td className="px-4 py-3 text-center flex justify-center gap-2">
                {item.isOrder && (
                    <button aria-label={`Cancel Order for ${item.marketId}`} onClick={() => onCancel(item.id)} className="text-slate-400 hover:text-rose-600 transition-colors" title="Cancel Order">
                        <XCircle size={16}/>
                    </button>
                )}
                <button
                    aria-label="Trade Analysis"
                    onClick={() => onAnalysis(item, historyEntry)}
                    disabled={!historyEntry}
                    className="text-slate-300 hover:text-blue-600 disabled:opacity-20"
                >
                    <Info size={16}/>
                </button>
            </td>
        </tr>
    );
}, arePortfolioPropsEqual);

const PortfolioSection = ({ activeTab, positions, markets, tradeHistory, onAnalysis, onCancel, onExecute, sortConfig, onSort }) => {
    
    // Optimization: Create a map for O(1) market lookups
    const marketMap = useMemo(() => {
        const map = new Map();
        markets.forEach(m => {
            if (m.realMarketId && !map.has(m.realMarketId)) {
                map.set(m.realMarketId, m);
            }
        });
        return map;
    }, [markets]);

    // Create a map of exit orders by marketId for positions tab
    const exitOrderMap = useMemo(() => {
        const map = new Map();
        const sellOrders = positions.filter(p => p.isOrder && p.action === 'sell');
        for (const order of sellOrders) {
            map.set(order.marketId, order);
        }
        return map;
    }, [positions]);

    const getGameName = (ticker) => {
        const liveMarket = marketMap.get(ticker);
        if (liveMarket) return liveMarket.event;
        if (tradeHistory[ticker]) return tradeHistory[ticker].event;
        return ticker; 
    };

    const getCurrentFV = (ticker) => {
        const liveMarket = marketMap.get(ticker);
        return liveMarket ? liveMarket.fairValue : 0;
    };

    const getCurrentPrice = (ticker) => {
        const liveMarket = marketMap.get(ticker);
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

    return (
        <div role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="overflow-auto flex-1">
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                    <tr>
                        <SortableHeader label="Details" sortKey="details" currentSort={sortConfig} onSort={onSort} />
                        
                        {activeTab === 'positions' && (
                            <>
                                <SortableHeader label="Qty" sortKey="quantity" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Entry" sortKey="avgPrice" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Current" sortKey="price" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="P&L" sortKey="pnl" currentSort={sortConfig} onSort={onSort} align="right" />
                                <SortableHeader label="Edge (Entry/Now)" sortKey="edge" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Hold" sortKey="hold" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Exit Order" sortKey="exitOrder" currentSort={sortConfig} onSort={onSort} align="center" />
                            </>
                        )}

                        {activeTab === 'resting' && (
                            <>
                                <SortableHeader label="Type" sortKey="action" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Filled / Qty" sortKey="filled" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Limit" sortKey="price" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="FV Now" sortKey="fv" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Dist" sortKey="distance" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="In Queue" sortKey="created" currentSort={sortConfig} onSort={onSort} align="center" />
                            </>
                        )}

                        {activeTab === 'history' && (
                            <>
                                <SortableHeader label="Entry" sortKey="avgPrice" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Exit" sortKey="exitPrice" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="P&L" sortKey="pnl" currentSort={sortConfig} onSort={onSort} align="right" />
                                <SortableHeader label="Edge" sortKey="edge" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Duration" sortKey="duration" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Fees" sortKey="fees" currentSort={sortConfig} onSort={onSort} align="center" />
                                <SortableHeader label="Settled" sortKey="created" currentSort={sortConfig} onSort={onSort} align="center" />
                            </>
                        )}
                        <th className="px-4 py-3 text-center">Action</th>
                    </tr>
                </thead>
                
                {groupedItems.map(([gameName, items]) => (
                    <React.Fragment key={gameName}>
                        <tbody className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <td colSpan={activeTab === 'positions' ? 9 : activeTab === 'resting' ? 8 : 9} className="px-4 py-2 font-bold text-xs text-slate-700 uppercase tracking-wider bg-slate-100/50">
                                    {gameName}
                                </td>
                            </tr>
                        </tbody>
                        <tbody className="divide-y divide-slate-50">
                            {items.map(item => (
                                <PortfolioRow
                                    key={item.id}
                                    item={item}
                                    activeTab={activeTab}
                                    historyEntry={tradeHistory[item.marketId]}
                                    currentPrice={getCurrentPrice(item.marketId)}
                                    currentFV={getCurrentFV(item.marketId)}
                                    exitOrder={exitOrderMap.get(item.marketId)}
                                    onCancel={onCancel}
                                    onAnalysis={onAnalysis}
                                />
                            ))}
                        </tbody>
                    </React.Fragment>
                ))}
                {positions.length === 0 && (
                    <tbody>
                        <tr>
                            <td colSpan={activeTab === 'positions' ? 7 : (activeTab === 'resting' ? 6 : 5)} className="py-12 text-center text-slate-400">
                                <div className="flex flex-col items-center gap-3">
                                    {activeTab === 'positions' && (
                                        <>
                                            <div className="p-4 bg-slate-100 rounded-full"><Briefcase size={24} className="text-slate-400"/></div>
                                            <div>
                                                <p className="font-medium text-slate-600">No active positions</p>
                                                <p className="text-xs text-slate-400 mt-1">Use the Market Scanner to find trades</p>
                                            </div>
                                        </>
                                    )}
                                    {activeTab === 'resting' && (
                                        <>
                                            <div className="p-4 bg-slate-100 rounded-full"><Clock size={24} className="text-slate-400"/></div>
                                            <div>
                                                <p className="font-medium text-slate-600">No open orders</p>
                                                <p className="text-xs text-slate-400 mt-1">Active bids and offers will appear here</p>
                                            </div>
                                        </>
                                    )}
                                    {activeTab === 'history' && (
                                        <>
                                            <div className="p-4 bg-slate-100 rounded-full"><FileText size={24} className="text-slate-400"/></div>
                                            <div>
                                                <p className="font-medium text-slate-600">No trade history</p>
                                                <p className="text-xs text-slate-400 mt-1">Settled auto-trades will appear here</p>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </td>
                        </tr>
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
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [sessionStart, setSessionStart] = useState(null);
  const [eventLogs, setEventLogs] = useState([]);
  const [hasScanned, setHasScanned] = useState(false);

  const [deselectedMarketIds, setDeselectedMarketIds] = useState(new Set());

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationProgress, setCancellationProgress] = useState({ current: 0, total: 0 });

  const [sortConfig, setSortConfig] = useState({ key: 'edge', direction: 'desc' });
  const [portfolioSortConfig, setPortfolioSortConfig] = useState({ key: 'created', direction: 'desc' });

  const toggleMarketSelection = useCallback((id) => {
      setDeselectedMarketIds(prev => {
          const next = new Set(prev);
          if (next.has(id)) {
              next.delete(id);
          } else {
              next.add(id);
          }
          return next;
      });
  }, []);

  const toggleAllSelection = (visibleIds) => {
      const anyDeselected = visibleIds.some(id => deselectedMarketIds.has(id));
      setDeselectedMarketIds(prev => {
          const next = new Set(prev);
          if (anyDeselected) {
              // Select all visible
              visibleIds.forEach(id => next.delete(id));
          } else {
              // Deselect all visible
              visibleIds.forEach(id => next.add(id));
          }
          return next;
      });
  };

  const [config, setConfig] = useState(() => {
      const saved = localStorage.getItem('kalshi_config');
      const initial = {
          marginPercent: 15,
          autoCloseMarginPercent: 15,
          minFairValue: 20,
          tradeSize: 10,
          maxPositions: 15, // AGGRESSIVE: Increased from 5 to capture more opportunities
          maxPositionsPerSport: 5, // AGGRESSIVE: Increased from 3 for better opportunity capture
          enableSportDiversification: true, // Risk Management: Enable sport-level position limits
          minLiquidity: 25, // AGGRESSIVE: Reduced from 50 to access smaller markets with good edges
          maxBidAskSpread: 5, // Risk Management: Maximum spread in cents (5¢ = 5%)
          enableLiquidityChecks: true, // Risk Management: Enable liquidity filtering
          isAutoBid: false,
          isAutoClose: true,
          holdStrategy: 'sell_limit',
          selectedSports: ['americanfootball_nfl'],
          isTurboMode: false
      };
      if (saved) {
          try {
              return { ...initial, ...JSON.parse(saved) };
          } catch (e) {
              console.error("Failed to load config", e);
          }
      }
      return initial;
  });

  const [schedule, setSchedule] = useState(() => {
      const saved = localStorage.getItem('kalshi_schedule');
      return saved ? JSON.parse(saved) : { enabled: false, start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] };
  });

  useEffect(() => {
      localStorage.setItem('kalshi_config', JSON.stringify(config));
  }, [config]);

  useEffect(() => {
      localStorage.setItem('kalshi_schedule', JSON.stringify(schedule));
  }, [schedule]);

  // Schedule Logic
  useEffect(() => {
      if (!schedule.enabled) return;

      const checkSchedule = () => {
          const now = new Date();
          const day = now.getDay();

          if (!schedule.days.includes(day)) {
               if (isRunning) {
                   console.log("Schedule: Stopping bot (Day mismatch)");
                   addLog("Schedule: Stopping (Day mismatch)", "UPDATE");
                   setIsRunning(false);
               }
               return;
          }

          const [startH, startM] = schedule.start.split(':').map(Number);
          const [endH, endM] = schedule.end.split(':').map(Number);

          const currentMins = now.getHours() * 60 + now.getMinutes();
          const startMins = startH * 60 + startM;
          const endMins = endH * 60 + endM;

          // Handle overnight (e.g. 22:00 to 06:00)
          const inWindow = endMins < startMins
                ? (currentMins >= startMins || currentMins < endMins)
                : (currentMins >= startMins && currentMins < endMins);

          if (inWindow && !isRunning) {
              console.log("Schedule: Starting bot");
              addLog("Schedule: Starting session", "UPDATE");
              setIsRunning(true);
          } else if (!inWindow && isRunning) {
              console.log("Schedule: Stopping bot");
              addLog("Schedule: Stopping session", "UPDATE");
              setIsRunning(false);
          }
      };

      checkSchedule();
      const interval = setInterval(checkSchedule, 10000);
      return () => clearInterval(interval);
  }, [schedule, isRunning]); // Depend on isRunning to allow toggling

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

  // Refs to track latest state for async safeguards
  const latestMarketsRef = useRef(markets);
  const latestDeselectedRef = useRef(deselectedMarketIds);

  const addLog = useCallback((message, type) => {
      const log = { id: Date.now() + Math.random(), timestamp: Date.now(), message, type };
      setEventLogs(prev => [...prev.slice(-99), log]);
  }, []);

  // Keep refs synced with state
  useEffect(() => { latestMarketsRef.current = markets; }, [markets]);
  useEffect(() => { latestDeselectedRef.current = deselectedMarketIds; }, [deselectedMarketIds]);
  
  const [tradeHistory, setTradeHistory] = useState(() => JSON.parse(localStorage.getItem('kalshi_trade_history') || '{}'));
  useEffect(() => localStorage.setItem('kalshi_trade_history', JSON.stringify(tradeHistory)), [tradeHistory]);

  // Session History: Track multiple trading sessions over time
  const [sessionHistory, setSessionHistory] = useState(() => JSON.parse(localStorage.getItem('kalshi_session_history') || '[]'));
  useEffect(() => localStorage.setItem('kalshi_session_history', JSON.stringify(sessionHistory)), [sessionHistory]);

  // Function to save current session to history
  const saveCurrentSession = useCallback(() => {
      const sessionData = generateSessionData();
      const sessionMetrics = calculateSessionMetrics(positions, tradeHistory);

      const sessionRecord = {
          sessionId: Date.now(),
          startTime: sessionStart,
          endTime: Date.now(),
          duration: Date.now() - sessionStart,
          metrics: sessionMetrics,
          trades: sessionData,
          config: {
              marginPercent: config.marginPercent,
              autoCloseMarginPercent: config.autoCloseMarginPercent,
              maxPositions: config.maxPositions,
              tradeSize: config.tradeSize,
              isAutoBid: config.isAutoBid,
              isAutoClose: config.isAutoClose
          }
      };

      setSessionHistory(prev => [sessionRecord, ...prev].slice(0, 50)); // Keep last 50 sessions
      console.log(`[SESSION] Saved session ${sessionRecord.sessionId} with ${sessionData.length} trades`);

      return sessionRecord;
  }, [sessionStart, positions, tradeHistory, config]);

  useEffect(() => {
      // Security: Migrate sensitive keys to sessionStorage to prevent persistence
      let k = sessionStorage.getItem('kalshi_keys');
      if (!k) {
          k = localStorage.getItem('kalshi_keys');
          if (k) {
              sessionStorage.setItem('kalshi_keys', k);
              localStorage.removeItem('kalshi_keys');
          }
      }
      if (k) setWalletKeys(JSON.parse(k));

      let o = sessionStorage.getItem('odds_api_key');
      if (!o) {
          o = localStorage.getItem('odds_api_key');
          if (o) {
              sessionStorage.setItem('odds_api_key', o);
              localStorage.removeItem('odds_api_key');
          }
      }
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
      const cooldown = config.isTurboMode ? 2000 : REFRESH_COOLDOWN;
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
               const [oddsRes, rawKalshiMarkets] = await Promise.all([
                  fetch(`https://api.the-odds-api.com/v4/sports/${sportConfig.key}/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${oddsApiKey}`, { signal: abortControllerRef.current.signal }),
                  fetch(`/api/kalshi/markets?limit=300&status=open${seriesTicker ? `&series_ticker=${seriesTicker}` : ''}`, { signal: abortControllerRef.current.signal }).then(r => r.json()).then(d => d.markets || []).catch(() => [])
               ]);

               // NEW: Build index for O(1) lookup instead of O(N*M) matching
               const kalshiIndex = buildKalshiIndex(rawKalshiMarkets, sportConfig.key);
               logIndexStats(kalshiIndex);

               const used = oddsRes.headers.get('x-requests-used');
               const remaining = oddsRes.headers.get('x-requests-remaining');

               const oddsData = await oddsRes.json();
               if (!Array.isArray(oddsData)) throw new Error(oddsData.message || `API Error for ${sportConfig.key}`);

               return { oddsData, kalshiIndex, sportConfig, apiUsage: (used && remaining) ? { used: parseInt(used), remaining: parseInt(remaining) } : null };
          });

          const results = await Promise.all(requests);
          
          // Update API usage from the last successful request
          const lastUsage = results.find(r => r.apiUsage)?.apiUsage;
          if (lastUsage) setApiUsage(lastUsage);

          lastFetchTimeRef.current = Date.now();
          setLastUpdated(new Date());

          // Flatten results with new index
          const allOddsData = results.flatMap(r => r.oddsData.map(o => ({ ...o, _kalshiIndex: r.kalshiIndex, _sportConfig: r.sportConfig })));

          setMarkets(prev => {
              const processingTime = Date.now();
              let hasChanged = false;
              const processed = allOddsData.slice(0, 50).map(game => {
                  const kalshiIndex = game._kalshiIndex;
                  const sportConfig = game._sportConfig;

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
                          vigFreeProbs.push({ prob: tProb.p / totalImplied, source: bm.title });
                      }
                  }

                  if (vigFreeProbs.length === 0) return null;

                  const minProb = Math.min(...vigFreeProbs.map(v => v.prob));
                  const maxProb = Math.max(...vigFreeProbs.map(v => v.prob));
                  const spread = maxProb - minProb;

                  if (spread > 0.15) {
                      console.warn(`${targetName} rejected due to high variance: ${spread.toFixed(2)}`);
                      return null;
                  }

                  const vigFreeProb = vigFreeProbs.reduce((a, b) => a + b.prob, 0) / vigFreeProbs.length;

                  // NEW: Use index-based O(1) lookup instead of O(N*M) search
                  let realMatch = findMatchInIndex(kalshiIndex, sportConfig.key, targetOutcome.name, game.home_team, game.away_team, game.commence_time);
                  const prevMarket = prev.find(m => m.id === game.id);

                  // --- WEBSOCKET AS SOURCE OF TRUTH ---
                  // Check if we have fresh WebSocket prices for this market
                  let bestBid = realMatch?.yes_bid || 0;
                  let bestAsk = realMatch?.yes_ask || 0;
                  let kalshiLastUpdate = processingTime;
                  let priceSource = 'HTTP';
                  const isSubscribed = wsSubscriptionsRef.current.has(realMatch?.ticker);

                  if (realMatch?.ticker && wsPricesRef.current.has(realMatch.ticker)) {
                      const wsPrice = wsPricesRef.current.get(realMatch.ticker);
                      const age = Date.now() - wsPrice.timestamp;
                      const isFresh = age < 30000; // 30s freshness threshold

                      if (isFresh && wsStatus === 'OPEN') {
                          // WebSocket is source of truth
                          bestBid = wsPrice.bid;
                          bestAsk = wsPrice.ask;
                          kalshiLastUpdate = wsPrice.timestamp;
                          priceSource = 'WS';
                      }
                  }

                  // --- MATCH PERSISTENCE (Fix for "No Match" with Active WS) ---
                  if (!realMatch && priceSource === 'WS' && prevMarket && prevMarket.isMatchFound) {
                       // If we have fresh WS data but REST failed, trust the previous match
                       const wsPrice = wsPricesRef.current.get(prevMarket.realMarketId);
                       realMatch = {
                           ticker: prevMarket.realMarketId,
                           isInverse: prevMarket.isInverse,
                           yes_bid: wsPrice.bid,
                           yes_ask: wsPrice.ask,
                           volume: prevMarket.volume,
                           open_interest: prevMarket.openInterest
                       };
                  }

                  // --- VOLATILITY TRACKING ---
                  const currentVal = vigFreeProb * 100;

                  // OPTIMIZATION: Use slice instead of filter+spread to reduce array allocations
                  const oldHistory = prevMarket?.history || [];
                  const cutoff = processingTime - 60 * 60 * 1000;

                  let startIndex = 0;
                  // History is sorted by time, so we can stop at first valid entry
                  while (startIndex < oldHistory.length && oldHistory[startIndex].t <= cutoff) {
                      startIndex++;
                  }

                  const history = oldHistory.slice(startIndex);
                  history.push({ t: processingTime, v: currentVal });

                  const volatility = calculateVolatility(history);
                  // ---------------------------

                  // Get volume and open interest from realMatch (only available via HTTP)
                  const volume = realMatch?.volume || 0;
                  const openInterest = realMatch?.open_interest || 0;

                  const newMarket = {
                      id: game.id,
                      event: `${targetOutcome.name} vs ${targetOutcome.name === game.home_team ? game.away_team : game.home_team}`,
                      sport: sportConfig?.title || 'Unknown', // NEW: Add sport name for display
                      commenceTime: game.commence_time,
                      americanOdds: targetOutcome.price,
                      sportsbookOdds: targetOutcome.price,
                      opposingOdds: opposingOutcome ? opposingOutcome.price : null,
                      oddsDisplay: oddsDisplay,
                      vigFreeProb: vigFreeProb * 100,
                      bestBid: bestBid || 0,
                      bestAsk: bestAsk || 0,
                      isMatchFound: !!realMatch,
                      realMarketId: realMatch?.ticker,
                      volume: volume,
                      openInterest: openInterest,
                      lastChange: processingTime,
                      kalshiLastUpdate: kalshiLastUpdate,
                      oddsLastUpdate: maxLastUpdate,
                      fairValue: Math.floor(vigFreeProb * 100),
                      history: history,
                      volatility: volatility,
                      bookmakerCount: vigFreeProbs.length,
                      oddsSpread: spread,
                      oddsSources: vigFreeProbs.map(v => v.source),
                      isInverse: realMatch?.isInverse || false,
                      priceSource: priceSource, // 'WS' or 'HTTP'
                      isWsSubscribed: isSubscribed // For UI Zap icon
                  };

                  if (prevMarket) {
                      const isSame =
                        prevMarket.bestBid === newMarket.bestBid &&
                        prevMarket.bestAsk === newMarket.bestAsk &&
                        prevMarket.fairValue === newMarket.fairValue &&
                        prevMarket.volatility.toFixed(2) === newMarket.volatility.toFixed(2) &&
                        prevMarket.oddsLastUpdate === newMarket.oddsLastUpdate &&
                        prevMarket.kalshiLastUpdate === newMarket.kalshiLastUpdate &&
                        prevMarket.volume === newMarket.volume &&
                        prevMarket.openInterest === newMarket.openInterest &&
                        prevMarket.isMatchFound === newMarket.isMatchFound &&
                        prevMarket.priceSource === newMarket.priceSource &&
                        prevMarket.isWsSubscribed === newMarket.isWsSubscribed &&
                        prevMarket.oddsDisplay === newMarket.oddsDisplay &&
                        prevMarket.commenceTime === newMarket.commenceTime &&
                        prevMarket.event === newMarket.event;

                      if (isSame) return prevMarket;
                  }

                  hasChanged = true;
                  return newMarket;
              }).filter(Boolean);
              
              if (!hasChanged && processed.length === prev.length) return prev;
              return processed;
          });
      } catch (e) { if (e.name !== 'AbortError') setErrorMsg(e.message); } finally { setHasScanned(true); }
  }, [oddsApiKey, config.selectedSports, config.isTurboMode, sportsList]);

  useEffect(() => { setMarkets([]); setHasScanned(false); fetchLiveOdds(true); }, [fetchLiveOdds]);

  useEffect(() => {
      if (!isRunning) return;
      fetchLiveOdds(true);
      const interval = setInterval(() => fetchLiveOdds(false), config.isTurboMode ? 3000 : 15000);
      return () => clearInterval(interval);
  }, [isRunning, fetchLiveOdds, config.isTurboMode]);

  useEffect(() => {
      if (!isRunning || !walletKeys) return;

      let ws;
      let isMounted = true;
      let reconnectAttempts = 0;
      let reconnectTimeout;

      const connect = async () => {
          try {
              const ts = Date.now();
              const sig = await signRequest(walletKeys.privateKey, "GET", "/trade-api/ws/v2", ts);
              if (!isMounted) return;

              const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + `/kalshi-ws?key=${walletKeys.keyId}&sig=${encodeURIComponent(sig)}&ts=${ts}`;

              ws = new WebSocket(wsUrl);

              ws.onopen = async () => {
                  if (!isMounted) return;
                  setWsStatus('OPEN');
                  reconnectAttempts = 0; // Reset on successful connection
                  console.log('[WS] Connected successfully');

                  // Clear subscription state on reconnect
                  wsSubscriptionsRef.current.clear();
                  wsPricesRef.current.clear();

                  // BATCH SUBSCRIBE: Get all relevant markets and subscribe in one request
                  try {
                      const marketsToSubscribe = new Set();

                      // 1. Subscribe to markets from selected sports
                      for (const sportKey of config.selectedSports) {
                          const sport = sportsList.find(s => s.key === sportKey);
                          if (!sport || !sport.kalshiSeries) continue;

                          const ts = Date.now();
                          const headers = {
                              'KALSHI-ACCESS-KEY': walletKeys.keyId,
                              'KALSHI-ACCESS-SIGNATURE': await signRequest(walletKeys.privateKey, "GET", "/trade-api/v2/markets", ts),
                              'KALSHI-ACCESS-TIMESTAMP': ts.toString()
                          };

                          const response = await fetch(
                              `/api/kalshi/markets?limit=100&status=open&series_ticker=${sport.kalshiSeries}`,
                              { headers }
                          );

                          if (response.ok) {
                              const data = await response.json();
                              (data.markets || []).forEach(m => {
                                  if (m.ticker) marketsToSubscribe.add(m.ticker);
                              });
                          }
                      }

                      // 2. Add currently visible markets from scanner
                      markets.forEach(m => {
                          if (m.realMarketId) marketsToSubscribe.add(m.realMarketId);
                      });

                      // Send batch subscription
                      const tickersArray = Array.from(marketsToSubscribe);
                      if (tickersArray.length > 0) {
                          ws.send(JSON.stringify({
                              id: subscriptionIdCounter.current++,
                              cmd: "subscribe",
                              params: { channels: ["ticker"], market_tickers: tickersArray }
                          }));
                          console.log(`[WS] 📡 Batch subscribed to ${tickersArray.length} markets`);
                      } else {
                          console.log('[WS] No markets to subscribe to');
                      }
                  } catch (error) {
                      console.error('[WS] Failed to fetch markets for batch subscribe:', error);
                  }
              };

              ws.onmessage = (e) => {
                  if (!isMounted) return;
                  const d = JSON.parse(e.data);

                  // Debug: Log all non-ticker messages to understand format
                  if (d.type !== 'ticker') {
                      console.log('[WS] Message received:', d);
                  }

                  // Handle ticker updates - store in dedicated price map
                  if (d.type === 'ticker' && d.msg) {
                      const ticker = d.msg.market_ticker;
                      const now = Date.now();

                      // Store prices in dedicated map (source of truth)
                      wsPricesRef.current.set(ticker, {
                          bid: d.msg.yes_bid,
                          ask: d.msg.yes_ask,
                          timestamp: now
                      });

                      // Mark subscription as confirmed if not already
                      if (!wsSubscriptionsRef.current.has(ticker)) {
                          wsSubscriptionsRef.current.set(ticker, {
                              sid: d.sid,
                              confirmedAt: now,
                              lastUpdate: now
                          });
                      } else {
                          const sub = wsSubscriptionsRef.current.get(ticker);
                          sub.lastUpdate = now;
                      }

                      console.log(`[WS] ✓ Updated prices for ${ticker}: ${d.msg.yes_bid}/${d.msg.yes_ask}`);
                  }

                  // Handle subscription confirmations
                  if (d.type === 'ok' || d.type === 'subscribed') {
                      const tickers = d.msg?.market_tickers || [];
                      const sid = d.msg?.sid;
                      const now = Date.now();

                      tickers.forEach(ticker => {
                          if (!wsSubscriptionsRef.current.has(ticker)) {
                              wsSubscriptionsRef.current.set(ticker, {
                                  sid: sid,
                                  confirmedAt: now,
                                  lastUpdate: now
                              });
                          }
                      });

                      console.log(`[WS] ✓ Subscription confirmed: ${tickers.length} markets (sid: ${sid})`);
                  }

                  // Handle subscription errors
                  if (d.type === 'error') {
                      console.error(`[WS] ✗ Error:`, d);
                  }
              };

              ws.onerror = (err) => {
                  console.error('[WS] Error:', err);
                  if (isMounted) setWsStatus('ERROR');
              };

              ws.onclose = () => {
                  if (!isMounted) return;

                  setWsStatus('CLOSED');
                  console.log('[WS] Connection closed');

                  // Automatic reconnection with exponential backoff
                  if (isMounted && isRunning) {
                      reconnectAttempts++;
                      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Max 30s
                      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);

                      reconnectTimeout = setTimeout(() => {
                          if (isMounted && isRunning) {
                              connect();
                          }
                      }, delay);
                  }
              };

              wsRef.current = ws;
          } catch (e) {
              console.error('[WS] Connection failed:', e);
              if (isMounted) setWsStatus('ERROR');

              // Retry connection
              if (isMounted && isRunning) {
                  reconnectAttempts++;
                  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                  reconnectTimeout = setTimeout(() => {
                      if (isMounted && isRunning) connect();
                  }, delay);
              }
          }
      };

      connect();

      return () => {
          isMounted = false;
          clearTimeout(reconnectTimeout);
          if (ws) ws.close();
      };
  }, [isRunning, walletKeys]);

  // ===== WEBSOCKET SUBSCRIPTION MANAGER =====
  // Separate subscription state from market objects for cleaner architecture
  const wsSubscriptionsRef = useRef(new Map()); // ticker -> { sid, confirmedAt, lastUpdate, prices: {bid, ask} }
  const wsPricesRef = useRef(new Map()); // ticker -> { bid, ask, timestamp }
  let subscriptionIdCounter = useRef(1000); // Incrementing ID for subscription requests

  // Incremental subscription: Add new markets that appear in scanner
  // (Most markets are already subscribed via batch on connect)
  useEffect(() => {
      if (wsRef.current?.readyState !== WebSocket.OPEN || !isRunning) return;

      // Find markets not yet subscribed
      const newTickers = markets
          .map(m => m.realMarketId)
          .filter(ticker => ticker && !wsSubscriptionsRef.current.has(ticker));

      if (newTickers.length === 0) return;

      // Subscribe to new markets
      wsRef.current.send(JSON.stringify({
          id: subscriptionIdCounter.current++,
          cmd: "subscribe",
          params: { channels: ["ticker"], market_tickers: newTickers }
      }));

      console.log(`[WS] ➕ Incremental subscribe to ${newTickers.length} new markets`);
  }, [markets, isRunning]);

  // Note: No need to monitor pending subscriptions - we mark markets confirmed when ticker data arrives

  const fetchPortfolio = useCallback(async () => {
      if (!walletKeys) return;
      try {
          // FIX: Each request needs its own fresh timestamp to avoid "header_timestamp_expired" errors
          // Previously, all 4 requests shared one timestamp, causing race conditions when
          // signature generation took too long or network delays occurred
          const getHeaders = async (path) => {
              const ts = Date.now(); // Fresh timestamp for each request
              return {
                  'KALSHI-ACCESS-KEY': walletKeys.keyId,
                  'KALSHI-ACCESS-SIGNATURE': await signRequest(walletKeys.privateKey, "GET", path, ts),
                  'KALSHI-ACCESS-TIMESTAMP': ts.toString()
              };
          };

          const [hBal, hOrders, hPos, hSettled] = await Promise.all([
              getHeaders('/trade-api/v2/portfolio/balance'),
              getHeaders('/trade-api/v2/portfolio/orders'),
              getHeaders('/trade-api/v2/portfolio/positions'),
              getHeaders('/trade-api/v2/portfolio/positions?settlement_status=settled')
          ]);

          const [balRes, ordersRes, posRes, settledPosRes] = await Promise.all([
              fetch('/api/kalshi/portfolio/balance', { headers: hBal }),
              fetch('/api/kalshi/portfolio/orders', { headers: hOrders }),
              fetch('/api/kalshi/portfolio/positions', { headers: hPos }),
              fetch('/api/kalshi/portfolio/positions?settlement_status=settled', { headers: hSettled })
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

                 // EXIT TRACKING: If this is a sell order that just filled, update trade history
                 if (o.action === 'sell' && o.status === 'executed') {
                     setTradeHistory(prev => {
                         const historyEntry = prev[o.ticker];

                         // Only update if we have a history entry and it doesn't have exit data yet
                         if (historyEntry && !historyEntry.exitTimestamp) {
                             // Try to get current fair value from markets
                             const currentMarket = markets.find(m => m.realMarketId === o.ticker);
                             const exitFairValue = currentMarket?.fairValue || null;

                             console.log(`[EXIT TRACKING] Sell order filled for ${o.ticker}: Exit @ ${price}¢`);

                             return {
                                 ...prev,
                                 [o.ticker]: {
                                     ...historyEntry,
                                     exitTimestamp: Date.now(),
                                     exitPrice: price,
                                     exitFairValue: exitFairValue,
                                     exitMethod: historyEntry.source === 'auto' ? 'auto-close' : 'manual',
                                     quantity: o.fill_count
                                 }
                             };
                         }

                         return prev;
                     });
                 }
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

          // Process Active Positions
          const activePositions = (pos.market_positions && pos.market_positions.length > 0 ? pos.market_positions : (pos.event_positions || pos.positions || [])).map(p => ({...p, _forcedStatus: 'unsettled'}));

          // Process Settled Positions
          const settledPositions = (settledPos.market_positions && settledPos.market_positions.length > 0 ? settledPos.market_positions : (settledPos.event_positions || settledPos.positions || [])).map(p => ({...p, _forcedStatus: 'settled'}));

          // FIX: Aggregate positions by ticker to show total quantity across multiple fills
          const positionsByTicker = new Map();
          [...activePositions, ...settledPositions].forEach(p => {
              const ticker = p.ticker || p.market_ticker || p.event_ticker;
              const qty = p.position || p.total_cost_shares || 0;
              let avg = 0;
              if (p.avg_price) avg = p.avg_price;
              else if (p.total_cost && qty) avg = p.total_cost / qty;
              else if (p.fees_paid && qty) avg = p.fees_paid / Math.abs(qty);

              const settlementStatus = p.settlement_status || p._forcedStatus;
              const key = `${ticker}-${settlementStatus}`;

              if (positionsByTicker.has(key)) {
                  // Aggregate with existing position
                  const existing = positionsByTicker.get(key);
                  const totalQty = existing.quantity + Math.abs(qty);
                  const totalCost = existing.cost + Math.abs(p.total_cost || 0);
                  const totalFees = existing.fees + Math.abs(p.fees_paid || 0);
                  // Weighted average price
                  const newAvg = totalCost > 0 ? totalCost / totalQty : existing.avgPrice;

                  positionsByTicker.set(key, {
                      ...existing,
                      quantity: totalQty,
                      avgPrice: newAvg,
                      cost: totalCost,
                      fees: totalFees,
                      realizedPnl: (existing.realizedPnl || 0) + (p.realized_pnl || 0),
                      _aggregatedCount: (existing._aggregatedCount || 1) + 1
                  });
              } else {
                  // First position for this ticker+status
                  const uniqueId = settlementStatus === 'settled' ? `${ticker}-settled` : ticker;
                  positionsByTicker.set(key, {
                      id: uniqueId,
                      marketId: ticker,
                      side: 'Yes',
                      quantity: Math.abs(qty),
                      avgPrice: avg,
                      cost: Math.abs(p.total_cost || 0),
                      fees: Math.abs(p.fees_paid || 0),
                      status: 'HELD',
                      isOrder: false,
                      settlementStatus: settlementStatus,
                      realizedPnl: p.realized_pnl,
                      payout: p.payout,
                      created: p.created_time || p.trade_time,
                      settled: p.settlement_time,
                      _aggregatedCount: 1
                  });
              }
          });

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
              // POSITIONS (aggregated by ticker)
              ...Array.from(positionsByTicker.values())
          ].filter((p, index, self) => {
             if (p.isOrder) return true;
             // Allow items with 0 quantity if they have PnL (history)
             if (p.quantity <= 0 && (!p.realizedPnl && !p.settlementStatus)) return false;

             // Log if we aggregated multiple positions (indicates the bug occurred)
             if (p._aggregatedCount > 1) {
                 console.warn(`[PORTFOLIO] Aggregated ${p._aggregatedCount} position entries for ${p.marketId} (Total qty: ${p.quantity})`);
             }

             return true;
          });

          // EXIT TRACKING: Detect newly settled positions and update trade history with exit data
          const settledTickers = new Set(
              mappedItems
                  .filter(p => !p.isOrder && p.settlementStatus === 'settled')
                  .map(p => p.marketId)
          );

          setTradeHistory(prev => {
              const updated = { ...prev };
              let hasUpdates = false;

              settledTickers.forEach(ticker => {
                  const historyEntry = updated[ticker];

                  // Only update if we have a history entry and it doesn't have exit data yet
                  if (historyEntry && !historyEntry.exitTimestamp) {
                      const settledPosition = mappedItems.find(
                          p => !p.isOrder && p.marketId === ticker && p.settlementStatus === 'settled'
                      );

                      if (settledPosition) {
                          // Calculate exit price from payout and quantity
                          // Payout is in cents, so exitPrice = (payout / quantity)
                          const exitPrice = settledPosition.payout && settledPosition.quantity > 0
                              ? Math.floor(settledPosition.payout / settledPosition.quantity)
                              : null;

                          // Try to get current fair value from markets
                          const currentMarket = markets.find(m => m.realMarketId === ticker);
                          const exitFairValue = currentMarket?.fairValue || null;

                          updated[ticker] = {
                              ...historyEntry,
                              exitTimestamp: settledPosition.settled || Date.now(),
                              exitPrice: exitPrice,
                              exitFairValue: exitFairValue,
                              exitMethod: 'settlement', // Can be 'settlement', 'auto-close', or 'manual'
                              realizedPnl: settledPosition.realizedPnl,
                              totalFees: settledPosition.fees,
                              quantity: settledPosition.quantity
                          };

                          hasUpdates = true;
                          console.log(`[EXIT TRACKING] Updated trade history for ${ticker}: Exit @ ${exitPrice}¢, P&L: ${settledPosition.realizedPnl}¢`);
                      }
                  }
              });

              return hasUpdates ? updated : prev;
          });

          // OPTIMIZATION: Clean up optimistic positions that now have real data
          // Keep optimistic positions only if no real position exists for that ticker
          setPositions(prev => {
              const realTickers = new Set(mappedItems.filter(p => !p.isOrder).map(p => p.marketId));
              const optimisticToKeep = prev.filter(p =>
                  p._optimistic && !realTickers.has(p.marketId)
              );

              // Remove stale optimistic positions (>10s old without real data)
              const freshOptimistic = optimisticToKeep.filter(p => {
                  const age = Date.now() - (p._optimisticTimestamp || 0);
                  if (age > 10000) {
                      console.log(`[OPTIMISTIC] Removing stale optimistic position for ${p.marketId} (age: ${age}ms)`);
                      return false;
                  }
                  return true;
              });

              // Combine real data with fresh optimistic positions
              return [...mappedItems, ...freshOptimistic];
          });
      } catch (e) { console.error("Portfolio Error", e); }
  }, [walletKeys]);

  useEffect(() => { 
      if (walletKeys) { fetchPortfolio(); const i = setInterval(fetchPortfolio, 5000); return () => clearInterval(i); }
  }, [walletKeys, fetchPortfolio]);

  // Create order manager with bot logic extracted to separate modules
  const orderManager = useMemo(() => {
      if (!walletKeys) return null;

      return createOrderManager({
          walletKeys,
          fetchPortfolio,
          addLog,
          setIsRunning,
          setErrorMsg,
          setIsWalletOpen,
          setActiveAction,
          setTradeHistory,
          setPositions,
          config,
          trackers: {
              autoBidTracker,
              closingTracker
          }
      });
  }, [walletKeys, fetchPortfolio, addLog, setTradeHistory, config.tradeSize, config.isAutoBid, config.isAutoClose]);

  // Wrapper functions to maintain compatibility with existing UI code
  const executeOrder = useCallback(async (marketOrTicker, price, isSell, qtyOverride, source = 'manual') => {
      if (!orderManager) return;
      await orderManager.executeOrder(marketOrTicker, price, isSell, qtyOverride, source);
  }, [orderManager]);

  const cancelOrder = useCallback(async (id, skipConfirm = false, skipRefresh = false) => {
      if (!orderManager) return;
      return await orderManager.cancelOrder(id, skipConfirm, skipRefresh);
  }, [orderManager]);

  // Auto-Bid Bot (extracted to separate module)
  useEffect(() => {
      if (!isRunning || !config.isAutoBid || !walletKeys || !orderManager) return;

      runAutoBid({
          markets,
          positions,
          config,
          deselectedMarketIds,
          refs: {
              isAutoBidProcessing,
              autoBidTracker,
              lastFetchTimeRef,
              latestMarketsRef,
              latestDeselectedRef,
              fetchPortfolio
          },
          orderManager,
          addLog
      });

  }, [isRunning, config.isAutoBid, markets, positions, config.marginPercent, config.maxPositions, config.minFairValue, deselectedMarketIds, orderManager]);

  // Auto-Close Bot (extracted to separate module)
  useEffect(() => {
      if (!isRunning || !config.isAutoClose || !walletKeys || !orderManager) return;

      runAutoClose({
          markets,
          positions,
          config,
          tradeHistory,
          refs: {
              closingTracker
          },
          orderManager,
          addLog
      });

  }, [isRunning, config.isAutoClose, markets, positions, config.autoCloseMarginPercent, tradeHistory, orderManager]);

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
  }, [isAutoBidActive, positions, cancelOrder, fetchPortfolio]);

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

  const handleAnalysis = useCallback((item, historyEntry) => {
    setAnalysisModalData({ ...historyEntry, currentStatus: item.settlementStatus || item.status });
  }, []);

  // OPTIMIZATION: Cache enriched markets to preserve object identity for React.memo
  // This prevents all MarketRows from re-rendering when only one market updates.
  const enrichedCache = useRef(new WeakMap());
  const lastMarginRef = useRef(config.marginPercent);

  const enrichedMarkets = useMemo(() => {
      // If margin changed, invalidate cache (by creating new one)
      if (lastMarginRef.current !== config.marginPercent) {
          enrichedCache.current = new WeakMap();
          lastMarginRef.current = config.marginPercent;
      }

      return markets.map(m => {
          // If we have a cached version for this exact market object reference, use it.
          // This works because setMarkets preserves object identity for unchanged markets.
          if (enrichedCache.current.has(m)) {
              return enrichedCache.current.get(m);
          }

          const { smartBid, edge, reason, maxWillingToPay } = calculateStrategy(m, config.marginPercent);
          const enriched = { ...m, smartBid, edge, reason, maxWillingToPay };

          enrichedCache.current.set(m, enriched);
          return enriched;
      });
  }, [markets, config.marginPercent]);

  const groupedMarkets = useMemo(() => {
      const groups = {};
      enrichedMarkets.forEach(market => {
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
  }, [enrichedMarkets, sortConfig]);

  // OPTIMIZATION: Memoize active content filtering to prevent re-calculation on every market update
  const activeContent = useMemo(() => positions.filter(p => {
      if (activeTab === 'positions') {
          return !p.isOrder && p.quantity > 0 && (!p.settlementStatus || p.settlementStatus === 'unsettled');
      }
      if (activeTab === 'resting') {
          return p.isOrder && ['active', 'resting', 'pending'].includes(p.status.toLowerCase());
      }
      if (activeTab === 'history') {
          return !p.isOrder && ((p.settlementStatus && p.settlementStatus !== 'unsettled') || p.quantity === 0) && tradeHistory[p.marketId]?.source === 'auto';
      }
      return false;
  }), [positions, activeTab, tradeHistory]);

  // Calculate WebSocket statistics for header display
  const wsStats = useMemo(() => {
      const subscribed = wsSubscriptionsRef.current.size;
      const active = markets.filter(m => m.priceSource === 'WS').length;
      const subscribedButStale = markets.filter(m => m.isWsSubscribed && m.priceSource === 'HTTP').length;
      return { subscribed, confirmed: active, pending: subscribedButStale, failed: 0 };
  }, [markets]);

  return (
    <TimeProvider>
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <CancellationModal isOpen={isCancelling} progress={cancellationProgress} />
      <Header balance={balance} isRunning={isRunning} setIsRunning={setIsRunning} lastUpdated={lastUpdated} isTurboMode={config.isTurboMode} onConnect={() => setIsWalletOpen(true)} connected={!!walletKeys} wsStatus={wsStatus} wsStats={wsStats} onOpenSettings={() => setIsSettingsOpen(true)} onOpenExport={() => setIsExportOpen(true)} onOpenSchedule={() => setIsScheduleOpen(true)} apiUsage={apiUsage} isScheduled={schedule.enabled} />

      <StatsBanner positions={positions} tradeHistory={tradeHistory} balance={balance} sessionStart={sessionStart} isRunning={isRunning} />

      <PerformanceAlerts positions={positions} tradeHistory={tradeHistory} sessionStart={sessionStart} />

      <ConnectModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} onConnect={k => {setWalletKeys(k); sessionStorage.setItem('kalshi_keys', JSON.stringify(k));}} />
      <ScheduleModal isOpen={isScheduleOpen} onClose={() => setIsScheduleOpen(false)} schedule={schedule} setSchedule={setSchedule} config={config} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} config={config} setConfig={setConfig} oddsApiKey={oddsApiKey} setOddsApiKey={setOddsApiKey} sportsList={sportsList} />
      <SessionReportModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} tradeHistory={tradeHistory} positions={positions} sessionStart={sessionStart} sessionHistory={sessionHistory} />

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
                    <button aria-pressed={config.isAutoBid} onClick={() => setConfig(c => ({...c, isAutoBid: !c.isAutoBid}))} className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ${config.isAutoBid ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-500' : 'bg-slate-100 text-slate-400'}`}><Bot size={14}/> Auto-Bid {config.isAutoBid ? 'ON' : 'OFF'}</button>
                    <button aria-pressed={config.isAutoClose} onClick={() => setConfig(c => ({...c, isAutoClose: !c.isAutoClose}))} className={`px-3 py-1 rounded text-xs font-bold transition-all flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${config.isAutoClose ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-500' : 'bg-slate-100 text-slate-400'}`}><Bot size={14}/> Auto-Close {config.isAutoClose ? 'ON' : 'OFF'}</button>
                    <button aria-pressed={config.isTurboMode} aria-label="Toggle Turbo Mode" title={config.isTurboMode ? "Turbo Mode ON (3s updates, 5x API cost) - Click to disable" : "Turbo Mode OFF (15s updates) - Click to enable"} onClick={() => setConfig(c => ({...c, isTurboMode: !c.isTurboMode}))} className={`p-1.5 rounded transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 ${config.isTurboMode ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-400'}`}><Zap size={16} fill={config.isTurboMode ? "currentColor" : "none"}/></button>
                </div>
            </div>
            <div className="overflow-auto flex-1">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-4 py-3 text-center w-12 bg-slate-50 z-20">
                                <input
                                    type="checkbox"
                                    aria-label="Select or Deselect All Markets"
                                    checked={groupedMarkets.length > 0 && groupedMarkets.every(([_, group]) => group.every(m => !deselectedMarketIds.has(m.id)))}
                                    onChange={() => toggleAllSelection(markets.map(m => m.id))}
                                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                                    title="Select/Deselect All"
                                />
                            </th>
                            <SortableHeader label="Event" sortKey="event" currentSort={sortConfig} onSort={handleSort} />
                            <SortableHeader label="Implied Fair Value" sortKey="fairValue" currentSort={sortConfig} onSort={handleSort} align="center" />
                            <SortableHeader label="Vol" sortKey="volatility" currentSort={sortConfig} onSort={handleSort} align="center" />
                            <th className="p-0 bg-slate-50 border-b border-slate-200 select-none font-medium text-slate-500">
                                <button
                                    onClick={() => handleSort('bestBid')}
                                    className="w-full h-full px-4 py-3 flex items-center gap-1 justify-center hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 outline-none transition-colors group cursor-help"
                                    title="🟢 Green Zap = Live confirmed | 🟡 Pulsing = Pending | 🔴 Red = Failed"
                                >
                                    <span className="text-center flex items-center gap-1.5">
                                        Bid / Ask
                                        <Zap size={10} className="text-slate-400 opacity-50" />
                                    </span>
                                    <span className={`text-slate-400 ${sortConfig.key === 'bestBid' ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                                        {sortConfig.key === 'bestBid' && sortConfig.direction === 'asc' ? <ArrowUp size={12}/> : <ArrowDown size={12}/>}
                                    </span>
                                </button>
                            </th>
                            <SortableHeader label="Max Limit" sortKey="maxWillingToPay" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <SortableHeader label="Smart Bid" sortKey="smartBid" currentSort={sortConfig} onSort={handleSort} align="right" />
                            <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                    </thead>
                    {groupedMarkets.map(([dateKey, groupMarkets]) => (
                        <React.Fragment key={dateKey}>
                            <tbody className="bg-slate-50 border-b border-slate-200">
                                <tr>
                                    <td colSpan={8} className="px-4 py-2 font-bold text-xs text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                        <Calendar size={14} /> {dateKey}
                                    </td>
                                </tr>
                            </tbody>
                            <tbody className="divide-y divide-slate-50">
                                {groupMarkets.map(m => (
                                    <MarketRow
                                        key={m.id}
                                        market={m}
                                        onExecute={executeOrder}
                                        marginPercent={config.marginPercent}
                                        tradeSize={config.tradeSize}
                                        isSelected={!deselectedMarketIds.has(m.id)}
                                        onToggleSelect={toggleMarketSelection}
                                    />
                                ))}
                            </tbody>
                        </React.Fragment>
                    ))}
                </table>
                {markets.length === 0 && (
                    <div className="flex flex-col items-center justify-center p-12 text-slate-400 animate-in fade-in zoom-in duration-300">
                        {config.selectedSports.length === 0 ? (
                            <>
                                <div className="p-3 bg-slate-100 rounded-full mb-3">
                                    <Trophy size={24} className="text-slate-400" />
                                </div>
                                <p className="font-bold text-slate-600">No sports selected</p>
                                <p className="text-xs text-slate-400 mb-3">Select a sport to start scanning markets</p>
                                <button
                                    onClick={() => setConfig(c => ({...c, selectedSports: ['americanfootball_nfl']}))}
                                    className="px-4 py-2 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg hover:bg-blue-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                                >
                                    Select NFL
                                </button>
                            </>
                        ) : !hasScanned ? (
                            <>
                                <Loader2 size={32} className="animate-spin text-blue-500 mb-3" />
                                <p className="font-medium text-slate-500">Scanning markets...</p>
                                <p className="text-xs text-slate-400 mt-1">Fetching live odds and Kalshi data</p>
                            </>
                        ) : (
                            <>
                                <div className="p-3 bg-slate-100 rounded-full mb-3">
                                    <Clock size={24} className="text-slate-400" />
                                </div>
                                <p className="font-medium text-slate-600">No active markets found</p>
                                <p className="text-xs text-slate-400 mt-1">
                                    Checked {config.selectedSports.length} sport{config.selectedSports.length > 1 ? 's' : ''}. Next scan in {config.isTurboMode ? '3s' : '15s'}.
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>

        <div className="space-y-6 flex flex-col h-full lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col min-h-[300px]">
                <div role="tablist" aria-label="Portfolio Views" className="flex border-b border-slate-100 bg-slate-50/50">
                    {['positions', 'resting', 'history'].map(tab => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            aria-controls="portfolio-panel"
                            id={`tab-${tab}`}
                            onClick={() => setActiveTab(tab)}
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all hover:bg-slate-100 focus:outline-none focus-visible:bg-blue-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${activeTab === tab ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-slate-400'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                
                <PortfolioSection 
                    activeTab={activeTab} 
                    positions={activeContent} 
                    markets={markets} 
                    tradeHistory={tradeHistory}
                    onAnalysis={handleAnalysis}
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
    </TimeProvider>
  );
};

export default KalshiDashboard;
