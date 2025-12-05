// File: src/App.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Settings, Play, Pause, RefreshCw, TrendingUp, DollarSign, AlertCircle, Briefcase, Activity, Trophy, Clock, Zap, Link as LinkIcon, Unlink, Bug, TrendingDown } from 'lucide-react';

// ==========================================
// 1. CONFIGURATION & CONSTANTS
// ==========================================

const REFRESH_COOLDOWN = 10000; 

const SPORT_MAPPING = [
    { key: 'americanfootball_nfl', title: 'Football (NFL)', kalshiSeries: 'KXNFLGAME' },
    { key: 'basketball_nba', title: 'Basketball (NBA)', kalshiSeries: 'KXNBAGAME' },
    { key: 'baseball_mlb', title: 'Baseball (MLB)', kalshiSeries: 'KXMLBGAME' },
    { key: 'icehockey_nhl', title: 'Hockey (NHL)', kalshiSeries: 'KXNHLGAME' },
];

const TEAM_ABBR = {
    'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL', 'Buffalo Bills': 'BUF',
    'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI', 'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE',
    'Dallas Cowboys': 'DAL', 'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
    'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX', 'Kansas City Chiefs': 'KC',
    'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC', 'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA',
    'Minnesota Vikings': 'MIN', 'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
    'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT', 'San Francisco 49ers': 'SF',
    'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB', 'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
    // NBA
    'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN', 'New York Knicks': 'NYK', 'Philadelphia 76ers': 'PHI',
    'Toronto Raptors': 'TOR', 'Golden State Warriors': 'GS', 'Los Angeles Lakers': 'LAL', 'Los Angeles Clippers': 'LAC',
    'Phoenix Suns': 'PHX', 'Sacramento Kings': 'SAC', 'Dallas Mavericks': 'DAL', 'Houston Rockets': 'HOU',
    'Oklahoma City Thunder': 'OKC', 'Denver Nuggets': 'DEN', 'Minnesota Timberwolves': 'MIN', 'Portland Trail Blazers': 'POR',
    'Utah Jazz': 'UTA', 'San Antonio Spurs': 'SAS', 'Memphis Grizzlies': 'MEM', 'New Orleans Pelicans': 'NO',
    'Detroit Pistons': 'DET', 'Indiana Pacers': 'IND', 'Milwaukee Bucks': 'MIL', 'Atlanta Hawks': 'ATL', 'Charlotte Hornets': 'CHA',
    'Miami Heat': 'MIA', 'Orlando Magic': 'ORL', 'Washington Wizards': 'WAS'
};

// ==========================================
// 2. UTILITY FUNCTIONS
// ==========================================

const americanToProbability = (americanOdds) => {
  if (americanOdds > 0) return 100 / (americanOdds + 100);
  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
};

/**
 * Core Matching Logic: Links Sportsbook Events to Kalshi Markets
 */
const findKalshiMatch = (homeTeam, awayTeam, commenceTime, kalshiMarkets, seriesTicker) => {
    if (!kalshiMarkets || !homeTeam || !awayTeam) return null;

    // 1. Construct Target Ticker Pattern (e.g., 25DEC07CINBUF)
    let targetSuffix = "";
    const date = new Date(commenceTime);
    if (!isNaN(date.getTime())) {
        const yy = date.getFullYear().toString().slice(-2);
        const mmm = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const dd = date.getDate().toString().padStart(2, '0');
        
        const homeAbbr = TEAM_ABBR[homeTeam] || homeTeam.substring(0, 3).toUpperCase();
        const awayAbbr = TEAM_ABBR[awayTeam] || awayTeam.substring(0, 3).toUpperCase();
        
        targetSuffix = `${yy}${mmm}${dd}${awayAbbr}${homeAbbr}`;
    }

    // 2. Scan Markets
    return kalshiMarkets.find(k => {
        const ticker = k.ticker ? k.ticker.toUpperCase() : '';
        
        // Strategy A: Exact Ticker Pattern Match (High Precision)
        if (targetSuffix && ticker.includes(targetSuffix)) return true;

        // Strategy B: Series + Abbreviation Fallback
        if (seriesTicker && ticker.startsWith(seriesTicker)) {
            const homeAbbr = TEAM_ABBR[homeTeam];
            const awayAbbr = TEAM_ABBR[awayTeam];
            if (homeAbbr && awayAbbr && ticker.includes(homeAbbr) && ticker.includes(awayAbbr)) {
                return true;
            }
        }
        return false;
    });
};

/**
 * Strategy Engine: Calculates the "Shark Bid"
 */
const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: 0 };

    const fairValue = Math.floor(market.impliedProb * 100);
    const maxWillingToPay = Math.floor(fairValue * (1 - marginPercent / 100));
    
    // We compete against the BEST BID (Highest price someone is waiting to buy at)
    // We want to be Best Bid + 1, provided it's still below our max willing price.
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = 0;
    let reason = "";

    if (currentBestBid >= maxWillingToPay) {
        // Market is already too expensive/efficient. We can't beat the bid profitably.
        // We sit at our max limit hoping for a crash.
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    } else {
        // Market is inefficient. We can beat the current bid and still have margin.
        smartBid = currentBestBid + 1;
        reason = "Beat Market (+1)";
    }

    return { smartBid, maxWillingToPay, edge, reason };
};

// ==========================================
// 3. SUB-COMPONENTS
// ==========================================

const Header = ({ balance, isRunning, setIsRunning, lastUpdated, isTurboMode }) => (
    <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="text-blue-600" />
                Kalshi ArbBot
            </h1>
            <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-green-100 text-green-700 border-green-200">
                    LIVE MARKET DATA
                </span>
                {lastUpdated && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-200">
                        <Clock size={10} /> {lastUpdated.toLocaleTimeString()}
                    </span>
                )}
                {isTurboMode && (
                    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200 animate-pulse">
                        <Zap size={10} fill="currentColor"/> TURBO
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
);

const MarketRow = ({ market, onExecute, marginPercent }) => {
    const fairValue = Math.floor(market.impliedProb * 100);
    const { smartBid, maxWillingToPay, reason, edge } = calculateStrategy(market, marginPercent);
    const isFlash = Date.now() - market.lastChange < 1500; 

    return (
        <tr className={`transition-all duration-500 group ${isFlash ? 'bg-yellow-50' : 'hover:bg-blue-50/30'}`}>
            <td className="px-4 py-3 font-medium text-slate-700">
                <div className="flex flex-col">
                    <span>{market.event}</span>
                    <div className="flex items-center gap-1 mt-1">
                        {market.isMatchFound ? (
                            <span className="flex items-center gap-1 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                                <LinkIcon size={10} /> Live Match
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded">
                                <Unlink size={10} /> No Market
                            </span>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono">
                            Odds: {market.americanOdds > 0 ? `+${market.americanOdds}` : market.americanOdds}
                        </span>
                    </div>
                </div>
            </td>
            <td className={`px-4 py-3 text-center font-bold transition-colors duration-300 ${isFlash ? 'text-blue-600' : 'text-slate-700'}`}>
                {fairValue}¢
            </td>
            <td className={`px-4 py-3 text-center border-x border-slate-100 font-mono text-slate-500 bg-slate-50/50`}>
                {market.isMatchFound ? `${market.bestBid}¢` : '-'}
            </td>
            <td className="px-4 py-3 text-right text-slate-400">
                {market.isMatchFound ? `${maxWillingToPay}¢` : '-'}
            </td>
            <td className="px-4 py-3 text-right">
                {market.isMatchFound ? (
                    <>
                        <div className="flex flex-col items-end">
                            <div className={`font-bold font-mono text-base transition-colors ${isFlash ? 'text-purple-600 scale-110' : 'text-emerald-600'}`}>
                                {smartBid}¢
                            </div>
                            {edge > 0 && (
                                <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1 rounded flex items-center gap-0.5">
                                    <TrendingDown size={8} className="rotate-180"/> +{edge}¢ Edge
                                </span>
                            )}
                        </div>
                        <div className="text-[9px] uppercase tracking-wide text-slate-400 font-bold mt-0.5">{reason}</div>
                    </>
                ) : (
                    <span className="text-slate-300">-</span>
                )}
            </td>
            <td className="px-4 py-3 text-center">
                <button 
                    onClick={() => onExecute(market, smartBid)}
                    disabled={!market.isMatchFound}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${
                        market.isMatchFound 
                        ? 'bg-slate-900 hover:bg-blue-600 text-white active:scale-95' 
                        : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    }`}
                >
                    {market.isMatchFound ? `Bid ${smartBid}¢` : 'No Market'}
                </button>
            </td>
        </tr>
    );
};

// ==========================================
// 4. MAIN APP COMPONENT
// ==========================================

const KalshiDashboard = () => {
  // State
  const [markets, setMarkets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [balance, setBalance] = useState(10000); 
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState(''); 
  const [lastUpdated, setLastUpdated] = useState(null);
  const [debugLog, setDebugLog] = useState([]); 

  // Settings
  const [marginPercent, setMarginPercent] = useState(15); 
  const [oddsApiKey, setOddsApiKey] = useState('');
  const [selectedSport, setSelectedSport] = useState('americanfootball_nfl'); 
  const [isTurboMode, setIsTurboMode] = useState(false); 
  
  const [sportsList, setSportsList] = useState(SPORT_MAPPING);
  const [isLoadingSports, setIsLoadingSports] = useState(false);

  // Refs
  const lastFetchTimeRef = useRef(0);
  const abortControllerRef = useRef(null);

  // --- Data Fetching Logic ---
  useEffect(() => {
      const fetchSportsList = async () => {
          if (!oddsApiKey || oddsApiKey.length < 10) return;
          setIsLoadingSports(true);
          try {
              const response = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${oddsApiKey}`);
              const data = await response.json();
              if (Array.isArray(data)) {
                  const mergedSports = data
                      .filter(s => s.key && s.title)
                      .map(s => {
                          const map = SPORT_MAPPING.find(m => m.key === s.key);
                          return map ? { ...s, kalshiSeries: map.kalshiSeries } : s;
                      });
                  setSportsList(mergedSports);
              }
          } catch (e) {
              console.error("Failed to load sports list", e);
          } finally {
              setIsLoadingSports(false);
          }
      };
      const timer = setTimeout(() => fetchSportsList(), 500);
      return () => clearTimeout(timer);
  }, [oddsApiKey]);

  const fetchLiveOdds = useCallback(async (force = false) => {
      if (!oddsApiKey) return;
      
      const now = Date.now();
      const cooldown = isTurboMode ? 2000 : REFRESH_COOLDOWN;
      if (!force && (now - lastFetchTimeRef.current < cooldown)) return;
      
      if (abortControllerRef.current) abortControllerRef.current.abort();
      abortControllerRef.current = new AbortController();

      try {
          setErrorMsg('');

          // 1. The-Odds-API Fetch
          const oddsPromise = fetch(`https://api.the-odds-api.com/v4/sports/${selectedSport}/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${oddsApiKey}`, {
              signal: abortControllerRef.current.signal
          }).then(res => res.json());

          // 2. Kalshi API Fetch (Proxy)
          const activeSportConfig = sportsList.find(s => s.key === selectedSport);
          const seriesTicker = activeSportConfig?.kalshiSeries || '';
          
          let kalshiUrl = `/api/kalshi/markets?limit=300&status=open`;
          if (seriesTicker) kalshiUrl += `&series_ticker=${seriesTicker}`;

          const kalshiPromise = fetch(kalshiUrl, {
              signal: abortControllerRef.current.signal,
              headers: { 'Accept': 'application/json' }
          }).then(async res => {
              if (!res.ok) throw new Error(`Kalshi Error: ${res.status}`);
              return res.json();
          }).then(data => data.markets || [])
            .catch(err => {
                console.warn("Kalshi Fetch Failed:", err);
                return []; 
            });

          const [oddsData, kalshiData] = await Promise.all([oddsPromise, kalshiPromise]);
          
          lastFetchTimeRef.current = Date.now();
          setLastUpdated(new Date());

          if (oddsData.message) throw new Error(oddsData.message);
          if (!Array.isArray(oddsData)) throw new Error("Unexpected API format");

          // Debug Sample
          if (kalshiData.length > 0) {
              setDebugLog(kalshiData.slice(0, 10).map(k => ({
                  title: k.title,
                  ticker: k.ticker,
                  yes_bid: k.yes_bid,
                  yes_ask: k.yes_ask
              })));
          }

          // 3. Merge & Match
          setMarkets(prevMarkets => {
              const processed = oddsData.slice(0, 15).map(game => {
                  const bookmaker = game.bookmakers?.[0];
                  if (!bookmaker) return null;
                  const markets = bookmaker.markets?.[0];
                  if (!markets?.outcomes) return null;

                  const outcome = markets.outcomes.find(o => o.price < 0) || markets.outcomes[0];
                  const prob = americanToProbability(outcome.price);
                  
                  const homeTeam = game.home_team;
                  const awayTeam = game.away_team;
                  const opponent = outcome.name === homeTeam ? awayTeam : homeTeam;
                  const eventName = `${outcome.name} to win vs ${opponent}`;

                  const realMatch = findKalshiMatch(homeTeam, awayTeam, game.commence_time, kalshiData, seriesTicker);
                  
                  const prev = prevMarkets.find(m => m.id === game.id);
                  const safeHistory = prev?.history || [];

                  return {
                      id: game.id,
                      event: eventName,
                      americanOdds: outcome.price,
                      impliedProb: prob,
                      bestBid: realMatch?.yes_bid || 0, 
                      bestAsk: realMatch?.yes_ask || 0, 
                      isMatchFound: !!realMatch,
                      realMarketId: realMatch?.ticker || null,
                      lastChange: Date.now(), // Simplified for refresh
                      history: [...safeHistory, { time: Date.now(), price: prob * 100 }].slice(-20)
                  };
              }).filter(Boolean);

              // Sort by Edge opportunities
              return processed.sort((a, b) => {
                  if (a.isMatchFound && !b.isMatchFound) return -1;
                  if (!a.isMatchFound && b.isMatchFound) return 1;
                  const edgeA = (a.impliedProb * 100) - a.bestBid;
                  const edgeB = (b.impliedProb * 100) - b.bestBid;
                  return edgeB - edgeA; 
              });
          });

      } catch (error) {
          if (error.name === 'AbortError') return;
          console.error("Fetch error", error);
          setErrorMsg(error.message || "Network error");
          if (error.message && error.message.toLowerCase().includes('quota')) setIsRunning(false);
      }
  }, [oddsApiKey, selectedSport, isTurboMode, sportsList]);

  // Loop
  useEffect(() => {
      let interval;
      if (isRunning) {
          fetchLiveOdds(); 
          const pollRate = isTurboMode ? 3000 : 120000; 
          interval = setInterval(() => fetchLiveOdds(false), pollRate); 
      }
      return () => clearInterval(interval);
  }, [isRunning, fetchLiveOdds, isTurboMode]);


  // --- Trading Logic ---

  const placeLiveOrder = (market, price) => {
    if (!market.realMarketId) return;

    const quantity = 100;
    const cost = price * quantity;
    if (balance < cost) { alert("Insufficient funds"); return; }

    // ---------------------------------------------------------
    // TODO: INSERT REAL KALSHI API POST REQUEST HERE
    // ---------------------------------------------------------
    // Example payload:
    // POST /trade-api/v2/portfolio/orders
    // {
    //   action: "buy",
    //   ticker: market.realMarketId,
    //   count: quantity,
    //   yes_price: price,
    //   side: "yes"
    // }

    console.log(`[MOCK EXECUTION] Placing Limit Buy: ${quantity} of ${market.realMarketId} @ ${price}¢`);

    setBalance(b => b - cost);
    setPositions(prev => [{
      id: `pos-${Date.now()}`,
      marketId: market.id,
      event: market.event,
      side: 'YES',
      quantity: quantity,
      avgEntryPrice: price,
      status: 'OPEN',
      timestamp: Date.now(),
      realMarketId: market.realMarketId
    }, ...prev]);
  };

  const closePosition = (position) => {
      // Simple exit simulation
      const market = markets.find(m => m.id === position.marketId);
      const currentPrice = (market && market.isMatchFound) ? market.bestBid : 0;
      if (!market || !market.isMatchFound) {
          if (!confirm("Market data missing. Close position at 0 value?")) return;
      }
      const profit = (currentPrice - position.avgEntryPrice) * position.quantity;
      setBalance(b => b + (currentPrice * position.quantity));
      setPositions(prev => prev.map(p => p.id === position.id ? { ...p, status: 'CLOSED', exitPrice: currentPrice, profit } : p));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <Header 
        balance={balance} 
        isRunning={isRunning} 
        setIsRunning={setIsRunning} 
        lastUpdated={lastUpdated} 
        isTurboMode={isTurboMode}
      />

      {errorMsg && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
            <AlertCircle size={20} />
            <span className="text-sm font-medium">{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left: Market Scanner */}
        <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h2 className="font-semibold text-slate-700 flex items-center gap-2">
                        <Activity size={16} className={isRunning ? "text-emerald-500" : "text-slate-400"}/>
                        Market Scanner
                        <span className="text-xs font-normal text-slate-400 ml-2">
                        ({sportsList.find(s => s.key === selectedSport)?.title || selectedSport})
                        </span>
                    </h2>
                    <button
                        onClick={() => setIsTurboMode(!isTurboMode)}
                        title={isTurboMode ? "Disable Turbo" : "Enable Turbo (High API Usage)"}
                        className={`p-1.5 rounded-md transition-all ${isTurboMode ? 'bg-purple-100 text-purple-600 ring-2 ring-purple-500' : 'bg-slate-100 text-slate-400 hover:text-slate-600'}`}
                    >
                        <Zap size={16} fill={isTurboMode ? "currentColor" : "none"}/>
                    </button>
                </div>
                
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-100">
                            <tr>
                                <th className="px-4 py-3 w-1/4">Event</th>
                                <th className="px-4 py-3 text-center">Implied<br/>Fair Value</th>
                                <th className="px-4 py-3 text-center bg-slate-100/50 border-x border-slate-100">Highest Bid</th>
                                <th className="px-4 py-3 text-right">Max Limit</th>
                                <th className="px-4 py-3 text-right">Smart Bid</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {markets.map(market => (
                                <MarketRow 
                                    key={market.id} 
                                    market={market} 
                                    marginPercent={marginPercent} 
                                    onExecute={placeLiveOrder} 
                                />
                            ))}
                        </tbody>
                    </table>
                    {markets.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">
                            {!oddsApiKey ? 'Enter API Keys to load live data.' : errorMsg || 'Loading markets...'}
                        </div>
                    )}
                </div>
            </div>

            {/* Debug Panel */}
            {debugLog.length > 0 && (
                <div className="bg-slate-900 rounded-xl shadow-sm p-4 text-slate-300 font-mono text-xs overflow-hidden">
                    <div className="flex items-center gap-2 mb-2 font-bold text-slate-100">
                        <Bug size={14} className="text-purple-400"/> Kalshi Raw Data Stream (First 10)
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            {debugLog.map(k => (
                                <div key={k.ticker} className="truncate hover:text-white">
                                    <span className="text-purple-400">{k.ticker}</span>: {k.title}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>

        {/* Right: Config & Portfolio */}
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

                    <div className="pt-2 border-t border-slate-100 mt-4">
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1"><Trophy size={12}/> Select Sport</span>
                            {isLoadingSports && <Loader2 size={12} className="animate-spin text-blue-500"/>}
                        </label>
                        <select 
                            value={selectedSport}
                            onChange={(e) => setSelectedSport(e.target.value)}
                            disabled={!oddsApiKey || isLoadingSports}
                            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 mb-4 disabled:opacity-50"
                        >
                            {sportsList.map(sport => (
                                <option key={sport.key} value={sport.key}>
                                    {sport.title}
                                </option>
                            ))}
                        </select>

                        <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">The-Odds-API Key</label>
                        <input 
                            type="password" 
                            placeholder="Paste API Key Here"
                            value={oddsApiKey}
                            onChange={(e) => setOddsApiKey(e.target.value)}
                            className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all mb-4"
                        />
                    </div>
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
                                <span className="font-bold text-slate-700 line-clamp-1 flex items-center gap-1">
                                    {pos.event}
                                    {pos.realMarketId && <LinkIcon size={10} className="text-emerald-500"/>}
                                </span>
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