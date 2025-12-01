// File: src/App.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Settings, Play, Pause, RefreshCw, TrendingUp, DollarSign, AlertCircle, Briefcase, Activity, Globe } from 'lucide-react';

// --- Utility Functions ---

const americanToProbability = (americanOdds) => {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
};

const probabilityToAmerican = (prob) => {
  if (prob === 0 || prob === 1) return 0;
  if (prob < 0.5) return Math.round((100 / prob) - 100);
  return Math.round(-100 * prob / (1 - prob));
};

// --- Mock Data Generators ---

const TEAMS = [
  { home: 'Chiefs', away: 'Bills' },
  { home: 'Eagles', away: 'Cowboys' },
  { home: 'Celtics', away: 'Lakers' },
  { home: 'Warriors', away: 'Suns' },
  { home: 'Dodgers', away: 'Yankees' },
];

/**
 * Simulates the Kalshi Order Book (Best Bid/Ask) based on the "True" probability.
 * Real markets have spreads and noise.
 */
const generateMarketStructure = (baseProb) => {
    const spread = 0.04 + Math.random() * 0.05; // 4-9 cent spread
    const noise = (Math.random() - 0.5) * 0.04; // Market inefficiency
    
    // The market might differ slightly from the "True" sportsbook odds
    const marketCenter = baseProb + noise; 
    
    let bestBid = Math.floor((marketCenter - (spread/2)) * 100);
    let bestAsk = Math.ceil((marketCenter + (spread/2)) * 100);
    
    // Clamp
    bestBid = Math.max(1, Math.min(98, bestBid));
    bestAsk = Math.max(bestBid + 1, Math.min(99, bestAsk));

    return { bestBid, bestAsk };
};

const generateInitialMarket = (id) => {
  const match = TEAMS[id % TEAMS.length];
  const baseProb = 0.3 + Math.random() * 0.4; 
  const { bestBid, bestAsk } = generateMarketStructure(baseProb);
  
  return {
    id: `mkt-${id}`,
    event: `${match.away} @ ${match.home}`,
    americanOdds: probabilityToAmerican(baseProb),
    impliedProb: baseProb,
    bestBid, // Simulated Kalshi Best Bid
    bestAsk, // Simulated Kalshi Best Ask
    volatility: (Math.random() * 0.02) + 0.005, 
    history: [{ time: 0, price: baseProb * 100 }]
  };
};

const KalshiDashboard = () => {
  // --- State ---
  const [markets, setMarkets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [balance, setBalance] = useState(10000); 
  const [isRunning, setIsRunning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  // Strategy Settings
  const [marginPercent, setMarginPercent] = useState(15); 
  const [holdStrategy, setHoldStrategy] = useState('sell_limit');
  const [apiKey, setApiKey] = useState('');
  const [dataSource, setDataSource] = useState('SIMULATION'); // 'SIMULATION' | 'LIVE'
  
  // --- Initialization Effect ---
  // Ensure data exists on load or when switching modes
  useEffect(() => {
    if (dataSource === 'SIMULATION') {
        const initialMarkets = Array.from({ length: 5 }).map((_, i) => generateInitialMarket(i));
        setMarkets(initialMarkets);
    } else {
        // Optional: Clear markets when switching to LIVE to prevent stale data
        setMarkets([]);
    }
  }, [dataSource]);

  // --- Engine Effect ---
  // Handles updates (ticking) and live fetching
  useEffect(() => {
    let interval;

    const fetchLiveOdds = async () => {
        if (!apiKey) return;
        try {
            const response = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${apiKey}`);
            const data = await response.json();
            
            if (!Array.isArray(data)) return;

            const newMarkets = data.slice(0, 10).map(game => {
                const bookmaker = game.bookmakers[0];
                if (!bookmaker) return null;
                
                const outcome = bookmaker.markets[0].outcomes.find(o => o.price < 0) || bookmaker.markets[0].outcomes[0];
                const prob = americanToProbability(outcome.price);
                
                // IMPORTANT: Since we don't have a live Kalshi API, we must still SIMULATE the Kalshi order book
                // relative to the real sportsbook odds to test the bidding logic.
                const { bestBid, bestAsk } = generateMarketStructure(prob);

                return {
                    id: game.id,
                    event: `${game.away_team} @ ${game.home_team}`,
                    americanOdds: outcome.price,
                    impliedProb: prob,
                    bestBid, 
                    bestAsk,
                    volatility: 0, 
                    history: [] 
                };
            }).filter(Boolean);
            
            setMarkets(newMarkets);
        } catch (error) {
            console.error("Failed to fetch odds", error);
        }
    };

    if (isRunning) {
      if (dataSource === 'LIVE' && apiKey) {
          fetchLiveOdds(); 
          interval = setInterval(fetchLiveOdds, 30000); 
      } else if (dataSource === 'SIMULATION') {
          // SIMULATION LOOP
          interval = setInterval(() => {
            setCurrentTime(t => t + 1);
            
            setMarkets(prevMarkets => {
              return prevMarkets.map(market => {
                const change = (Math.random() - 0.5) * market.volatility;
                let newProb = Math.max(0.01, Math.min(0.99, market.impliedProb + change));
                if (newProb > 0.9 || newProb < 0.1) newProb = (newProb + market.impliedProb) / 2;
                
                // Update Order Book based on new prob
                const { bestBid, bestAsk } = generateMarketStructure(newProb);

                return {
                  ...market,
                  impliedProb: newProb,
                  americanOdds: probabilityToAmerican(newProb),
                  bestBid,
                  bestAsk,
                  history: [...market.history, { time: currentTime + 1, price: newProb * 100 }].slice(-20)
                };
              });
            });
    
            // Check for exits
            setPositions(prevPositions => {
                return prevPositions.map(pos => {
                    if (pos.status !== 'OPEN') return pos;
                    const market = markets.find(m => m.id === pos.marketId);
                    if (!market) return pos;
    
                    // Sell Logic: We sell into the "Best Bid" of the market (simplified as FairValue here for arb check)
                    const currentFairValue = market.impliedProb * 100;
                    
                    if (holdStrategy === 'sell_limit') {
                        const targetSellPrice = pos.avgEntryPrice * (1 + (marginPercent / 100));
                        if (currentFairValue >= targetSellPrice) {
                            const profit = (currentFairValue - pos.avgEntryPrice) * pos.quantity;
                            setBalance(b => b + (currentFairValue * pos.quantity));
                            return { ...pos, status: 'CLOSED', exitPrice: currentFairValue, profit: profit };
                        }
                    }
                    return pos;
                });
            });
          }, 1000);
      }
    }
    return () => clearInterval(interval);
  }, [isRunning, currentTime, dataSource, holdStrategy, marginPercent, apiKey]);

  // --- Smart Bidding Logic ---

  const getSmartBid = (market) => {
      const fairValue = Math.floor(market.impliedProb * 100);
      const maxWillingToPay = Math.floor(fairValue * (1 - marginPercent / 100));
      const marketBestBid = market.bestBid;

      // Strategy:
      // 1. If Market Bid >= Our Max Limit -> We can't compete. Bid our Max Limit (or sit out).
      // 2. If Market Bid < Our Max Limit  -> Bid Market Bid + 1 (Price Improvement).
      
      let smartBid = 0;
      let reason = "";

      if (marketBestBid >= maxWillingToPay) {
          smartBid = maxWillingToPay;
          reason = "Max Limit";
      } else {
          smartBid = marketBestBid + 1;
          reason = "Beat Market (+1)";
      }
      
      return { smartBid, maxWillingToPay, reason };
  };

  const executeTrade = (market) => {
    const { smartBid } = getSmartBid(market);
    const quantity = 100;
    const cost = smartBid * quantity;

    if (balance < cost) {
      alert("Insufficient funds");
      return;
    }

    setBalance(b => b - cost);

    const newPosition = {
      id: `pos-${Date.now()}`,
      marketId: market.id,
      event: market.event,
      side: 'YES',
      quantity: quantity,
      avgEntryPrice: smartBid,
      status: 'OPEN',
      timestamp: currentTime
    };

    setPositions(prev => [newPosition, ...prev]);
  };

  const closePosition = (position) => {
    const market = markets.find(m => m.id === position.marketId);
    const currentPrice = market ? Math.floor(market.impliedProb * 100) : position.avgEntryPrice;
    const profit = (currentPrice - position.avgEntryPrice) * position.quantity;
    setBalance(b => b + (currentPrice * position.quantity));
    setPositions(prev => prev.map(p => p.id === position.id ? { ...p, status: 'CLOSED', exitPrice: currentPrice, profit: profit } : p));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="text-blue-600" />
            Kalshi ArbBot
          </h1>
          <div className="flex items-center gap-2 mt-2">
             <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${dataSource === 'LIVE' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                {dataSource === 'LIVE' ? 'LIVE FEED (ODDS API)' : 'SIMULATION MODE'}
             </span>
             {dataSource === 'LIVE' && (
                 <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-200">
                    KALSHI ORDERBOOK: SIMULATED
                 </span>
             )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
            <div className="bg-slate-100 px-4 py-2 rounded-lg border border-slate-200 flex items-center gap-2">
                <DollarSign size={16} className="text-emerald-600"/>
                <span className="font-mono font-bold text-lg">{(balance / 100).toFixed(2)}</span>
            </div>
            <button 
                onClick={() => setIsRunning(!isRunning)}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white transition-all shadow-sm active:scale-95 ${isRunning ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
                {isRunning ? <><Pause size={18}/> Pause</> : <><Play size={18}/> Start Engine</>}
            </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Market Data Panel */}
        <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                        <Activity size={16} className={isRunning ? "text-emerald-500" : "text-slate-400"}/>
                        Market Scanner
                    </h2>
                    
                    {/* Source Toggle */}
                    <div className="flex bg-slate-200 p-1 rounded-lg">
                        <button 
                            onClick={() => setDataSource('SIMULATION')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${dataSource === 'SIMULATION' ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Simulation
                        </button>
                        <button 
                            onClick={() => setDataSource('LIVE')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${dataSource === 'LIVE' ? 'bg-white shadow text-green-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Live Data
                        </button>
                    </div>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                            <tr>
                                <th className="px-4 py-3 w-1/4">Event</th>
                                <th className="px-4 py-3 text-center">Implied<br/>Fair Value</th>
                                <th className="px-4 py-3 text-center bg-slate-100/50 border-x border-slate-100">
                                    Current<br/>Highest Bid
                                </th>
                                <th className="px-4 py-3 text-right">Max Limit<br/>(-{marginPercent}%)</th>
                                <th className="px-4 py-3 text-right">Smart<br/>Bid</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {markets.map(market => {
                                const fairValue = Math.floor(market.impliedProb * 100);
                                const { smartBid, maxWillingToPay, reason } = getSmartBid(market);
                                
                                return (
                                <tr key={market.id} className="hover:bg-blue-50/30 transition-colors group">
                                    <td className="px-4 py-3 font-medium text-slate-700">
                                        {market.event}
                                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                            Odds: {market.americanOdds > 0 ? `+${market.americanOdds}` : market.americanOdds}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center font-bold text-slate-700">
                                        {fairValue}¢
                                    </td>
                                    <td className="px-4 py-3 text-center bg-slate-50/50 border-x border-slate-100 font-mono text-slate-500">
                                        {market.bestBid}¢
                                    </td>
                                    <td className="px-4 py-3 text-right text-slate-400">
                                        {maxWillingToPay}¢
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="font-bold font-mono text-emerald-600 text-base">{smartBid}¢</div>
                                        <div className="text-[9px] uppercase tracking-wide text-emerald-600/70 font-bold">{reason}</div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button 
                                            onClick={() => executeTrade(market)}
                                            className="bg-slate-900 hover:bg-blue-600 text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all active:scale-95 shadow-sm opacity-0 group-hover:opacity-100"
                                        >
                                            Bid {smartBid}¢
                                        </button>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                    {markets.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">
                            {dataSource === 'LIVE' && !apiKey ? 'Enter API Key to load live data.' : 'Loading markets...'}
                        </div>
                    )}
                </div>
            </div>

            {/* Charts */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[0, 100]} unit="¢" width={30} tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false}/>
                        <Tooltip 
                            contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}
                            itemStyle={{fontSize: '12px'}}
                            labelFormatter={() => ''}
                        />
                        {markets.map((m, i) => (
                            <Line 
                                key={m.id}
                                data={m.history} 
                                type="stepAfter" 
                                dataKey="price" 
                                stroke={`hsl(${i * 60}, 70%, 50%)`} 
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>

        {/* Config & Positions */}
        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-4 text-slate-800 font-bold text-sm uppercase tracking-wider border-b border-slate-100 pb-2">
                    <Settings size={16} /> Strategy Config
                </div>
                
                <div className="space-y-5">
                    <div>
                        <div className="flex justify-between text-sm font-medium text-slate-600 mb-2">
                            <span>Margin Target</span>
                            <span className="text-blue-600 font-bold">{marginPercent}%</span>
                        </div>
                        <input 
                            type="range" 
                            min="5" 
                            max="30" 
                            value={marginPercent} 
                            onChange={(e) => setMarginPercent(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                    </div>

                    <div className="space-y-2">
                         <label className="text-xs font-bold text-slate-400 uppercase">Exit Strategy</label>
                         <div className="grid grid-cols-2 gap-2">
                            {['hold_expiry', 'sell_limit'].map((s) => (
                                <button 
                                    key={s}
                                    onClick={() => setHoldStrategy(s)}
                                    className={`py-2 text-xs font-bold rounded-lg border transition-all ${holdStrategy === s ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                >
                                    {s === 'hold_expiry' ? 'Hold to End' : 'Sell Early'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {dataSource === 'LIVE' && (
                        <div className="pt-2">
                            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">The-Odds-API Key</label>
                            <input 
                                type="password" 
                                placeholder="Paste API Key Here"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            />
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex-1">
                 <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2">
                    <div className="flex items-center gap-2 text-slate-800 font-bold text-sm uppercase tracking-wider">
                        <Briefcase size={16} /> Portfolio
                    </div>
                    <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-500">
                        {positions.filter(p => p.status === 'OPEN').length} Open
                    </span>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                    {positions.length === 0 && (
                        <div className="text-center py-10 text-slate-400 text-xs italic">
                            No active positions.
                        </div>
                    )}

                    {[...positions].reverse().map(pos => (
                        <div key={pos.id} className={`p-3 rounded-lg border text-sm transition-all ${pos.status === 'CLOSED' ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-blue-100 shadow-sm hover:shadow-md'}`}>
                            <div className="flex justify-between items-start mb-2">
                                <span className="font-bold text-slate-700 line-clamp-1">{pos.event}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.status === 'OPEN' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                                    {pos.status}
                                </span>
                            </div>
                            <div className="flex justify-between items-end text-xs text-slate-500">
                                <div>
                                    <div>Bid: <span className="font-mono font-bold text-slate-700">{pos.avgEntryPrice}¢</span></div>
                                    <div>Qty: {pos.quantity}</div>
                                </div>
                                {pos.status === 'CLOSED' ? (
                                    <div className={`font-mono font-bold ${pos.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                        {pos.profit > 0 ? '+' : ''}{(pos.profit/100).toFixed(2)}$
                                    </div>
                                ) : (
                                    <button 
                                        onClick={() => closePosition(pos)}
                                        className="text-[10px] font-bold text-rose-500 hover:text-rose-700 hover:underline"
                                    >
                                        Close
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default KalshiDashboard;