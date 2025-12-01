// File: src/App.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Settings, Play, Pause, RefreshCw, TrendingUp, DollarSign, AlertCircle, Briefcase } from 'lucide-react';

// --- Utility Functions ---

/**
 * Converts American Odds to Implied Probability (0-1)
 * Positive (+200): 100 / (Odds + 100)
 * Negative (-150): -Odds / (-Odds + 100)
 */
const americanToProbability = (americanOdds) => {
  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  } else {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  }
};

/**
 * Converts Probability to American Odds (for display purposes)
 */
const probabilityToAmerican = (prob) => {
  if (prob === 0 || prob === 1) return 0;
  if (prob < 0.5) {
    return Math.round((100 / prob) - 100);
  } else {
    return Math.round(-100 * prob / (1 - prob));
  }
};

// --- Mock Data Generators ---

const TEAMS = [
  { home: 'Chiefs', away: 'Bills' },
  { home: 'Eagles', away: 'Cowboys' },
  { home: 'Celtics', away: 'Lakers' },
  { home: 'Warriors', away: 'Suns' },
  { home: 'Dodgers', away: 'Yankees' },
];

const generateInitialMarket = (id) => {
  const match = TEAMS[id % TEAMS.length];
  // Random base probability between 0.3 and 0.7
  const baseProb = 0.3 + Math.random() * 0.4; 
  const american = probabilityToAmerican(baseProb);
  
  return {
    id: `mkt-${id}`,
    event: `${match.away} @ ${match.home}`,
    americanOdds: american,
    impliedProb: baseProb,
    // Volatility for simulation
    volatility: (Math.random() * 0.02) + 0.005, 
    history: [{ time: 0, price: baseProb * 100 }]
  };
};

const KalshiDashboard = () => {
  // --- State ---
  const [markets, setMarkets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [balance, setBalance] = useState(10000); // Simulated bankroll in cents
  const [isRunning, setIsRunning] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  // Strategy Settings
  const [marginPercent, setMarginPercent] = useState(15); // Target 10-20%
  const [holdStrategy, setHoldStrategy] = useState('sell_limit'); // 'hold_expiry' or 'sell_limit'
  const [apiKey, setApiKey] = useState(''); // Placeholder for real implementation
  
  // --- Initialization ---
  
  // (REMOVED: The old useEffect that generated initial dummy data is replaced by the logic below)

  // --- Simulation & Live Data Engine ---

  useEffect(() => {
    let interval;

    // Function to fetch real data
    const fetchLiveOdds = async () => {
        if (!apiKey) return;
        try {
            // Fetching NFL odds (h2h) from US bookmakers
            const response = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${apiKey}`);
            const data = await response.json();
            
            if (!Array.isArray(data)) return;

            const newMarkets = data.slice(0, 10).map(game => {
                // Find the best available odds (simplified to first bookmaker)
                const bookmaker = game.bookmakers[0];
                if (!bookmaker) return null;
                
                const outcome = bookmaker.markets[0].outcomes.find(o => o.price < 0) || bookmaker.markets[0].outcomes[0]; // focus on favorite
                const prob = americanToProbability(outcome.price);
                
                return {
                    id: game.id,
                    event: `${game.away_team} @ ${game.home_team}`,
                    americanOdds: outcome.price,
                    impliedProb: prob,
                    volatility: 0, // Real data doesn't use sim volatility
                    history: [] // Simplified: Real history would require a database
                };
            }).filter(Boolean);
            
            setMarkets(newMarkets);
        } catch (error) {
            console.error("Failed to fetch odds", error);
        }
    };

    if (isRunning) {
      if (apiKey) {
          // LIVE MODE: Fetch every 30 seconds to save API quota
          fetchLiveOdds(); // Fetch immediately
          interval = setInterval(fetchLiveOdds, 30000); 
      } else {
          // SIMULATION MODE: Run random walk every 1 second
          if (markets.length === 0) {
             // Generate initial dummy data if empty
             const initialMarkets = Array.from({ length: 5 }).map((_, i) => generateInitialMarket(i));
             setMarkets(initialMarkets);
          }

          interval = setInterval(() => {
            setCurrentTime(t => t + 1);
            
            setMarkets(prevMarkets => {
              return prevMarkets.map(market => {
                // Random walk simulation for odds
                const change = (Math.random() - 0.5) * market.volatility;
                let newProb = Math.max(0.01, Math.min(0.99, market.impliedProb + change));
                
                // Occasionally drift back to mean to prevent extreme 0/1 too fast
                if (newProb > 0.9 || newProb < 0.1) newProb = (newProb + market.impliedProb) / 2;
    
                const newAmerican = probabilityToAmerican(newProb);
                
                // Keep simplified history for charts
                const newHistory = [...market.history, { time: currentTime + 1, price: newProb * 100 }].slice(-20);
    
                return {
                  ...market,
                  impliedProb: newProb,
                  americanOdds: newAmerican,
                  history: newHistory
                };
              });
            });
    
            // Check for exits (Shared logic for both modes)
            setPositions(prevPositions => {
                return prevPositions.map(pos => {
                    if (pos.status !== 'OPEN') return pos;
    
                    // Find current market price for this position
                    const market = markets.find(m => m.id === pos.marketId);
                    if (!market) return pos;
    
                    // Strategy: Sell if valuation is 10-20% above sportsbook odds
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
  }, [isRunning, currentTime, markets, holdStrategy, marginPercent, apiKey]);

  // --- Actions ---

  const executeTrade = (market, side) => {
    const fairValue = market.impliedProb * 100;
    
    // Strategy: Bid 10-20% in our favor
    // If Fair Value is 60c, and margin is 20%, we bid 48c.
    const discountFactor = 1 - (marginPercent / 100);
    const bidPrice = Math.floor(fairValue * discountFactor);
    
    // Cost for 10 contracts
    const quantity = 100; // contracts
    const cost = bidPrice * quantity;

    if (balance < cost) {
      alert("Insufficient funds for simulation");
      return;
    }

    setBalance(b => b - cost);

    const newPosition = {
      id: `pos-${Date.now()}`,
      marketId: market.id,
      event: market.event,
      side: 'YES', // Simplified to only buying YES contracts for this demo
      quantity: quantity,
      avgEntryPrice: bidPrice,
      fairValueAtEntry: fairValue,
      status: 'OPEN',
      timestamp: currentTime
    };

    setPositions(prev => [newPosition, ...prev]);
  };

  const closePosition = (position) => {
    const market = markets.find(m => m.id === position.marketId);
    const currentPrice = market ? market.impliedProb * 100 : position.avgEntryPrice;
    const profit = (currentPrice - position.avgEntryPrice) * position.quantity;
    
    setBalance(b => b + (currentPrice * position.quantity));
    
    setPositions(prev => prev.map(p => 
      p.id === position.id 
        ? { ...p, status: 'CLOSED', exitPrice: currentPrice, profit: profit }
        : p
    ));
  };

  // --- UI Components ---

  const StatCard = ({ title, value, subtext, color = "blue" }) => (
    <div className={`bg-white p-4 rounded-xl shadow-sm border-l-4 border-${color}-500`}>
      <div className="text-gray-500 text-sm font-medium">{title}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans p-4 md:p-8">
      
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp className="text-blue-600" />
            Kalshi ArbBot <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full uppercase tracking-wide">Beta Sim</span>
          </h1>
          <p className="text-gray-500 mt-1">Sportsbook Odds to Prediction Market Arbitrage</p>
        </div>
        
        <div className="flex items-center gap-3">
            <div className="bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 flex items-center gap-2">
                <DollarSign size={16} className="text-green-600"/>
                <span className="font-mono font-bold text-lg">{(balance / 100).toFixed(2)}</span>
                <span className="text-xs text-gray-400">USD</span>
            </div>
            <button 
                onClick={() => setIsRunning(!isRunning)}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white transition-colors ${isRunning ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}`}
            >
                {isRunning ? <><Pause size={18}/> Pause Sim</> : <><Play size={18}/> Run Strategy</>}
            </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Market Scanner */}
        <div className="lg:col-span-2 space-y-6">
            
            {/* Live Feed */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h2 className="font-semibold text-gray-700 flex items-center gap-2">
                        <RefreshCw size={16} className={isRunning ? "animate-spin text-blue-500" : "text-gray-400"}/>
                        Live Sportsbook Feed
                    </h2>
                    <span className="text-xs text-gray-500">Source: The-Odds-API (Simulated)</span>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-medium">
                            <tr>
                                <th className="px-4 py-3">Event</th>
                                <th className="px-4 py-3">Sportsbook Odds</th>
                                <th className="px-4 py-3">Implied Prob</th>
                                <th className="px-4 py-3">Fair Value</th>
                                <th className="px-4 py-3 text-right">Target Bid (-{marginPercent}%)</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {markets.map(market => {
                                const fairValue = market.impliedProb * 100;
                                const bidPrice = Math.floor(fairValue * (1 - marginPercent/100));
                                
                                return (
                                <tr key={market.id} className="hover:bg-blue-50 transition-colors">
                                    <td className="px-4 py-3 font-medium text-gray-900">{market.event}</td>
                                    <td className="px-4 py-3 font-mono text-blue-600">
                                        {market.americanOdds > 0 ? `+${market.americanOdds}` : market.americanOdds}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600">
                                        {(market.impliedProb * 100).toFixed(1)}%
                                    </td>
                                    <td className="px-4 py-3 font-bold text-gray-800">
                                        {fairValue.toFixed(1)}¢
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-green-600 font-bold">
                                        {bidPrice}¢
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button 
                                            onClick={() => executeTrade(market, 'YES')}
                                            className="bg-gray-900 hover:bg-black text-white px-3 py-1.5 rounded text-xs font-medium transition-transform active:scale-95"
                                        >
                                            Place Bid
                                        </button>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Charts Area */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                 <h3 className="text-sm font-semibold text-gray-500 mb-4">Odds Drift Visualization (Implied Probability)</h3>
                 <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                            <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tick={false} />
                            <YAxis domain={[0, 100]} unit="¢" width={40} tick={{fontSize: 12, fill: '#9ca3af'}}/>
                            <Tooltip 
                                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}
                                itemStyle={{color: '#374151', fontSize: '12px'}}
                                formatter={(value) => [`${value.toFixed(1)}¢`, 'Price']}
                                labelFormatter={() => ''}
                            />
                            {markets.map((m, i) => (
                                <Line 
                                    key={m.id}
                                    data={m.history} 
                                    type="monotone" 
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
        </div>

        {/* Right Column: Strategy & Positions */}
        <div className="space-y-6">
            
            {/* Strategy Config */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
                <div className="flex items-center gap-2 mb-4 text-gray-800 font-semibold border-b pb-2">
                    <Settings size={18} />
                    Strategy Configuration
                </div>
                
                <div className="space-y-4">
                    <div>
                        <label className="flex justify-between text-sm font-medium text-gray-600 mb-1">
                            Margin / Edge Target
                            <span className="text-blue-600 font-bold">{marginPercent}%</span>
                        </label>
                        <input 
                            type="range" 
                            min="5" 
                            max="30" 
                            value={marginPercent} 
                            onChange={(e) => setMarginPercent(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            We bid {marginPercent}% below the sportsbook implied fair value.
                        </p>
                    </div>

                    <div>
                         <label className="block text-sm font-medium text-gray-600 mb-2">
                            Exit Strategy
                        </label>
                        <div className="flex bg-gray-100 p-1 rounded-lg">
                            <button 
                                onClick={() => setHoldStrategy('hold_expiry')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${holdStrategy === 'hold_expiry' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
                            >
                                Hold to Expiry
                            </button>
                            <button 
                                onClick={() => setHoldStrategy('sell_limit')}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${holdStrategy === 'sell_limit' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}
                            >
                                Sell at Valuation
                            </button>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-gray-100">
                         <label className="block text-xs font-medium text-gray-400 mb-1">
                            Odds API Key (Optional)
                        </label>
                        <input 
                            type="password" 
                            placeholder="Enter Key to go Live"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            className="w-full text-xs p-2 border border-gray-200 rounded focus:outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* Active Positions */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-200 flex-1">
                 <div className="flex items-center gap-2 mb-4 text-gray-800 font-semibold">
                    <Briefcase size={18} />
                    Positions ({positions.filter(p => p.status === 'OPEN').length})
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                    {positions.length === 0 && (
                        <div className="text-center py-8 text-gray-400 text-sm border-2 border-dashed border-gray-100 rounded-lg">
                            No active trades.<br/>Start the simulation or place a bid manually.
                        </div>
                    )}

                    {[...positions].reverse().map(pos => (
                        <div key={pos.id} className={`p-3 rounded-lg border text-sm ${pos.status === 'CLOSED' ? 'bg-gray-50 border-gray-100 opacity-75' : 'bg-blue-50 border-blue-100'}`}>
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-gray-800">{pos.event}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.status === 'OPEN' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                                    {pos.status}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-y-1 text-xs text-gray-600">
                                <div>Qty: <span className="font-mono">{pos.quantity}</span></div>
                                <div>Entry: <span className="font-mono">{pos.avgEntryPrice}¢</span></div>
                                {pos.status === 'CLOSED' && (
                                    <>
                                        <div className="col-span-2 mt-1 pt-1 border-t border-gray-200 flex justify-between items-center">
                                            <span>Profit/Loss:</span>
                                            <span className={`font-bold font-mono ${pos.profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                                {pos.profit > 0 ? '+' : ''}{(pos.profit/100).toFixed(2)}$
                                            </span>
                                        </div>
                                    </>
                                )}
                                {pos.status === 'OPEN' && (
                                    <div className="col-span-2 mt-2">
                                        <button 
                                            onClick={() => closePosition(pos)}
                                            className="w-full py-1 bg-white border border-gray-200 shadow-sm rounded text-gray-600 hover:text-red-600 hover:border-red-200 transition-colors text-xs"
                                        >
                                            Close Early
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

        </div>
      </div>
      
      {/* Footer Info */}
      <div className="mt-8 text-center text-xs text-gray-400">
        <p>Market data is simulated for demonstration. In a real environment, this connects to The-Odds-API.</p>
        <p>Kalshi contracts settle at 100c (Yes) or 0c (No). Always verify margin requirements.</p>
      </div>

    </div>
  );
};

export default KalshiDashboard;