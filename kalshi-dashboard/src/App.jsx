// File: src/App.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Settings, Play, Pause, RefreshCw, TrendingUp, DollarSign, AlertCircle, Briefcase, Activity, Trophy, Clock, Zap, Link as LinkIcon, Unlink, Bug, TrendingDown, Wallet, Upload, X, Check, Key, Lock, Loader2, Hash } from 'lucide-react';
import forge from 'node-forge'; // REQUIRED: npm install node-forge

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

// Standard UUID v4 Generator (With Hyphens)
const generateUUID = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

/**
 * STRICT MATCHER
 * Looks for a Kalshi ticker that matches the game AND specifically ends with the Target Team Abbreviation.
 * Example: "KXNFLGAME-25DEC07DENLV-DEN"
 */
const findKalshiMatch = (targetTeam, homeTeam, awayTeam, commenceTime, kalshiMarkets, seriesTicker) => {
    if (!kalshiMarkets || !homeTeam || !awayTeam || !targetTeam) return null;

    let datePart = "";
    const date = new Date(commenceTime);
    if (!isNaN(date.getTime())) {
        const yy = date.getFullYear().toString().slice(-2);
        const mmm = date.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        const dd = date.getDate().toString().padStart(2, '0');
        datePart = `${yy}${mmm}${dd}`;
    }

    // 1. Identify the Abbreviations
    const homeAbbr = TEAM_ABBR[homeTeam] || homeTeam.substring(0, 3).toUpperCase();
    const awayAbbr = TEAM_ABBR[awayTeam] || awayTeam.substring(0, 3).toUpperCase();
    const targetAbbr = TEAM_ABBR[targetTeam] || targetTeam.substring(0, 3).toUpperCase();

    // 2. Scan Markets for the specific outcome
    return kalshiMarkets.find(k => {
        const ticker = k.ticker ? k.ticker.toUpperCase() : '';
        
        // Level 1: Must belong to the correct Series (if provided)
        if (seriesTicker && !ticker.startsWith(seriesTicker)) return false;

        // Level 2: Must contain the Date (high confidence)
        if (datePart && !ticker.includes(datePart)) return false;

        // Level 3: Must contain BOTH teams (ensure we have the right game)
        // Note: Kalshi usually puts AWAY then HOME (e.g. DENLV for Denver @ Vegas)
        const hasTeams = (ticker.includes(homeAbbr) && ticker.includes(awayAbbr));
        if (!hasTeams) return false;

        // Level 4: MUST end with the Target Team (The "YES" condition)
        // e.g. Ticker must end with "-DEN" if we want Denver to win
        const targetSuffix = `-${targetAbbr}`;
        return ticker.endsWith(targetSuffix);
    });
};

const calculateStrategy = (market, marginPercent) => {
    if (!market.isMatchFound) return { smartBid: null, reason: "No Market", edge: 0 };

    const fairValue = Math.floor(market.impliedProb * 100);
    const maxWillingToPay = Math.floor(fairValue * (1 - marginPercent / 100));
    const currentBestBid = market.bestBid || 0;
    const edge = fairValue - currentBestBid;

    let smartBid = 0;
    let reason = "";

    if (currentBestBid >= maxWillingToPay) {
        smartBid = maxWillingToPay;
        reason = "Max Limit";
    } else {
        smartBid = currentBestBid + 1;
        reason = "Beat Market (+1)";
    }

    return { smartBid, maxWillingToPay, edge, reason };
};

// --- CRYPTOGRAPHIC SIGNING ENGINE ---
const signRequest = (privateKeyPem, method, path, timestamp) => {
    try {
        const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
        const md = forge.md.sha256.create();
        
        // Note: The path MUST exclude query params for signing
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

const ConnectModal = ({ isOpen, onClose, onConnect }) => {
    const [keyId, setKeyId] = useState('');
    const [privateKey, setPrivateKey] = useState('');
    const [fileName, setFileName] = useState('');

    if (!isOpen) return null;

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = (event) => {
            setPrivateKey(event.target.result);
        };
        reader.readAsText(file);
    };

    const handleSave = () => {
        if (!keyId || !privateKey) {
            alert("Please provide both Key ID and Private Key file.");
            return;
        }
        onConnect({ keyId, privateKey });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-4 animate-in fade-in zoom-in duration-200">
                <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                    <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
                        <Wallet className="text-blue-600" /> Connect Kalshi Wallet
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5">
                    <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 text-xs text-blue-800">
                        <strong>Security Note:</strong> Your keys are stored locally in your browser's memory. 
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                            API Key ID
                        </label>
                        <div className="relative">
                            <Key className="absolute left-3 top-2.5 text-slate-400" size={16} />
                            <input 
                                type="text" 
                                value={keyId}
                                onChange={(e) => setKeyId(e.target.value)}
                                placeholder="e.g. a952bcbe-ec3b-4b5b..."
                                className="w-full pl-10 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                            Private Key File (.key)
                        </label>
                        <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors cursor-pointer relative">
                            <input 
                                type="file" 
                                onChange={handleFileUpload}
                                accept=".key,.pem,.txt"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                            />
                            {fileName ? (
                                <div className="flex items-center gap-2 text-emerald-600 font-medium text-sm">
                                    <Check size={18} /> {fileName}
                                </div>
                            ) : (
                                <>
                                    <Upload className="text-slate-400 mb-2" size={24} />
                                    <span className="text-sm text-slate-500">Click to upload <strong>kalshi-key.key</strong></span>
                                </>
                            )}
                        </div>
                    </div>

                    <button 
                        onClick={handleSave}
                        className="w-full bg-slate-900 hover:bg-blue-600 text-white font-bold py-3 rounded-lg transition-all active:scale-[0.98] shadow-md flex items-center justify-center gap-2"
                    >
                        <Lock size={16} /> Securely Connect
                    </button>
                </div>
            </div>
        </div>
    );
};

const Header = ({ balance, isRunning, setIsRunning, lastUpdated, isTurboMode, onOpenWallet, walletConnected }) => (
    <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="text-blue-600" />
                Kalshi ArbBot
            </h1>
            <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-green-100 text-green-700 border-green-200">LIVE MARKET DATA</span>
                {lastUpdated && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-200"><Clock size={10} /> {lastUpdated.toLocaleTimeString()}</span>}
                {isTurboMode && <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border bg-purple-100 text-purple-700 border-purple-200 animate-pulse"><Zap size={10} fill="currentColor"/> TURBO</span>}
            </div>
        </div>
        <div className="flex items-center gap-3">
            <button onClick={onOpenWallet} className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${walletConnected ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'}`}>
                {walletConnected ? <Check size={16} /> : <Wallet size={16} />}
                <span className="font-medium text-sm">{walletConnected ? "Wallet Active" : "Connect Wallet"}</span>
            </button>
            <div className="bg-slate-100 px-4 py-2 rounded-lg border border-slate-200 flex items-center gap-2 min-w-[100px] justify-end">
                <DollarSign size={16} className={`transition-colors ${walletConnected ? 'text-emerald-600' : 'text-slate-400'}`}/>
                <span className="font-mono font-bold text-lg text-slate-700">{walletConnected && balance !== null ? (balance / 100).toFixed(2) : '-'}</span>
            </div>
            <button onClick={() => setIsRunning(!isRunning)} className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white transition-all shadow-sm active:scale-95 ${isRunning ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>{isRunning ? <><Pause size={18}/> Pause</> : <><Play size={18}/> Start Engine</>}</button>
        </div>
    </header>
);

const MarketRow = ({ market, onExecute, marginPercent, tradeSize }) => {
    const fairValue = Math.floor(market.impliedProb * 100);
    const { smartBid, maxWillingToPay, reason, edge } = calculateStrategy(market, marginPercent);
    const isFlash = Date.now() - market.lastChange < 1500; 

    return (
        <tr className={`transition-all duration-500 group ${isFlash ? 'bg-yellow-50' : 'hover:bg-blue-50/30'}`}>
            <td className="px-4 py-3 font-medium text-slate-700">
                <div className="flex flex-col">
                    <span>{market.event}</span>
                    <div className="flex items-center gap-1 mt-1">
                        {market.isMatchFound ? <span className="flex items-center gap-1 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded"><LinkIcon size={10} /> Live Match</span> : <span className="flex items-center gap-1 text-[9px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded"><Unlink size={10} /> No Market</span>}
                        <span className="text-[10px] text-slate-400 font-mono">Odds: {market.americanOdds > 0 ? `+${market.americanOdds}` : market.americanOdds}</span>
                    </div>
                </div>
            </td>
            <td className={`px-4 py-3 text-center font-bold transition-colors duration-300 ${isFlash ? 'text-blue-600' : 'text-slate-700'}`}>{fairValue}¢</td>
            <td className={`px-4 py-3 text-center border-x border-slate-100 font-mono text-slate-500 bg-slate-50/50`}>{market.isMatchFound ? `${market.bestBid}¢` : '-'}</td>
            <td className="px-4 py-3 text-right text-slate-400">{market.isMatchFound ? `${maxWillingToPay}¢` : '-'}</td>
            <td className="px-4 py-3 text-right">
                {market.isMatchFound ? (
                    <><div className="flex flex-col items-end"><div className={`font-bold font-mono text-base transition-colors ${isFlash ? 'text-purple-600 scale-110' : 'text-emerald-600'}`}>{smartBid}¢</div>{edge > 0 && <span className="text-[9px] bg-emerald-50 text-emerald-600 px-1 rounded flex items-center gap-0.5"><TrendingDown size={8} className="rotate-180"/> +{edge}¢ Edge</span>}</div><div className="text-[9px] uppercase tracking-wide text-slate-400 font-bold mt-0.5">{reason}</div></>
                ) : <span className="text-slate-300">-</span>}
            </td>
            <td className="px-4 py-3 text-center">
                <button 
                    onClick={() => onExecute(market, smartBid)} 
                    disabled={!market.isMatchFound} 
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm ${market.isMatchFound ? 'bg-slate-900 hover:bg-blue-600 text-white active:scale-95' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`}
                >
                    {market.isMatchFound ? `Bid ${smartBid}¢ (${tradeSize})` : 'No Market'}
                </button>
            </td>
        </tr>
    );
};

// ==========================================
// 4. MAIN APP COMPONENT
// ==========================================

const KalshiDashboard = () => {
  const [markets, setMarkets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [balance, setBalance] = useState(null); 
  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState(''); 
  const [lastUpdated, setLastUpdated] = useState(null);
  const [debugLog, setDebugLog] = useState([]); 
  
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [walletKeys, setWalletKeys] = useState(null);

  const [marginPercent, setMarginPercent] = useState(15); 
  const [tradeSize, setTradeSize] = useState(10);
  const [oddsApiKey, setOddsApiKey] = useState('');
  const [selectedSport, setSelectedSport] = useState('americanfootball_nfl'); 
  const [isTurboMode, setIsTurboMode] = useState(false); 
  
  const [sportsList, setSportsList] = useState(SPORT_MAPPING);
  const [isLoadingSports, setIsLoadingSports] = useState(false);

  const lastFetchTimeRef = useRef(0);
  const abortControllerRef = useRef(null);

  useEffect(() => {
      const storedKeys = localStorage.getItem('kalshi_keys');
      if (storedKeys) setWalletKeys(JSON.parse(storedKeys));
      
      const storedOddsKey = localStorage.getItem('odds_api_key');
      if (storedOddsKey) setOddsApiKey(storedOddsKey);
  }, []);

  // --- Portfolio & Balance Fetching ---
  const fetchPortfolio = useCallback(async () => {
      if (!walletKeys) return;
      try {
          const timestamp = Date.now();
          const balancePath = '/trade-api/v2/portfolio/balance';
          const balanceSig = signRequest(walletKeys.privateKey, "GET", balancePath, timestamp);
          
          const ordersPath = '/trade-api/v2/portfolio/orders';
          const ordersSig = signRequest(walletKeys.privateKey, "GET", ordersPath, timestamp);

          const positionsPath = '/trade-api/v2/portfolio/positions';
          const positionsSig = signRequest(walletKeys.privateKey, "GET", positionsPath, timestamp);

          const [balRes, ordersRes, posRes] = await Promise.all([
              fetch(`/api/kalshi/portfolio/balance`, { headers: { 'KALSHI-ACCESS-KEY': walletKeys.keyId, 'KALSHI-ACCESS-SIGNATURE': balanceSig, 'KALSHI-ACCESS-TIMESTAMP': timestamp.toString() } }),
              fetch(`/api/kalshi/portfolio/orders`, { headers: { 'KALSHI-ACCESS-KEY': walletKeys.keyId, 'KALSHI-ACCESS-SIGNATURE': ordersSig, 'KALSHI-ACCESS-TIMESTAMP': timestamp.toString() } }),
              fetch(`/api/kalshi/portfolio/positions`, { headers: { 'KALSHI-ACCESS-KEY': walletKeys.keyId, 'KALSHI-ACCESS-SIGNATURE': positionsSig, 'KALSHI-ACCESS-TIMESTAMP': timestamp.toString() } })
          ]);

          const balData = await balRes.json();
          const ordersData = await ordersRes.json();
          const posData = await posRes.json();

          if (balData.balance) setBalance(balData.balance);

          // Merge Orders and Positions into unified view
          const mappedOrders = (ordersData.orders || []).map(o => ({
              id: o.order_id,
              marketId: o.ticker,
              event: o.ticker, // Simplified
              side: o.side.toUpperCase(),
              quantity: o.count,
              avgEntryPrice: o.yes_price, 
              status: o.status.toUpperCase(), // 'active' -> 'OPEN'
              timestamp: new Date(o.created_time).getTime(),
              isOrder: true
          }));

          const mappedPositions = (posData.positions || []).map(p => ({
              id: p.ticker,
              marketId: p.ticker,
              event: p.event_ticker,
              side: 'YES', // Kalshi positions are usually long
              quantity: p.position,
              avgEntryPrice: p.fees_paid, // Approximate cost basis
              status: 'FILLED',
              timestamp: Date.now(),
              isOrder: false
          }));

          setPositions([...mappedOrders, ...mappedPositions]);

      } catch (e) {
          console.error("Portfolio fetch failed:", e);
      }
  }, [walletKeys]);

  useEffect(() => {
      if (walletKeys) {
          fetchPortfolio();
          // Poll portfolio every 10s
          const interval = setInterval(fetchPortfolio, 10000);
          return () => clearInterval(interval);
      }
  }, [walletKeys, fetchPortfolio]);

  const handleConnectWallet = (keys) => {
      setWalletKeys(keys);
      localStorage.setItem('kalshi_keys', JSON.stringify(keys));
  };

  useEffect(() => {
      const fetchSportsList = async () => {
          if (!oddsApiKey || oddsApiKey.length < 10) return;
          setIsLoadingSports(true);
          try {
              const response = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${oddsApiKey}`);
              const data = await response.json();
              if (Array.isArray(data)) {
                  const mergedSports = data.filter(s => s.key && s.title).map(s => {
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
          const oddsPromise = fetch(`https://api.the-odds-api.com/v4/sports/${selectedSport}/odds/?regions=us&markets=h2h&oddsFormat=american&apiKey=${oddsApiKey}`, { signal: abortControllerRef.current.signal }).then(res => res.json());

          const activeSportConfig = sportsList.find(s => s.key === selectedSport);
          const seriesTicker = activeSportConfig?.kalshiSeries || '';
          let kalshiUrl = `/api/kalshi/markets?limit=300&status=open`;
          if (seriesTicker) kalshiUrl += `&series_ticker=${seriesTicker}`;

          const kalshiPromise = fetch(kalshiUrl, { signal: abortControllerRef.current.signal, headers: { 'Accept': 'application/json' } }).then(async res => {
              if (!res.ok) throw new Error(`Kalshi Error: ${res.status}`);
              return res.json();
          }).then(data => data.markets || []).catch(err => { console.warn("Kalshi Fetch Failed:", err); return []; });

          const [oddsData, kalshiData] = await Promise.all([oddsPromise, kalshiPromise]);
          lastFetchTimeRef.current = Date.now();
          setLastUpdated(new Date());

          if (oddsData.message) throw new Error(oddsData.message);
          if (!Array.isArray(oddsData)) throw new Error("Unexpected API format");

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
                  const realMatch = findKalshiMatch(outcome.name, homeTeam, awayTeam, game.commence_time, kalshiData, seriesTicker);
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
                      lastChange: Date.now(), 
                      history: [...safeHistory, { time: Date.now(), price: prob * 100 }].slice(-20)
                  };
              }).filter(Boolean);

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

  useEffect(() => {
      let interval;
      if (isRunning) {
          fetchLiveOdds(); 
          const pollRate = isTurboMode ? 3000 : 120000; 
          interval = setInterval(() => fetchLiveOdds(false), pollRate); 
      }
      return () => clearInterval(interval);
  }, [isRunning, fetchLiveOdds, isTurboMode]);

  const placeLiveOrder = async (market, price) => {
    if (!market.realMarketId) return;
    if (!walletKeys) { setIsWalletOpen(true); return; }

    const quantity = parseInt(tradeSize);
    const cost = price * quantity;
    if (balance !== null && balance < cost) { alert("Insufficient funds"); return; }

    try {
        const path = '/trade-api/v2/portfolio/orders';
        const timestamp = Date.now();
        const method = "POST";
        
        // STRICT PAYLOAD CONSTRUCITON
        const orderData = {
            action: "buy",
            ticker: market.realMarketId.trim().toUpperCase().replace(/[^A-Z0-9-]/g, ''),
            count: Math.floor(quantity),
            yes_price: Math.floor(price),
            side: "yes",
            type: "limit",
            client_order_id: generateUUID() // Standard UUID v4
        };

        // DEBUG: Print exact payload for verification
        console.group("🚀 ATTEMPTING LIVE ORDER");
        console.log("URL:", `/api/kalshi${path}`);
        console.log("PAYLOAD:", JSON.stringify(orderData, null, 2));
        console.groupEnd();

        const signature = signRequest(walletKeys.privateKey, method, path, timestamp);
        
        const response = await fetch(`/api/kalshi/portfolio/orders`, {
            method: method,
            headers: { 
                'Content-Type': 'application/json', 
                'KALSHI-ACCESS-KEY': walletKeys.keyId, 
                'KALSHI-ACCESS-SIGNATURE': signature, 
                'KALSHI-ACCESS-TIMESTAMP': timestamp.toString() 
            },
            body: JSON.stringify(orderData)
        });
        const result = await response.json();
        
        if (!response.ok) {
            console.error("FULL API ERROR RESPONSE:", JSON.stringify(result, null, 2));
            let msg = result.message || "Unknown Error";
            if (result.error) {
                msg = `${result.error.code || 'Error'}: ${result.error.message || JSON.stringify(result.error)}`;
            }
            if (result.details) msg += ` | Details: ${JSON.stringify(result.details)}`;
            throw new Error(msg);
        }
        
        console.log(`[SUCCESS] Order Placed: ${result.order_id}`);
        fetchPortfolio(); 

    } catch (err) {
        console.error("Order Exception:", err);
        alert(`Order Failed: ${err.message}`);
    }
  };

  const closePosition = (position) => {
      // Placeholder for cancel order logic
      alert("Cancel logic not yet implemented. Use Kalshi app.");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-4 md:p-8">
      <Header 
        balance={balance} 
        isRunning={isRunning} 
        setIsRunning={setIsRunning} 
        lastUpdated={lastUpdated} 
        isTurboMode={isTurboMode}
        onOpenWallet={() => setIsWalletOpen(true)}
        walletConnected={!!walletKeys}
      />
      <ConnectModal isOpen={isWalletOpen} onClose={() => setIsWalletOpen(false)} onConnect={handleConnectWallet} />
      {errorMsg && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700"><AlertCircle size={20} /><span className="text-sm font-medium">{errorMsg}</span></div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h2 className="font-semibold text-slate-700 flex items-center gap-2"><Activity size={16} className={isRunning ? "text-emerald-500" : "text-slate-400"}/> Market Scanner <span className="text-xs font-normal text-slate-400 ml-2">({sportsList.find(s => s.key === selectedSport)?.title || selectedSport})</span></h2>
                    <button onClick={() => setIsTurboMode(!isTurboMode)} title={isTurboMode ? "Disable Turbo" : "Enable Turbo"} className={`p-1.5 rounded-md transition-all ${isTurboMode ? 'bg-purple-100 text-purple-600 ring-2 ring-purple-500' : 'bg-slate-100 text-slate-400 hover:text-slate-600'}`}><Zap size={16} fill={isTurboMode ? "currentColor" : "none"}/></button>
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
                            {markets.map(market => <MarketRow key={market.id} market={market} marginPercent={marginPercent} tradeSize={tradeSize} onExecute={placeLiveOrder} />)}
                        </tbody>
                    </table>
                    {markets.length === 0 && <div className="p-8 text-center text-slate-400 text-sm">{!oddsApiKey ? 'Enter API Keys to load live data.' : errorMsg || 'Loading markets...'}</div>}
                </div>
            </div>
            {debugLog.length > 0 && <div className="bg-slate-900 rounded-xl shadow-sm p-4 text-slate-300 font-mono text-xs overflow-hidden"><div className="flex items-center gap-2 mb-2 font-bold text-slate-100"><Bug size={14} className="text-purple-400"/> Kalshi Raw Data Stream (First 10)</div><div className="grid grid-cols-2 gap-4"><div className="space-y-1">{debugLog.map(k => <div key={k.ticker} className="truncate hover:text-white"><span className="text-purple-400">{k.ticker}</span>: {k.title}</div>)}</div></div></div>}
        </div>

        <div className="space-y-6">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center gap-2 mb-4 text-slate-800 font-bold text-sm uppercase tracking-wider border-b border-slate-100 pb-2"><Settings size={16} /> Strategy Config</div>
                <div className="space-y-5">
                    <div><div className="flex justify-between text-sm font-medium text-slate-600 mb-2"><span>Margin Target</span><span className="text-blue-600 font-bold">{marginPercent}%</span></div><input type="range" min="5" max="30" value={marginPercent} onChange={(e) => setMarginPercent(parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600" /></div>
                    <div>
                         <label className="flex justify-between text-sm font-medium text-slate-600 mb-2">
                            Trade Size (Contracts) <span className="text-blue-600 font-bold">{tradeSize}</span>
                        </label>
                        <div className="flex items-center gap-2">
                            <Hash size={16} className="text-slate-400"/>
                            <input 
                                type="number" 
                                min="1" 
                                max="1000" 
                                value={tradeSize} 
                                onChange={(e) => setTradeSize(Math.max(1, parseInt(e.target.value) || 1))}
                                className="w-full p-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Number of YES contracts to buy per order.</p>
                    </div>
                    <div className="pt-2 border-t border-slate-100 mt-4"><label className="text-xs font-bold text-slate-400 uppercase mb-2 block flex items-center justify-between gap-1"><span className="flex items-center gap-1"><Trophy size={12}/> Select Sport</span>{isLoadingSports && <Loader2 size={12} className="animate-spin text-blue-500"/>}</label><select value={selectedSport} onChange={(e) => setSelectedSport(e.target.value)} disabled={!oddsApiKey || isLoadingSports} className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 mb-4 disabled:opacity-50">{sportsList.map(sport => <option key={sport.key} value={sport.key}>{sport.title}</option>)}</select><label className="text-xs font-bold text-slate-400 uppercase mb-1 block">The-Odds-API Key</label><input type="password" placeholder="Paste API Key Here" value={oddsApiKey} onChange={(e) => { setOddsApiKey(e.target.value); localStorage.setItem('odds_api_key', e.target.value); }} className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all mb-4" /></div>
                </div>
            </div>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 flex-1">
                 <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2"><div className="flex items-center gap-2 text-slate-800 font-bold text-sm uppercase tracking-wider"><Briefcase size={16} /> Portfolio</div><span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-500">{positions.filter(p => p.status === 'active' || p.status === 'open' || p.status === 'FILLED').length} Items</span></div>
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                    {positions.length === 0 && <div className="text-center py-10 text-slate-400 text-xs italic">No active positions.</div>}
                    {[...positions].reverse().map(pos => (
                        <div key={pos.id} className={`p-3 rounded-lg border text-sm transition-all ${pos.status === 'FILLED' ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-blue-100 shadow-sm hover:shadow-md'}`}>
                            <div className="flex justify-between items-start mb-2"><span className="font-bold text-slate-700 line-clamp-1 flex items-center gap-1">{pos.event}</span><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.status === 'FILLED' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{pos.isOrder ? 'BIDDING' : 'HELD'}</span></div>
                            <div className="flex justify-between items-end text-xs text-slate-500"><div><div>Price: <span className="font-mono font-bold text-slate-700">{pos.avgEntryPrice}¢</span></div><div>Qty: {pos.quantity}</div></div><button onClick={() => closePosition(pos)} className="text-[10px] font-bold text-rose-500 hover:text-rose-700 hover:underline">Close</button></div>
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