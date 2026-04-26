/* ══════════════════════════════════════════════════════════════
   CRYPTEX — MARKET INTELLIGENCE TERMINAL
   main.js
════════════════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIG ─────────────────────────────────────────────────── */
const CFG = {
  BINANCE_FAPI : 'https://fapi.binance.com/fapi/v1',
  BYBIT_API    : 'https://api.bybit.com/v5/market',
  GECKO_API    : 'https://api.coingecko.com/api/v3',
  KLINE_LIMIT  : 750,   // candles to fetch for calculations (750 = ~31 days on 1H, well within Binance 1500 limit)
  FETCH_TIMEOUT: 8000,  // ms per request
};

/* Binance → Bybit interval mapping */
const TF_MAP = {
  binance: { '5m':'5m', '15m':'15m', '30m':'30m', '1h':'1h', '4h':'4h', '1d':'1d', '1w':'1w' },
  bybit:   { '5m':'5',  '15m':'15',  '30m':'30',  '1h':'60', '4h':'240','1d':'D',  '1w':'W'  },
};

// HTF confirmation: each entry TF maps to one level higher for structure bias
const HTF_MAP = {
  '5m':'15m', '15m':'1h', '30m':'4h',
  '1h':'4h',  '4h':'1d',  '1d':'1w', '1w':'1w',
};

/* CoinGecko slug lookup for common tickers */
const GECKO_IDS = {
  BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', SOL:'solana',
  XRP:'ripple',  ADA:'cardano',  DOGE:'dogecoin',   AVAX:'avalanche-2',
  DOT:'polkadot',MATIC:'matic-network',LINK:'chainlink',LTC:'litecoin',
  UNI:'uniswap', ATOM:'cosmos',  TRX:'tron',        NEAR:'near',
  APT:'aptos',   ARB:'arbitrum', OP:'optimism',     INJ:'injective-protocol',
  SUI:'sui',     FTM:'fantom',   SAND:'the-sandbox', MANA:'decentraland',
  CRV:'curve-dao-token', AAVE:'aave', MKR:'maker',  SNX:'synthetix-network-token',
  FIL:'filecoin',ICP:'internet-computer',HBAR:'hedera-hashgraph',
  VET:'vechain', ALGO:'algorand',XLM:'stellar',     EOS:'eos',
  THETA:'theta-token',XMR:'monero',ZEC:'zcash',DASH:'dash',
};

/* ── STATE ──────────────────────────────────────────────────── */
const STATE = {
  singleTf          : '1h',
  scannerTf         : '1h',
  scannerSource     : 'binance',
  scannerData       : [],
  scannerCategory   : 'gainers',
  fundingInterval   : null,
  currentPrice      : 0,
  smcCoinTf         : '1h',
  smcScanTf         : '1h',
  smcScanSource     : 'binance',
  smcScanResults    : [],
  smcScanInterval   : null,
};

/* ── UTILITY ────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════
   SOUND ENGINE — Web Audio API (no CDN needed, procedural)
══════════════════════════════════════════════════════════════ */
const SFX = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function play(type) {
    try {
      const c = getCtx();
      const now = c.currentTime;

      if (type === 'scan_start') {
        // Rising sweep — scan initiating
        [220, 330, 440, 660].forEach((f, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.type = 'sine'; o.frequency.setValueAtTime(f, now + i * 0.08);
          g.gain.setValueAtTime(0, now + i * 0.08);
          g.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.04);
          g.gain.linearRampToValueAtTime(0, now + i * 0.08 + 0.12);
          o.start(now + i * 0.08); o.stop(now + i * 0.08 + 0.15);
        });
      }

      else if (type === 'scan_complete') {
        // Triple chime — scan done
        [523, 659, 784].forEach((f, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.type = 'triangle'; o.frequency.setValueAtTime(f, now + i * 0.18);
          g.gain.setValueAtTime(0.15, now + i * 0.18);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.5);
          o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.55);
        });
      }

      else if (type === 'fetch_start') {
        // Short click — fetch initiated
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'square'; o.frequency.setValueAtTime(800, now);
        o.frequency.linearRampToValueAtTime(400, now + 0.06);
        g.gain.setValueAtTime(0.08, now);
        g.gain.linearRampToValueAtTime(0, now + 0.08);
        o.start(now); o.stop(now + 0.1);
      }

      else if (type === 'fetch_complete') {
        // Soft confirm
        [440, 550].forEach((f, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.type = 'sine'; o.frequency.setValueAtTime(f, now + i * 0.1);
          g.gain.setValueAtTime(0.1, now + i * 0.1);
          g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
          o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.35);
        });
      }

      else if (type === 'tile_click') {
        // Quick tap
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.setValueAtTime(600, now);
        g.gain.setValueAtTime(0.07, now);
        g.gain.linearRampToValueAtTime(0, now + 0.08);
        o.start(now); o.stop(now + 0.1);
      }

      else if (type === 'drawer_open') {
        // Slide whoosh
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(200, now);
        o.frequency.exponentialRampToValueAtTime(500, now + 0.15);
        g.gain.setValueAtTime(0.08, now);
        g.gain.linearRampToValueAtTime(0, now + 0.2);
        o.start(now); o.stop(now + 0.22);
      }

      else if (type === 'drawer_close') {
        // Reverse whoosh
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(500, now);
        o.frequency.exponentialRampToValueAtTime(200, now + 0.12);
        g.gain.setValueAtTime(0.06, now);
        g.gain.linearRampToValueAtTime(0, now + 0.15);
        o.start(now); o.stop(now + 0.18);
      }

      else if (type === 'copy') {
        // Success double blip
        [700, 900].forEach((f, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.type = 'sine'; o.frequency.setValueAtTime(f, now + i * 0.09);
          g.gain.setValueAtTime(0.09, now + i * 0.09);
          g.gain.linearRampToValueAtTime(0, now + i * 0.09 + 0.1);
          o.start(now + i * 0.09); o.stop(now + i * 0.09 + 0.12);
        });
      }

      else if (type === 'tab_switch') {
        // Soft click
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.setValueAtTime(350, now);
        g.gain.setValueAtTime(0.05, now);
        g.gain.linearRampToValueAtTime(0, now + 0.06);
        o.start(now); o.stop(now + 0.08);
      }

      else if (type === 'filter_click') {
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.setValueAtTime(480, now);
        g.gain.setValueAtTime(0.05, now);
        g.gain.linearRampToValueAtTime(0, now + 0.05);
        o.start(now); o.stop(now + 0.07);
      }

      else if (type === 'error') {
        // Descending double buzz
        [300, 200].forEach((f, i) => {
          const o = c.createOscillator();
          const g = c.createGain();
          o.connect(g); g.connect(c.destination);
          o.type = 'sawtooth'; o.frequency.setValueAtTime(f, now + i * 0.12);
          g.gain.setValueAtTime(0.07, now + i * 0.12);
          g.gain.linearRampToValueAtTime(0, now + i * 0.12 + 0.1);
          o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.12);
        });
      }

    } catch(e) { /* Audio not supported — fail silently */ }
  }

  return { play };
})();

function fPrice(n, decimals = null) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const d = decimals !== null ? decimals
    : abs >= 10000 ? 0
    : abs >= 100   ? 1
    : abs >= 1     ? 2
    : abs >= 0.1   ? 4
    : 6;
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fNum(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return Number(n).toLocaleString('en-US');
}

function fPct(n, digits = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + Number(n).toFixed(digits) + '%';
}

function fRate(n) {
  if (n == null || isNaN(n)) return '—';
  return (Number(n) * 100).toFixed(4) + '%';
}

function pctClass(n) {
  if (n == null || isNaN(n)) return '';
  return n >= 0 ? 'bull' : 'bear';
}

function setPct(id, val) {
  const el = $(id);
  if (!el) return;
  el.textContent = fPct(val);
  el.className = 'pc-value ' + pctClass(val);
}

function setTfcPct(id, val) {
  const el = $(id);
  if (!el) return;
  el.textContent = fPct(val);
  el.className = 'tfc-value ' + pctClass(val);
}

function fetchWithTimeout(url, ms = CFG.FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

function nowStr() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/* ── CLOCK ──────────────────────────────────────────────────── */
function startClock() {
  const el = $('header-time');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('en-US', { hour12: false }); };
  tick();
  setInterval(tick, 1000);
}

/* ── STATUS ─────────────────────────────────────────────────── */
function setStatus(type, text) {
  const dot  = $('status-dot');
  const stxt = $('status-text');
  dot.className  = 'status-dot ' + (type === 'ok' ? '' : type);
  stxt.textContent = text;
}

/* ── TAB SWITCHING ──────────────────────────────────────────── */
function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      SFX.play('tab_switch');
    });
  });
}

/* ── TIMEFRAME SELECTORS ────────────────────────────────────── */
function initTfSelectors() {
  document.querySelectorAll('#tf-selector-single .tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tf-selector-single .tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.singleTf = btn.dataset.tf;
    });
  });

  document.querySelectorAll('#tf-selector-scanner .tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tf-selector-scanner .tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.scannerTf = btn.dataset.tf;
    });
  });
}

/* ── SOURCE TOGGLE (Scanner) ────────────────────────────────── */
function initSourceToggle() {
  document.querySelectorAll('.src-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.src-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.scannerSource = btn.dataset.src;
    });
  });
}

/* ── SCANNER CATEGORY TABS ──────────────────────────────────── */
function initScannerTabs() {
  document.querySelectorAll('.scanner-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scanner-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.scannerCategory = btn.dataset.category;
      renderScannerCategory();
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   API LAYER
══════════════════════════════════════════════════════════════ */

/* ── BINANCE: single coin ───────────────────────────────────── */
async function fetchBinance(symbol) {
  const [t24, prem, oi, fr] = await Promise.allSettled([
    fetchWithTimeout(`${CFG.BINANCE_FAPI}/ticker/24hr?symbol=${symbol}`).then(r => r.json()),
    fetchWithTimeout(`${CFG.BINANCE_FAPI}/premiumIndex?symbol=${symbol}`).then(r => r.json()),
    fetchWithTimeout(`${CFG.BINANCE_FAPI}/openInterest?symbol=${symbol}`).then(r => r.json()),
    fetchWithTimeout(`${CFG.BINANCE_FAPI}/fundingRate?symbol=${symbol}&limit=1`).then(r => r.json()),
  ]);

  const ticker = t24.status === 'fulfilled' ? t24.value : null;
  if (!ticker || ticker.code) throw new Error('Binance ticker failed');

  return {
    source      : 'BINANCE',
    symbol,
    lastPrice   : parseFloat(ticker.lastPrice),
    priceChange : parseFloat(ticker.priceChange),
    changePct24h: parseFloat(ticker.priceChangePercent),
    weightedAvg : parseFloat(ticker.weightedAvgPrice),
    openPrice   : parseFloat(ticker.openPrice),
    high24h     : parseFloat(ticker.highPrice),
    low24h      : parseFloat(ticker.lowPrice),
    volume      : parseFloat(ticker.volume),
    quoteVolume : parseFloat(ticker.quoteVolume),
    tradeCount  : ticker.count,
    markPrice   : prem.status === 'fulfilled' ? parseFloat(prem.value.markPrice)  : null,
    indexPrice  : prem.status === 'fulfilled' ? parseFloat(prem.value.indexPrice) : null,
    fundingRate : prem.status === 'fulfilled' ? parseFloat(prem.value.lastFundingRate) : null,
    interestRate: prem.status === 'fulfilled' ? parseFloat(prem.value.interestRate)    : null,
    nextFunding : prem.status === 'fulfilled' ? parseInt(prem.value.nextFundingTime)   : null,
    openInterest: oi.status  === 'fulfilled' ? parseFloat(oi.value.openInterest)       : null,
    oiValue     : null,
    turnover24h : null,
    fundingInterval: 8,
    lastFundingRate: fr.status === 'fulfilled' && fr.value[0] ? parseFloat(fr.value[0].fundingRate) : null,
    bid1Price   : null, ask1Price: null, bid1Size: null, ask1Size: null,
    bids: [], asks: [],
  };
}

/* ── BYBIT: single coin ─────────────────────────────────────── */
async function fetchBybit(symbol) {
  const [tk, ob, fr] = await Promise.allSettled([
    fetchWithTimeout(`${CFG.BYBIT_API}/tickers?category=linear&symbol=${symbol}`).then(r => r.json()),
    fetchWithTimeout(`${CFG.BYBIT_API}/orderbook?category=linear&symbol=${symbol}&limit=5`).then(r => r.json()),
    fetchWithTimeout(`${CFG.BYBIT_API}/funding/history?category=linear&symbol=${symbol}&limit=1`).then(r => r.json()),
  ]);

  if (tk.status !== 'fulfilled' || tk.value.retCode !== 0 || !tk.value.result.list.length)
    throw new Error('Bybit ticker failed');

  const t = tk.value.result.list[0];
  const book = ob.status === 'fulfilled' && ob.value.retCode === 0 ? ob.value.result : null;

  return {
    source      : 'BYBIT',
    symbol,
    lastPrice   : parseFloat(t.lastPrice),
    priceChange : parseFloat(t.lastPrice) - parseFloat(t.prevPrice24h),
    changePct24h: parseFloat(t.price24hPcnt) * 100,
    weightedAvg : null,
    openPrice   : parseFloat(t.prevPrice24h),
    high24h     : parseFloat(t.highPrice24h),
    low24h      : parseFloat(t.lowPrice24h),
    volume      : parseFloat(t.volume24h),
    quoteVolume : parseFloat(t.turnover24h),
    tradeCount  : null,
    markPrice   : parseFloat(t.markPrice),
    indexPrice  : parseFloat(t.indexPrice),
    fundingRate : parseFloat(t.fundingRate),
    interestRate: null,
    nextFunding : parseInt(t.nextFundingTime),
    openInterest: parseFloat(t.openInterest),
    oiValue     : parseFloat(t.openInterestValue),
    turnover24h : parseFloat(t.turnover24h),
    fundingInterval: parseInt(t.fundingIntervalHour) || 8,
    lastFundingRate: fr.status === 'fulfilled' && fr.value.result?.list?.[0]
                     ? parseFloat(fr.value.result.list[0].fundingRate) : null,
    bid1Price   : parseFloat(t.bid1Price),
    ask1Price   : parseFloat(t.ask1Price),
    bid1Size    : parseFloat(t.bid1Size),
    ask1Size    : parseFloat(t.ask1Size),
    bids        : book ? book.b.map(([p,s]) => [parseFloat(p), parseFloat(s)]) : [],
    asks        : book ? book.a.map(([p,s]) => [parseFloat(p), parseFloat(s)]) : [],
  };
}

/* ── KLINE FETCH with fallback ──────────────────────────────── */
async function fetchKline(symbol, tf) {
  // Try Binance first
  try {
    const interval = TF_MAP.binance[tf] || '1h';
    const url = `${CFG.BINANCE_FAPI}/klines?symbol=${symbol}&interval=${interval}&limit=${CFG.KLINE_LIMIT}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      // [openTime, open, high, low, close, volume, ...]
      return data.map(c => ({
        t: c[0], o: parseFloat(c[1]), h: parseFloat(c[2]),
        l: parseFloat(c[3]), c: parseFloat(c[4]), v: parseFloat(c[5]),
      }));
    }
  } catch (_) { /* fall through */ }

  // Fallback: Bybit
  try {
    const interval = TF_MAP.bybit[tf] || '60';
    const url = `${CFG.BYBIT_API}/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${CFG.KLINE_LIMIT}`;
    const res = await fetchWithTimeout(url);
    const data = await res.json();
    if (data.retCode === 0 && data.result.list.length) {
      // Bybit: [startTime, open, high, low, close, volume, turnover]
      return data.result.list.map(c => ({
        t: parseInt(c[0]), o: parseFloat(c[1]), h: parseFloat(c[2]),
        l: parseFloat(c[3]), c: parseFloat(c[4]), v: parseFloat(c[5]),
      })).reverse();
    }
  } catch (_) { /* fail silently */ }

  return null;
}

/* ── COINGECKO ──────────────────────────────────────────────── */
async function resolveGeckoId(ticker) {
  if (GECKO_IDS[ticker]) return GECKO_IDS[ticker];
  const slug = ticker.toLowerCase();
  try {
    const probe = await fetchWithTimeout(
      `${CFG.GECKO_API}/coins/${slug}?localization=false&tickers=false&community_data=false&developer_data=false`
    ).then(r => r.json());
    if (probe.id && !probe.error) return probe.id;
  } catch (_) {}
  try {
    const search = await fetchWithTimeout(
      `${CFG.GECKO_API}/search?query=${encodeURIComponent(ticker)}`
    ).then(r => r.json());
    const coins = search.coins || [];
    const exact = coins.find(c => c.symbol.toUpperCase() === ticker);
    if (exact) return exact.id;
    if (coins.length) return coins[0].id;
  } catch (_) {}
  return slug;
}

async function fetchGecko(ticker) {
  const id = await resolveGeckoId(ticker.toUpperCase());
  try {
    const [coin, mkt] = await Promise.allSettled([
      fetchWithTimeout(`${CFG.GECKO_API}/coins/${id}?localization=false&tickers=false&community_data=true&developer_data=false`).then(r => r.json()),
      fetchWithTimeout(`${CFG.GECKO_API}/coins/markets?vs_currency=usd&ids=${id}&order=market_cap_desc&per_page=1&page=1&sparkline=false&price_change_percentage=1h,24h,7d`).then(r => r.json()),
    ]);

    const raw = coin.status === 'fulfilled' ? coin.value : null;
    const c  = (raw && !raw.error) ? raw : null;
    const m  = mkt.status  === 'fulfilled' && mkt.value.length ? mkt.value[0] : null;
    const md = c?.market_data;

    return {
      name          : c?.name,
      symbol        : c?.symbol?.toUpperCase(),
      image         : c?.image?.large,
      categories    : c?.categories || [],
      genesis       : c?.genesis_date,
      algorithm     : c?.hashing_algorithm,
      description   : c?.description?.en || '',
      marketCapRank : c?.market_cap_rank,
      watchlist     : c?.watchlist_portfolio_users,
      sentimentUp   : c?.sentiment_votes_up_percentage,
      sentimentDown : c?.sentiment_votes_down_percentage,
      links         : c?.links,
      marketCap     : md?.market_cap?.usd,
      fdv           : md?.fully_diluted_valuation?.usd,
      circSupply    : md?.circulating_supply,
      totalSupply   : md?.total_supply,
      maxSupply     : md?.max_supply,
      ath           : md?.ath?.usd,
      athChange     : md?.ath_change_percentage?.usd,
      athDate       : md?.ath_date?.usd,
      atl           : md?.atl?.usd,
      atlChange     : md?.atl_change_percentage?.usd,
      pc1h          : md?.price_change_percentage_1h_in_currency?.usd  ?? m?.price_change_percentage_1h_in_currency,
      pc24h         : md?.price_change_percentage_24h,
      pc7d          : md?.price_change_percentage_7d,
      pc14d         : md?.price_change_percentage_14d,
      pc30d         : md?.price_change_percentage_30d,
      pc60d         : md?.price_change_percentage_60d,
      pc200d        : md?.price_change_percentage_200d,
      pc1y          : md?.price_change_percentage_1y,
    };
  } catch (_) {
    return null;
  }
}

/* ── BYBIT ORDERBOOK (separate fetch for Binance path) ──────── */
async function fetchBybitOrderbook(symbol) {
  try {
    const res = await fetchWithTimeout(`${CFG.BYBIT_API}/orderbook?category=linear&symbol=${symbol}&limit=5`);
    const data = await res.json();
    if (data.retCode === 0) {
      return {
        bids: data.result.b.map(([p,s]) => [parseFloat(p), parseFloat(s)]),
        asks: data.result.a.map(([p,s]) => [parseFloat(p), parseFloat(s)]),
      };
    }
  } catch (_) {}
  return { bids: [], asks: [] };
}

/* ══════════════════════════════════════════════════════════════
   CALCULATIONS
══════════════════════════════════════════════════════════════ */

/* ── PIVOT POINTS & S/R ─────────────────────────────────────── */
function calcPivots(candles, currentPrice) {
  if (!candles || !candles.length) return null;

  // Use last completed candle
  const last  = candles[candles.length - 2] || candles[candles.length - 1];
  const H = last.h, L = last.l, C = last.c;

  const PP = (H + L + C) / 3;
  const R1 = 2 * PP - L;
  const R2 = PP + (H - L);
  const R3 = H + 2 * (PP - L);
  const S1 = 2 * PP - H;
  const S2 = PP - (H - L);
  const S3 = L - 2 * (H - PP);

  const dist = p => {
    const d = ((currentPrice - p) / currentPrice) * 100;
    return (d >= 0 ? '+' : '') + d.toFixed(2) + '%';
  };

  return [
    { tag:'R3', label:'Resistance 3', price:R3, type:'resistance', dist:dist(R3) },
    { tag:'R2', label:'Resistance 2', price:R2, type:'resistance', dist:dist(R2) },
    { tag:'R1', label:'Resistance 1', price:R1, type:'resistance', dist:dist(R1) },
    { tag:'PP', label:'Pivot Point',  price:PP, type:'pivot',      dist:dist(PP) },
    { tag:'S1', label:'Support 1',    price:S1, type:'support',    dist:dist(S1) },
    { tag:'S2', label:'Support 2',    price:S2, type:'support',    dist:dist(S2) },
    { tag:'S3', label:'Support 3',    price:S3, type:'support',    dist:dist(S3) },
  ];
}

/* ── SUPPLY & DEMAND ZONES ──────────────────────────────────── */
function calcSupplyDemand(candles, currentPrice) {
  if (!candles || candles.length < 5) return null;

  // Find significant swing highs and lows from recent candles
  const recent = candles.slice(-20);
  const highs = recent.map(c => c.h);
  const lows  = recent.map(c => c.l);

  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  const range = maxH - minL;
  const mid   = (maxH + minL) / 2;

  // Fibonacci-based zones
  const supplyHigh  = maxH;
  const supplyLow   = maxH - range * 0.236;
  const demandLow   = minL;
  const demandHigh  = minL + range * 0.236;
  const eq          = mid;

  // Premium / Discount zones (ICT concept)
  const premium      = mid + range * 0.25;
  const discount     = mid - range * 0.25;

  // Identify current zone
  let currentZone = 'EQUILIBRIUM';
  if (currentPrice >= supplyLow)   currentZone = 'SUPPLY (PREMIUM)';
  else if (currentPrice <= demandHigh) currentZone = 'DEMAND (DISCOUNT)';

  return {
    supply:    { high: supplyHigh, low: supplyLow },
    demand:    { high: demandHigh, low: demandLow },
    eq,
    premium,
    discount,
    currentZone,
    range,
  };
}

/* ── LIQUIDITY ZONES ────────────────────────────────────────── */
function calcLiquidity(currentPrice, high24h, low24h, ath, atl) {
  const zones = [];

  // Round number levels near current price
  const magnitude = Math.pow(10, Math.floor(Math.log10(currentPrice)));
  for (let m = -3; m <= 3; m++) {
    const level = Math.round(currentPrice / magnitude) * magnitude + m * magnitude;
    if (level > 0 && Math.abs(level - currentPrice) / currentPrice < 0.15) {
      const dist = ((currentPrice - level) / currentPrice * 100).toFixed(2);
      zones.push({
        type : 'liquidity',
        name : 'ROUND NUMBER',
        price: level,
        desc : `Psychological level — ${(dist >= 0 ? '+' : '') + dist}% from price`,
      });
    }
  }

  // 24h high/low as liquidity magnets
  zones.push({
    type : 'liquidity',
    name : '24H HIGH LIQUIDITY',
    price: high24h,
    desc : `Stop cluster above — ${(((currentPrice - high24h) / currentPrice) * 100).toFixed(2)}% from price`,
  });

  zones.push({
    type : 'liquidity',
    name : '24H LOW LIQUIDITY',
    price: low24h,
    desc : `Stop cluster below — ${(((currentPrice - low24h) / currentPrice) * 100).toFixed(2)}% from price`,
  });

  // ATH / ATL
  if (ath) {
    const d = (((currentPrice - ath) / currentPrice) * 100).toFixed(2);
    zones.push({ type:'liquidity', name:'ALL TIME HIGH', price:ath, desc:`${d}% from price` });
  }
  if (atl) {
    const d = (((currentPrice - atl) / currentPrice) * 100).toFixed(2);
    zones.push({ type:'liquidity', name:'ALL TIME LOW', price:atl, desc:`${d}% from price` });
  }

  // Sort by distance to current price
  zones.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
  return zones;
}

/* ── FUNDING RATE SENTIMENT ─────────────────────────────────── */
function fundingSentiment(rate) {
  if (rate == null) return { text: '—', cls: '' };
  const r = rate * 100;
  if (r > 0.05)  return { text: 'LONGS PAYING — BEARISH', cls: 'bear' };
  if (r > 0.01)  return { text: 'MILD BULLISH BIAS',      cls: 'bull' };
  if (r < -0.05) return { text: 'SHORTS PAYING — BULLISH',cls: 'bull' };
  if (r < -0.01) return { text: 'MILD BEARISH BIAS',      cls: 'bear' };
  return { text: 'NEUTRAL / BALANCED', cls: 'neutral' };
}

/* ── FUNDING COUNTDOWN ──────────────────────────────────────── */
function startFundingCountdown(nextFundingMs) {
  if (STATE.fundingInterval) clearInterval(STATE.fundingInterval);
  const el = $('funding-countdown');
  if (!el || !nextFundingMs) return;

  const tick = () => {
    const diff = nextFundingMs - Date.now();
    if (diff <= 0) { el.textContent = '00:00:00'; return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = [h,m,s].map(n => String(n).padStart(2,'0')).join(':');
  };

  tick();
  STATE.fundingInterval = setInterval(tick, 1000);
}

/* ══════════════════════════════════════════════════════════════
   RENDERERS — SINGLE COIN
══════════════════════════════════════════════════════════════ */

function renderCoinIdentity(gecko, fallbackTicker) {
  // Always reset logo
  const logo = $('coin-logo');
  logo.onload  = null;
  logo.onerror = null;
  logo.src = '';
  logo.style.display = 'none';

  // Show image only if gecko returned one and it loads successfully
  if (gecko?.image) {
    logo.onload  = () => { logo.style.display = 'block'; };
    logo.onerror = () => { logo.style.display = 'none'; };
    logo.src = gecko.image;
  }

  // Always show at minimum what the user searched
  $('coin-symbol').textContent    = gecko?.symbol || fallbackTicker || '—';
  $('coin-name').textContent      = gecko?.name   || fallbackTicker || '—';
  $('coin-rank').textContent      = gecko?.marketCapRank ? `#${gecko.marketCapRank} BY MARKET CAP` : '—';
  $('coin-genesis').textContent   = gecko?.genesis   || '—';
  $('coin-algo').textContent      = gecko?.algorithm || 'N/A';
  $('coin-watchlist').textContent = gecko?.watchlist ? fNum(gecko.watchlist) : '—';

  // Categories
  const catEl = $('coin-categories');
  catEl.innerHTML = '';
  (gecko?.categories || []).slice(0, 4).forEach(cat => {
    const tag = document.createElement('span');
    tag.className   = 'category-tag';
    tag.textContent = cat;
    catEl.appendChild(tag);
  });

  // Sentiment
  if (gecko?.sentimentUp != null) {
    $('sentiment-up').textContent   = gecko.sentimentUp.toFixed(1) + '% BULLISH';
    $('sentiment-down').textContent = gecko.sentimentDown.toFixed(1) + '% BEARISH';
    $('sentiment-fill').style.width = gecko.sentimentUp + '%';
  }
}

function renderPriceAction(market, gecko) {
  const price = market.lastPrice;
  STATE.currentPrice = price;

  $('price-main').textContent = fPrice(price);
  setPct('pc-1h',  gecko?.pc1h  ?? null);
  setPct('pc-24h', market.changePct24h);
  setPct('pc-7d',  gecko?.pc7d  ?? null);

  $('mark-price').textContent    = fPrice(market.markPrice);
  $('index-price').textContent   = fPrice(market.indexPrice);
  $('high-24h').textContent      = fPrice(market.high24h);
  $('low-24h').textContent       = fPrice(market.low24h);
  $('vol-base').textContent      = fNum(market.volume);
  $('vol-quote').textContent     = '$' + fNum(market.quoteVolume);
  $('weighted-avg').textContent  = fPrice(market.weightedAvg);
  $('trade-count').textContent   = market.tradeCount ? fNum(market.tradeCount) : '—';
}

function renderOHLC(candles) {
  if (!candles || !candles.length) return;
  const last = candles[candles.length - 1];
  $('ohlc-o').textContent = fPrice(last.o);
  $('ohlc-h').textContent = fPrice(last.h);
  $('ohlc-l').textContent = fPrice(last.l);
  $('ohlc-c').textContent = fPrice(last.c);
}

function renderFunding(market) {
  const fr  = market.fundingRate;
  const sen = fundingSentiment(fr);

  const frEl = $('funding-rate');
  frEl.textContent = fRate(fr);
  frEl.className = sen.cls;

  $('funding-sentiment').textContent = sen.text;
  $('funding-sentiment').className   = 'fr-sub ' + sen.cls;

  $('open-interest').textContent   = market.openInterest ? fNum(market.openInterest) : '—';
  $('oi-value').textContent        = market.oiValue      ? '$' + fNum(market.oiValue): '—';
  $('interest-rate').textContent   = fRate(market.interestRate);
  $('funding-interval').textContent= market.fundingInterval ? market.fundingInterval + 'H' : '—';
  $('last-funding-rate').textContent= fRate(market.lastFundingRate);
  $('turnover-24h').textContent    = market.turnover24h ? '$' + fNum(market.turnover24h) : '—';

  startFundingCountdown(market.nextFunding);
}

function renderSR(levels, tf) {
  const container = $('sr-levels');
  $('sr-tf-badge').textContent = tf.toUpperCase();
  if (!levels) { container.innerHTML = '<div class="levels-placeholder">Could not calculate — insufficient kline data</div>'; return; }

  container.innerHTML = levels.map(l => `
    <div class="level-row ${l.type}">
      <span class="level-tag">${l.tag}</span>
      <span class="level-label">${l.label}</span>
      <span class="level-price">${fPrice(l.price)}</span>
      <span class="level-dist">${l.dist}</span>
    </div>
  `).join('');
}

function renderSupplyDemand(zones, tf) {
  const container = $('sd-zones');
  $('sd-tf-badge').textContent = tf.toUpperCase();
  if (!zones) { container.innerHTML = '<div class="levels-placeholder">Could not calculate — insufficient kline data</div>'; return; }

  const currentBadge = `<span class="zone-strength">◀ PRICE HERE</span>`;
  const isCurrent = (name) => zones.currentZone.includes(name.split(' ')[0]);

  container.innerHTML = `
    <div class="zone-row supply">
      <div class="zone-header">
        <span class="zone-name">SUPPLY ZONE ${isCurrent('SUPPLY') ? currentBadge : ''}</span>
        <span class="zone-strength">PREMIUM</span>
      </div>
      <div class="zone-range">${fPrice(zones.supply.low)} — ${fPrice(zones.supply.high)}</div>
      <div class="zone-desc">Distribution area — sellers likely active</div>
    </div>
    <div class="zone-row equilibrium">
      <div class="zone-header">
        <span class="zone-name">EQUILIBRIUM ${!isCurrent('SUPPLY') && !isCurrent('DEMAND') ? currentBadge : ''}</span>
        <span class="zone-strength">FAIR VALUE</span>
      </div>
      <div class="zone-range">${fPrice(zones.discount)} — ${fPrice(zones.premium)}</div>
      <div class="zone-desc">Mid-range — balanced supply/demand area</div>
    </div>
    <div class="zone-row demand">
      <div class="zone-header">
        <span class="zone-name">DEMAND ZONE ${isCurrent('DEMAND') ? currentBadge : ''}</span>
        <span class="zone-strength">DISCOUNT</span>
      </div>
      <div class="zone-range">${fPrice(zones.demand.low)} — ${fPrice(zones.demand.high)}</div>
      <div class="zone-desc">Accumulation area — buyers likely active</div>
    </div>
  `;
}

function renderLiquidity(zones) {
  const container = $('liq-zones');
  if (!zones || !zones.length) { container.innerHTML = '<div class="levels-placeholder">No data</div>'; return; }

  container.innerHTML = zones.slice(0, 8).map(z => `
    <div class="zone-row liquidity">
      <div class="zone-header">
        <span class="zone-name">${z.name}</span>
      </div>
      <div class="zone-range">${fPrice(z.price)}</div>
      <div class="zone-desc">${z.desc}</div>
    </div>
  `).join('');
}

function renderOrderBook(market) {
  const bids = market.bids || [];
  const asks = market.asks || [];

  // Asks (reversed — show closest first)
  const asksReversed = [...asks].reverse();
  $('ob-asks').innerHTML = asksReversed.map(([p,s]) => {
    const total = (p * s).toFixed(0);
    return `<div class="ob-row ask">
      <span>${fPrice(p)}</span>
      <span>${s.toFixed(4)}</span>
      <span>$${fNum(parseFloat(total))}</span>
    </div>`;
  }).join('') || '<div class="levels-placeholder">—</div>';

  // Bids
  $('ob-bids').innerHTML = bids.map(([p,s]) => {
    const total = (p * s).toFixed(0);
    return `<div class="ob-row bid">
      <span>${fPrice(p)}</span>
      <span>${s.toFixed(4)}</span>
      <span>$${fNum(parseFloat(total))}</span>
    </div>`;
  }).join('') || '<div class="levels-placeholder">—</div>';

  // Spread
  if (bids.length && asks.length) {
    const spread    = asks[0][0] - bids[0][0];
    const spreadPct = (spread / asks[0][0] * 100).toFixed(4);
    $('ob-spread').textContent     = fPrice(spread);
    $('ob-spread-pct').textContent = spreadPct + '%';
  }

  // Imbalance
  const bidVol = bids.reduce((s,[p,sz]) => s + p * sz, 0);
  const askVol = asks.reduce((s,[p,sz]) => s + p * sz, 0);
  const total  = bidVol + askVol;
  if (total > 0) {
    const bidPct = (bidVol / total * 100).toFixed(1);
    const askPct = (askVol / total * 100).toFixed(1);
    $('imb-bid').style.width     = bidPct + '%';
    $('imb-ask').style.width     = askPct + '%';
    $('imb-bid-pct').textContent = bidPct + '%';
    $('imb-ask-pct').textContent = askPct + '%';
  }
}

function renderMarketStats(gecko) {
  if (!gecko) return;
  $('market-cap').textContent   = gecko.marketCap  ? '$' + fNum(gecko.marketCap)  : '—';
  $('fdv').textContent          = gecko.fdv         ? '$' + fNum(gecko.fdv)        : '—';
  $('circ-supply').textContent  = gecko.circSupply  ? fNum(gecko.circSupply)       : '—';
  $('max-supply').textContent   = gecko.maxSupply   ? fNum(gecko.maxSupply)        : '∞';
  $('coin-ath').textContent     = fPrice(gecko.ath);
  $('coin-atl').textContent     = fPrice(gecko.atl);

  const athEl = $('coin-ath-change');
  athEl.textContent = gecko.athChange != null ? fPct(gecko.athChange) : '—';
  athEl.className   = 'pg-value ' + pctClass(gecko.athChange);

  const atlEl = $('coin-atl-change');
  atlEl.textContent = gecko.atlChange != null ? fPct(gecko.atlChange) : '—';
  atlEl.className   = 'pg-value ' + pctClass(gecko.atlChange);

  setTfcPct('pc-14d',  gecko.pc14d);
  setTfcPct('pc-30d',  gecko.pc30d);
  setTfcPct('pc-60d',  gecko.pc60d);
  setTfcPct('pc-200d', gecko.pc200d);
  setTfcPct('pc-1y',   gecko.pc1y);
}

function renderSocials(gecko) {
  if (!gecko?.links) return;
  const links = gecko.links;
  const grid  = $('socials-grid');
  grid.innerHTML = '';

  const add = (href, label) => {
    if (!href) return;
    const a = document.createElement('a');
    a.className   = 'social-link';
    a.href        = href;
    a.target      = '_blank';
    a.rel         = 'noopener';
    a.textContent = label;
    grid.appendChild(a);
  };

  add(links.homepage?.[0],             '🌐 WEBSITE');
  add(links.whitepaper,                '📄 WHITEPAPER');
  add(links.twitter_screen_name ? `https://twitter.com/${links.twitter_screen_name}` : null, '𝕏 TWITTER');
  add(links.subreddit_url,             '👾 REDDIT');
  add(links.repos_url?.github?.[0],    '⌨ GITHUB');
  add(links.blockchain_site?.[0],      '🔗 EXPLORER');
  add(links.official_forum_url?.[0],   '💬 FORUM');
}

function renderDescription(gecko) {
  if (!gecko?.description) return;
  const el     = $('coin-description');
  const toggle = $('desc-toggle');
  const text   = gecko.description.replace(/<[^>]+>/g, '');
  el.textContent = text;

  toggle.addEventListener('click', () => {
    el.classList.toggle('expanded');
    toggle.textContent = el.classList.contains('expanded') ? 'READ LESS' : 'READ MORE';
  });
}

/* ── SOURCE BAR ─────────────────────────────────────────────── */
function renderSourceBar(source, tf) {
  $('source-badge').textContent  = source;
  $('tf-badge').textContent      = tf.toUpperCase();
  $('updated-badge').textContent = nowStr();
  $('source-bar').style.display  = 'flex';
}

/* ══════════════════════════════════════════════════════════════
   MAIN FETCH — SINGLE COIN
══════════════════════════════════════════════════════════════ */
async function fetchCoin() {
  const ticker = $('coin-input').value.trim().toUpperCase();
  if (!ticker) return;
  const symbol = ticker + 'USDT';
  const tf     = STATE.singleTf;

  // UI: show loading — clear stale image immediately
  const _logo = $('coin-logo');
  _logo.onload  = null;
  _logo.onerror = null;
  _logo.src = '';
  _logo.style.display = 'none';

  $('empty-state').style.display   = 'none';
  $('error-state').style.display   = 'none';
  $('coin-grid').style.display     = 'none';
  $('source-bar').style.display    = 'none';
  $('loading-state').style.display = 'flex';
  $('loader-text').textContent     = 'CONNECTING TO BINANCE...';
  $('fetch-btn').classList.add('loading');
  setStatus('loading', 'FETCHING');
  SFX.play('fetch_start');

  let market = null;

  // 1. Try Binance
  try {
    $('loader-text').textContent = 'FETCHING FROM BINANCE...';
    market = await fetchBinance(symbol);
  } catch (e) {
    // 2. Fallback: Bybit
    try {
      $('loader-text').textContent = 'BINANCE FAILED — TRYING BYBIT...';
      market = await fetchBybit(symbol);
    } catch (e2) {
      $('loading-state').style.display = 'none';
      $('error-state').style.display   = 'flex';
      $('error-title').textContent     = 'FETCH FAILED';
      $('error-sub').textContent       = `Could not fetch "${ticker}" from Binance or Bybit. Check ticker.`;
      $('fetch-btn').classList.remove('loading');
      setStatus('error', 'ERROR');
      return;
    }
  }

  // If Binance was source, try to get orderbook from Bybit
  if (market.source === 'BINANCE' && (!market.bids.length)) {
    $('loader-text').textContent = 'FETCHING ORDER BOOK...';
    const ob = await fetchBybitOrderbook(symbol);
    market.bids = ob.bids;
    market.asks = ob.asks;
  }

  // 3. Fetch klines
  $('loader-text').textContent = `FETCHING ${tf.toUpperCase()} KLINES...`;
  const candles = await fetchKline(symbol, tf);

  // 4. Fetch CoinGecko
  $('loader-text').textContent = 'FETCHING GECKO DATA...';
  const gecko = await fetchGecko(ticker);

  // 5. Calculate levels
  const currentPrice = market.lastPrice;
  const pivots  = calcPivots(candles, currentPrice);
  const sdZones = calcSupplyDemand(candles, currentPrice);
  const liqZones = calcLiquidity(
    currentPrice, market.high24h, market.low24h,
    gecko?.ath, gecko?.atl
  );

  // 6. Render everything
  $('loading-state').style.display = 'none';
  $('coin-grid').style.display     = 'flex';

  renderCoinIdentity(gecko, ticker);
  renderPriceAction(market, gecko);
  renderOHLC(candles);
  renderFunding(market);
  renderSR(pivots, tf);
  renderSupplyDemand(sdZones, tf);
  renderLiquidity(liqZones);
  renderOrderBook(market);
  renderMarketStats(gecko);
  renderSocials(gecko);
  renderDescription(gecko);
  renderSourceBar(market.source, tf);

  $('fetch-btn').classList.remove('loading');
  setStatus('ok', 'LIVE');
}

/* ══════════════════════════════════════════════════════════════
   MARKET SCANNER
══════════════════════════════════════════════════════════════ */

async function fetchAllBinance() {
  const res  = await fetchWithTimeout(`${CFG.BINANCE_FAPI}/ticker/24hr`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Binance all tickers failed');

  return data
    .filter(t => t.symbol.endsWith('USDT'))
    .map(t => ({
      symbol      : t.symbol.replace('USDT',''),
      lastPrice   : parseFloat(t.lastPrice),
      changePct24h: parseFloat(t.priceChangePercent),
      high24h     : parseFloat(t.highPrice),
      low24h      : parseFloat(t.lowPrice),
      volume      : parseFloat(t.volume),
      quoteVolume : parseFloat(t.quoteVolume),
      tradeCount  : t.count,
      weightedAvg : parseFloat(t.weightedAvgPrice),
      fundingRate : null,
      openInterest: null,
      oiValue     : null,
      source      : 'BINANCE',
    }));
}

async function fetchAllBybit() {
  const res  = await fetchWithTimeout(`${CFG.BYBIT_API}/tickers?category=linear`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error('Bybit all tickers failed');

  return data.result.list
    .filter(t => t.symbol.endsWith('USDT'))
    .map(t => ({
      symbol      : t.symbol.replace('USDT',''),
      lastPrice   : parseFloat(t.lastPrice),
      changePct24h: parseFloat(t.price24hPcnt) * 100,
      high24h     : parseFloat(t.highPrice24h),
      low24h      : parseFloat(t.lowPrice24h),
      volume      : parseFloat(t.volume24h),
      quoteVolume : parseFloat(t.turnover24h),
      tradeCount  : null,
      weightedAvg : null,
      fundingRate : parseFloat(t.fundingRate),
      openInterest: parseFloat(t.openInterest),
      oiValue     : parseFloat(t.openInterestValue),
      source      : 'BYBIT',
    }));
}

async function runScanner() {
  $('scanner-empty').style.display         = 'none';
  $('scanner-table-wrapper').style.display = 'none';
  $('scanner-nav').style.display           = 'none';
  $('scanner-stats-bar').style.display     = 'none';
  $('scanner-loading').style.display       = 'flex';
  $('scanner-loader-text').textContent     = `SCANNING ${STATE.scannerSource.toUpperCase()} MARKET...`;
  $('scanner-fetch-btn').classList.add('loading');
  setStatus('loading', 'SCANNING');

  try {
    let coins;

    if (STATE.scannerSource === 'binance') {
      try {
        coins = await fetchAllBinance();
      } catch(_) {
        $('scanner-loader-text').textContent = 'BINANCE FAILED — TRYING BYBIT...';
        coins = await fetchAllBybit();
      }
    } else {
      try {
        coins = await fetchAllBybit();
      } catch(_) {
        $('scanner-loader-text').textContent = 'BYBIT FAILED — TRYING BINANCE...';
        coins = await fetchAllBinance();
      }
    }

    STATE.scannerData = coins;

    // Stats bar
    $('scan-count').textContent   = coins.length + ' PAIRS';
    $('scan-source').textContent  = coins[0]?.source || STATE.scannerSource.toUpperCase();
    $('scan-updated').textContent = nowStr();
    $('scanner-stats-bar').style.display = 'flex';

    $('scanner-loading').style.display       = 'none';
    $('scanner-nav').style.display           = 'flex';
    $('scanner-table-wrapper').style.display = 'block';

    renderScannerCategory();
    setStatus('ok', 'SCAN COMPLETE');
  } catch(e) {
    $('scanner-loading').style.display = 'none';
    $('scanner-empty').style.display   = 'flex';
    $('scanner-empty').querySelector('.empty-title').textContent = 'SCAN FAILED';
    $('scanner-empty').querySelector('.empty-sub').textContent   = e.message;
    setStatus('error', 'ERROR');
  }

  $('scanner-fetch-btn').classList.remove('loading');
}

/* ── SCANNER CATEGORY RENDERERS ─────────────────────────────── */
const SCANNER_CONFIGS = {
  gainers: {
    label  : '▲ TOP GAINERS',
    sort   : (a,b) => b.changePct24h - a.changePct24h,
    limit  : 30,
    headers: ['#','SYMBOL','PRICE','24H CHANGE','24H HIGH','24H LOW','VOLUME (USDT)'],
    row    : (c, i) => [
      i+1, c.symbol,
      fPrice(c.lastPrice),
      { text: fPct(c.changePct24h), cls: pctClass(c.changePct24h) + ' change-cell' },
      fPrice(c.high24h),
      fPrice(c.low24h),
      '$' + fNum(c.quoteVolume),
    ],
    rowCls : c => c.changePct24h >= 10 ? 'top-gainer' : '',
  },
  losers: {
    label  : '▼ TOP LOSERS',
    sort   : (a,b) => a.changePct24h - b.changePct24h,
    limit  : 30,
    headers: ['#','SYMBOL','PRICE','24H CHANGE','24H HIGH','24H LOW','VOLUME (USDT)'],
    row    : (c, i) => [
      i+1, c.symbol,
      fPrice(c.lastPrice),
      { text: fPct(c.changePct24h), cls: pctClass(c.changePct24h) + ' change-cell' },
      fPrice(c.high24h),
      fPrice(c.low24h),
      '$' + fNum(c.quoteVolume),
    ],
    rowCls : c => c.changePct24h <= -10 ? 'top-loser' : '',
  },
  volume: {
    label  : '◈ VOLUME LEADERS',
    sort   : (a,b) => b.quoteVolume - a.quoteVolume,
    limit  : 30,
    headers: ['#','SYMBOL','PRICE','VOLUME (USDT)','VOLUME (BASE)','TRADES','24H CHANGE'],
    row    : (c, i) => [
      i+1, c.symbol,
      fPrice(c.lastPrice),
      '$' + fNum(c.quoteVolume),
      fNum(c.volume),
      c.tradeCount ? fNum(c.tradeCount) : '—',
      { text: fPct(c.changePct24h), cls: pctClass(c.changePct24h) + ' change-cell' },
    ],
    rowCls : () => '',
  },
  funding: {
    label  : '⚡ FUNDING EXTREMES',
    sort   : (a,b) => Math.abs(b.fundingRate||0) - Math.abs(a.fundingRate||0),
    limit  : 40,
    filter : c => c.fundingRate != null,
    headers: ['#','SYMBOL','PRICE','FUNDING RATE','SENTIMENT','OI VALUE','24H CHANGE'],
    row    : (c, i) => {
      const fr  = c.fundingRate;
      const sen = fundingSentiment(fr);
      const frCls = fr > 0 ? 'funding-positive' : fr < 0 ? 'funding-negative' : 'funding-neutral';
      return [
        i+1, c.symbol,
        fPrice(c.lastPrice),
        { text: fRate(fr), cls: frCls },
        { text: sen.text, cls: sen.cls },
        c.oiValue ? '$' + fNum(c.oiValue) : '—',
        { text: fPct(c.changePct24h), cls: pctClass(c.changePct24h) + ' change-cell' },
      ];
    },
    rowCls : () => '',
  },
  oi: {
    label  : '◉ OPEN INTEREST',
    sort   : (a,b) => (b.oiValue||0) - (a.oiValue||0),
    limit  : 30,
    filter : c => c.oiValue != null && c.oiValue > 0,
    headers: ['#','SYMBOL','PRICE','OI VALUE (USD)','OI (COINS)','FUNDING RATE','24H CHANGE'],
    row    : (c, i) => [
      i+1, c.symbol,
      fPrice(c.lastPrice),
      '$' + fNum(c.oiValue),
      fNum(c.openInterest),
      c.fundingRate != null ? { text: fRate(c.fundingRate), cls: c.fundingRate > 0 ? 'funding-positive' : 'funding-negative' } : '—',
      { text: fPct(c.changePct24h), cls: pctClass(c.changePct24h) + ' change-cell' },
    ],
    rowCls : () => '',
  },
  momentum: {
    label  : '⟶ MOMENTUM (>3% + HIGH VOL)',
    sort   : (a,b) => b.changePct24h - a.changePct24h,
    limit  : 30,
    filter : c => {
      const avgVol = 1000000;
      return Math.abs(c.changePct24h) >= 3 && c.quoteVolume >= avgVol;
    },
    headers: ['#','SYMBOL','PRICE','24H CHANGE','VOLUME (USDT)','HIGH','LOW'],
    row    : (c, i) => [
      i+1, c.symbol,
      fPrice(c.lastPrice),
      { text: fPct(c.changePct24h), cls: pctClass(c.changePct24h) + ' change-cell' },
      '$' + fNum(c.quoteVolume),
      fPrice(c.high24h),
      fPrice(c.low24h),
    ],
    rowCls : c => c.changePct24h >= 5 ? 'top-gainer' : c.changePct24h <= -5 ? 'top-loser' : '',
  },
};

function renderScannerCategory() {
  const cfg  = SCANNER_CONFIGS[STATE.scannerCategory];
  if (!cfg || !STATE.scannerData.length) return;

  let data = [...STATE.scannerData];
  if (cfg.filter) data = data.filter(cfg.filter);
  data.sort(cfg.sort);
  data = data.slice(0, cfg.limit);

  // Headers
  const thead = $('scanner-thead');
  thead.innerHTML = `<tr>${cfg.headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

  // Rows
  const tbody = $('scanner-tbody');
  tbody.innerHTML = data.map((coin, i) => {
    const cells = cfg.row(coin, i);
    const rowCls = cfg.rowCls(coin);
    const tds = cells.map((cell, ci) => {
      if (ci === 1) return `<td class="symbol-cell">${cell}</td>`;
      if (ci === 0) return `<td class="rank-cell">${cell}</td>`;
      if (typeof cell === 'object' && cell.text !== undefined) {
        return `<td class="${cell.cls || ''}">${cell.text}</td>`;
      }
      return `<td>${cell}</td>`;
    }).join('');
    return `<tr class="${rowCls}" data-symbol="${coin.symbol}" title="Click to view ${coin.symbol}">${tds}</tr>`;
  }).join('');

  // Click row → switch to single coin view
  tbody.querySelectorAll('tr[data-symbol]').forEach(row => {
    row.addEventListener('click', () => {
      const sym = row.dataset.symbol;
      $('coin-input').value = sym;

      // Switch to single tab
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="single"]').classList.add('active');
      $('tab-single').classList.add('active');

      fetchCoin();
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   SMC ENGINE — FULL MARKET STRUCTURE ANALYSIS
   Swing Detection → BOS/MSS/CHoCH → OB → FVG → EQH/EQL
   Level Validation → State Machine → Confluence Scoring
══════════════════════════════════════════════════════════════ */

/* ── TF-ADAPTIVE PARAMETERS ─────────────────────────────────── */
// Returns swing strength, internal swing strength, and EQH/EQL tolerance
// tuned per timeframe. Lower TFs need higher strength to avoid noise;
// volatile altcoins need wider EQ tolerance than BTC/ETH.
function getTFParams(tf) {
  switch (tf) {
    case '5m':
    case '15m':
    case '30m': return { swingStrength: 3, internalStrength: 1, eqTolerance: 0.003  };
    case '1h':  return { swingStrength: 4, internalStrength: 2, eqTolerance: 0.002  };
    case '4h':  return { swingStrength: 5, internalStrength: 2, eqTolerance: 0.0018 };
    case '1d':
    case '1w':  return { swingStrength: 5, internalStrength: 3, eqTolerance: 0.0015 };
    default:    return { swingStrength: 4, internalStrength: 2, eqTolerance: 0.002  };
  }
}

/* ── SWING POINT DETECTION ──────────────────────────────────── */
// strength = how many candles each side must be lower/higher
function detectSwings(candles, strength) {
  const swings = [];
  for (let i = strength; i < candles.length - strength; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= strength; j++) {
      if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
      if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow  = false;
    }
    if (isHigh) swings.push({ idx: i, type: 'high', price: candles[i].h, t: candles[i].t });
    if (isLow)  swings.push({ idx: i, type: 'low',  price: candles[i].l, t: candles[i].t });
  }
  // Sort by candle index
  swings.sort((a, b) => a.idx - b.idx);
  return swings;
}

/* ── CLASSIFY STRUCTURE (BOS / MSS / HH / HL / LH / LL) ────── */
function classifyStructure(swings, candles, currentPrice) {
  if (swings.length < 4) return null;

  const highs = swings.filter(s => s.type === 'high');
  const lows  = swings.filter(s => s.type === 'low');

  if (highs.length < 2 || lows.length < 2) return null;

  // Label each swing relative to previous same-type swing
  const labeledHighs = highs.map((s, i) => {
    if (i === 0) return { ...s, label: 'SH' };
    const prev = highs[i - 1];
    return { ...s, label: s.price > prev.price ? 'HH' : 'LH' };
  });

  const labeledLows = lows.map((s, i) => {
    if (i === 0) return { ...s, label: 'SL' };
    const prev = lows[i - 1];
    return { ...s, label: s.price < prev.price ? 'LL' : 'HL' };
  });

  // Merge and sort all labeled swings by index
  const allLabeled = [...labeledHighs, ...labeledLows].sort((a, b) => a.idx - b.idx);

  // Determine trend bias from last 4 swings
  const recent = allLabeled.slice(-6);
  const recentHighs = recent.filter(s => s.type === 'high');
  const recentLows  = recent.filter(s => s.type === 'low');

  let externalBias = 'RANGING';
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const hh = recentHighs[recentHighs.length - 1].label === 'HH';
    const hl = recentLows[recentLows.length - 1].label  === 'HL';
    const ll = recentLows[recentLows.length - 1].label  === 'LL';
    const lh = recentHighs[recentHighs.length - 1].label === 'LH';
    if (hh && hl)  externalBias = 'BULLISH';
    else if (ll && lh) externalBias = 'BEARISH';
  }

  // Detect BOS and MSS events
  // BOS: close beyond the last swing in SAME direction as trend
  // MSS: close beyond the last swing in OPPOSITE direction (trend flip)
  const events = [];
  const lastHigh = labeledHighs[labeledHighs.length - 1];
  const lastLow  = labeledLows[labeledLows.length - 1];
  const prevHigh = labeledHighs[labeledHighs.length - 2];
  const prevLow  = labeledLows[labeledLows.length - 2];

  // Check if current price has broken recent structure
  if (prevHigh) {
    const brokenHigh = currentPrice > prevHigh.price;
    const type = externalBias === 'BULLISH' ? 'BOS' : 'MSS';
    if (brokenHigh) {
      events.push({
        type,
        direction: 'BULLISH',
        level: prevHigh.price,
        label: type === 'BOS' ? `BULLISH BOS — broke ${fPrice(prevHigh.price)}` : `MSS — BULLISH SHIFT at ${fPrice(prevHigh.price)}`,
      });
    }
  }

  if (prevLow) {
    const brokenLow = currentPrice < prevLow.price;
    const type = externalBias === 'BEARISH' ? 'BOS' : 'MSS';
    if (brokenLow) {
      events.push({
        type,
        direction: 'BEARISH',
        level: prevLow.price,
        label: type === 'BOS' ? `BEARISH BOS — broke ${fPrice(prevLow.price)}` : `MSS — BEARISH SHIFT at ${fPrice(prevLow.price)}`,
      });
    }
  }

  // Structure trail — last 5 labels for display
  const trail = allLabeled.slice(-5).map(s => s.label).join(' → ');

  return {
    externalBias,
    labeledSwings: allLabeled,
    lastHigh,
    lastLow,
    prevHigh,
    prevLow,
    events,
    trail,
  };
}

/* ── INTERNAL MARKET STRUCTURE ──────────────────────────────── */
function classifyInternalStructure(candles, currentPrice, externalBias, internalStrength) {
  // Use TF-adaptive internal strength; default 1 if not supplied
  internalStrength = internalStrength || 1;
  // Use tighter internal window — last 20 candles for short-term structure
  const internal = candles.slice(-20);
  const iSwings  = detectSwings(internal, internalStrength);

  if (iSwings.length < 4) return null;

  const iHighs = iSwings.filter(s => s.type === 'high');
  const iLows  = iSwings.filter(s => s.type === 'low');

  if (iHighs.length < 2 || iLows.length < 2) return null;

  const lastIHigh = iHighs[iHighs.length - 1];
  const lastILow  = iLows[iLows.length - 1];
  const prevIHigh = iHighs[iHighs.length - 2];
  const prevILow  = iLows[iLows.length - 2];

  let internalBias = 'RANGING';
  const iHH = lastIHigh.price > prevIHigh.price;
  const iHL = lastILow.price  > prevILow.price;
  const iLL = lastILow.price  < prevILow.price;
  const iLH = lastIHigh.price < prevIHigh.price;

  if (iHH && iHL)      internalBias = 'BULLISH';
  else if (iLL && iLH) internalBias = 'BEARISH';

  // Internal MSS — internal bias OPPOSES external = pullback
  // Internal MSS aligns with external = entry trigger
  let status = 'NEUTRAL';
  let statusDesc = '';

  if (externalBias === 'BULLISH' && internalBias === 'BEARISH') {
    status = 'PULLBACK';
    statusDesc = 'Internal bearish pullback within bullish external structure — watch for IMSS up';
  } else if (externalBias === 'BULLISH' && internalBias === 'BULLISH') {
    status = 'ENTRY_TRIGGER';
    statusDesc = 'Internal MSS bullish — aligned with external structure → LONG BIAS';
  } else if (externalBias === 'BEARISH' && internalBias === 'BULLISH') {
    status = 'PULLBACK';
    statusDesc = 'Internal bullish pullback within bearish external structure — watch for IMSS down';
  } else if (externalBias === 'BEARISH' && internalBias === 'BEARISH') {
    status = 'ENTRY_TRIGGER';
    statusDesc = 'Internal MSS bearish — aligned with external structure → SHORT BIAS';
  } else if (externalBias === 'RANGING') {
    status = 'RANGING';
    statusDesc = 'External structure ranging — wait for clear BOS before bias';
  }

  // IBOS / IMSS detection on last internal swing break
  const iEvents = [];
  if (currentPrice > lastIHigh.price) {
    const iType = internalBias === 'BULLISH' ? 'IBOS' : 'IMSS';
    iEvents.push({ type: iType, direction: 'BULLISH', level: lastIHigh.price });
  }
  if (currentPrice < lastILow.price) {
    const iType = internalBias === 'BEARISH' ? 'IBOS' : 'IMSS';
    iEvents.push({ type: iType, direction: 'BEARISH', level: lastILow.price });
  }

  return {
    internalBias,
    lastIHigh,
    lastILow,
    iEvents,
    status,
    statusDesc,
  };
}

/* ── LEVEL STATE MACHINE ─────────────────────────────────────── */
// Given a zone (high/low) created at candleIndex, replay subsequent
// candles to determine the current STATE of that level
function getLevelState(zoneHigh, zoneLow, createdAtIdx, candles, levelBias) {
  // levelBias: 'bull' (demand/support) or 'bear' (supply/resistance)
  let state = 'UNTESTED';

  for (let i = createdAtIdx + 1; i < candles.length; i++) {
    const c = candles[i];

    if (levelBias === 'bull') {
      // Bullish zone: we watch for price returning from above
      if (c.l <= zoneHigh && c.l >= zoneLow && c.c > zoneLow) {
        // Wick into zone, close above bottom → TESTED (held)
        state = 'TESTED';
      } else if (c.c < zoneLow) {
        // Close below zone bottom → BROKEN
        state = 'BROKEN';
        // Check if price later returns and rejects from below → FLIPPED
      } else if (state === 'BROKEN' && c.h >= zoneLow && c.c < zoneLow) {
        state = 'FLIPPED';
      } else if (c.l < zoneLow && c.c >= zoneLow && c.c <= zoneHigh) {
        // Wick below zone, close inside → MITIGATED
        state = 'MITIGATED';
      }
    } else {
      // Bearish zone: price returning from below
      if (c.h >= zoneLow && c.h <= zoneHigh && c.c < zoneHigh) {
        state = 'TESTED';
      } else if (c.c > zoneHigh) {
        state = 'BROKEN';
      } else if (state === 'BROKEN' && c.l <= zoneHigh && c.c > zoneHigh) {
        state = 'FLIPPED';
      } else if (c.h > zoneHigh && c.c <= zoneHigh && c.c >= zoneLow) {
        state = 'MITIGATED';
      }
    }
  }

  return state;
}

// Price position relative to a zone
function getPricePosition(zoneHigh, zoneLow, currentPrice) {
  const pct = ((currentPrice - zoneLow) / (zoneHigh - zoneLow)) * 100;
  if (currentPrice > zoneHigh) return 'ABOVE';
  if (currentPrice < zoneLow)  return 'BELOW';
  return 'INSIDE';
}

function getApproaching(zoneHigh, zoneLow, currentPrice) {
  const distHigh = Math.abs((currentPrice - zoneHigh) / currentPrice) * 100;
  const distLow  = Math.abs((currentPrice - zoneLow)  / currentPrice) * 100;
  return Math.min(distHigh, distLow) <= 1.5;
}

/* ── ORDER BLOCK DETECTION ──────────────────────────────────── */
function detectOrderBlocks(candles, currentPrice) {
  const obs = [];

  for (let i = 1; i < candles.length - 2; i++) {
    const c    = candles[i];
    const next = candles[i + 1];
    const body     = Math.abs(c.c - c.o);
    const nextBody = Math.abs(next.c - next.o);

    // Volume confirmation: impulse candle volume must be ≥1.4× the 20-bar average
    // at that point in history. Uses whichever bars are available (up to 20 prior).
    // This gates out OBs formed on low-conviction moves — only institutionally
    // significant impulses qualify.
    const volStart  = Math.max(0, i - 20);
    const volSlice  = candles.slice(volStart, i);
    const avgVol    = volSlice.length
      ? volSlice.reduce((s, x) => s + x.v, 0) / volSlice.length
      : 0;
    const volConfirmed = avgVol > 0 && next.v >= avgVol * 1.4;

    // Bullish OB: last bearish candle before a strong bullish impulse
    if (c.c < c.o && next.c > next.o && nextBody >= body * 1.5 && volConfirmed) {
      const zoneHigh = c.h;
      const zoneLow  = c.l;
      const state    = getLevelState(zoneHigh, zoneLow, i, candles, 'bull');
      const pos      = getPricePosition(zoneHigh, zoneLow, currentPrice);
      const dist     = pos === 'ABOVE'
        ? ((currentPrice - zoneHigh) / currentPrice * 100)
        : pos === 'BELOW'
          ? ((zoneLow - currentPrice) / currentPrice * 100)
          : 0;

      obs.push({
        bias:        'BULL',
        zoneHigh,
        zoneLow,
        createdAt:   i,
        totalCandles: candles.length,
        state,
        pos,
        approaching: getApproaching(zoneHigh, zoneLow, currentPrice),
        dist:        dist.toFixed(2),
        impulseSize: ((next.c - next.o) / next.o * 100).toFixed(2),
        volRatio:    avgVol > 0 ? (next.v / avgVol).toFixed(2) : '—',
      });
    }

    // Bearish OB: last bullish candle before a strong bearish impulse
    if (c.c > c.o && next.c < next.o && nextBody >= body * 1.5 && volConfirmed) {
      const zoneHigh = c.h;
      const zoneLow  = c.l;
      const state    = getLevelState(zoneHigh, zoneLow, i, candles, 'bear');
      const pos      = getPricePosition(zoneHigh, zoneLow, currentPrice);
      const dist     = pos === 'BELOW'
        ? ((zoneLow - currentPrice) / currentPrice * 100)
        : pos === 'ABOVE'
          ? ((currentPrice - zoneHigh) / currentPrice * 100)
          : 0;

      obs.push({
        bias:        'BEAR',
        zoneHigh,
        zoneLow,
        createdAt:   i,
        totalCandles: candles.length,
        state,
        pos,
        approaching: getApproaching(zoneHigh, zoneLow, currentPrice),
        dist:        dist.toFixed(2),
        impulseSize: ((next.o - next.c) / next.o * 100).toFixed(2),
        volRatio:    avgVol > 0 ? (next.v / avgVol).toFixed(2) : '—',
      });
    }
  }

  // ── DEDUPLICATION: remove overlapping OBs, keep most recent ──
  // If two OBs of same bias overlap or are within 0.3% of each other, discard the older one
  function dedup(list) {
    const kept = [];
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt); // newest first
    for (const ob of sorted) {
      const overlaps = kept.some(k => {
        // Check if zones overlap
        const overlapRange = Math.min(ob.zoneHigh, k.zoneHigh) - Math.max(ob.zoneLow, k.zoneLow);
        const obSize = ob.zoneHigh - ob.zoneLow;
        return overlapRange > 0 && overlapRange / obSize > 0.3; // >30% overlap = duplicate
      });
      if (!overlaps) kept.push(ob);
      if (kept.length >= 3) break;
    }
    return kept;
  }

  const rawBull = obs.filter(o => o.bias === 'BULL' && o.state !== 'BROKEN' && o.state !== 'MITIGATED');
  const rawBear = obs.filter(o => o.bias === 'BEAR' && o.state !== 'BROKEN' && o.state !== 'MITIGATED');

  const bullOBs = dedup(rawBull);
  const bearOBs = dedup(rawBear);

  // ── INSIDE CONFLICT: only 1 OB can be genuinely INSIDE ──
  // Most recent INSIDE wins; older ones that overlap get pos corrected
  const allOBs = [...bullOBs, ...bearOBs].sort((a, b) => b.createdAt - a.createdAt);
  let insideCount = 0;
  for (const ob of allOBs) {
    if (ob.pos === 'INSIDE') {
      insideCount++;
      if (insideCount > 1) {
        // Correct pos based on bias — if price is inside multiple,
        // older ones are considered "tested and holding" not "inside"
        ob.pos = ob.bias === 'BULL' ? 'ABOVE' : 'BELOW';
        ob.approaching = false;
      }
    }
  }

  return allOBs;
}

/* ── FAIR VALUE GAP DETECTION ───────────────────────────────── */
function detectFVGs(candles, currentPrice) {
  const fvgs = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const curr = candles[i];
    const next = candles[i + 1];

    // Bullish FVG: gap between prev candle high and next candle low
    if (prev.h < next.l) {
      const gapHigh = next.l;
      const gapLow  = prev.h;
      const gapSize = ((gapHigh - gapLow) / gapLow * 100).toFixed(2);

      // Determine fill state by replaying candles after i+1
      let fillState = 'UNFILLED';
      let partialFill = false;
      for (let j = i + 2; j < candles.length; j++) {
        const fc = candles[j];
        if (fc.l <= gapLow)          { fillState = 'FILLED'; break; }
        if (fc.l <= gapHigh && !partialFill) { fillState = 'PARTIAL'; partialFill = true; }
      }

      const pos  = getPricePosition(gapHigh, gapLow, currentPrice);
      const dist = pos === 'ABOVE'
        ? ((currentPrice - gapHigh) / currentPrice * 100).toFixed(2)
        : ((gapLow - currentPrice)  / currentPrice * 100).toFixed(2);

      fvgs.push({ bias: 'BULL', gapHigh, gapLow, gapSize, fillState, pos, dist: parseFloat(dist), createdAt: i });
    }

    // Bearish FVG: gap between prev candle low and next candle high
    if (prev.l > next.h) {
      const gapHigh = prev.l;
      const gapLow  = next.h;
      const gapSize = ((gapHigh - gapLow) / gapLow * 100).toFixed(2);

      let fillState = 'UNFILLED';
      let partialFill = false;
      for (let j = i + 2; j < candles.length; j++) {
        const fc = candles[j];
        if (fc.h >= gapHigh)         { fillState = 'FILLED'; break; }
        if (fc.h >= gapLow && !partialFill) { fillState = 'PARTIAL'; partialFill = true; }
      }

      const pos  = getPricePosition(gapHigh, gapLow, currentPrice);
      const dist = pos === 'BELOW'
        ? ((gapLow - currentPrice)  / currentPrice * 100).toFixed(2)
        : ((currentPrice - gapHigh) / currentPrice * 100).toFixed(2);

      fvgs.push({ bias: 'BEAR', gapHigh, gapLow, gapSize, fillState, pos, dist: parseFloat(dist), createdAt: i });
    }
  }

  // Return unfilled/partial FVGs closest to price, max 4
  const active = fvgs.filter(f => f.fillState !== 'FILLED');
  active.sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));
  return active.slice(0, 4);
}

/* ── EQUAL HIGHS / EQUAL LOWS ───────────────────────────────── */
function detectEQHEQL(swings, candles, currentPrice, tolerance) {
  tolerance = tolerance || 0.002; // default 0.2% — overridden by getTFParams
  const highs = swings.filter(s => s.type === 'high');
  const lows  = swings.filter(s => s.type === 'low');
  const results = { eqh: [], eql: [] };

  // Group highs within tolerance
  for (let i = 0; i < highs.length; i++) {
    const group = [highs[i]];
    for (let j = i + 1; j < highs.length; j++) {
      if (Math.abs(highs[j].price - highs[i].price) / highs[i].price <= tolerance) {
        group.push(highs[j]);
      }
    }
    if (group.length >= 2) {
      const level = group.reduce((s, h) => s + h.price, 0) / group.length;
      // Check if swept: any candle after last group member has high > level
      const lastIdx = Math.max(...group.map(h => h.idx));
      let swept = false;
      for (let k = lastIdx + 1; k < candles.length; k++) {
        if (candles[k].h > level * (1 + tolerance)) { swept = true; break; }
      }
      const dist = ((currentPrice - level) / currentPrice * 100).toFixed(2);
      results.eqh.push({ level, touches: group.length, swept, dist: parseFloat(dist) });
    }
  }

  // Group lows within tolerance
  for (let i = 0; i < lows.length; i++) {
    const group = [lows[i]];
    for (let j = i + 1; j < lows.length; j++) {
      if (Math.abs(lows[j].price - lows[i].price) / lows[i].price <= tolerance) {
        group.push(lows[j]);
      }
    }
    if (group.length >= 2) {
      const level = group.reduce((s, l) => s + l.price, 0) / group.length;
      const lastIdx = Math.max(...group.map(l => l.idx));
      let swept = false;
      for (let k = lastIdx + 1; k < candles.length; k++) {
        if (candles[k].l < level * (1 - tolerance)) { swept = true; break; }
      }
      const dist = ((currentPrice - level) / currentPrice * 100).toFixed(2);
      results.eql.push({ level, touches: group.length, swept, dist: parseFloat(dist) });
    }
  }

  // Deduplicate and keep most significant
  results.eqh = results.eqh.sort((a, b) => b.touches - a.touches).slice(0, 3);
  results.eql = results.eql.sort((a, b) => b.touches - a.touches).slice(0, 3);
  return results;
}

/* ── PREMIUM / DISCOUNT ARRAY ───────────────────────────────── */
function calcPremiumDiscount(externalStruct, currentPrice, candles) {
  // Use the widest confirmed swing range from all labeled swings
  // Falls back to raw candle high/low if swings are too narrow
  let rangeHigh, rangeLow;

  if (externalStruct?.labeledSwings?.length >= 2) {
    const swingHighs = externalStruct.labeledSwings.filter(s => s.type === 'high').map(s => s.price);
    const swingLows  = externalStruct.labeledSwings.filter(s => s.type === 'low').map(s => s.price);
    if (swingHighs.length && swingLows.length) {
      rangeHigh = Math.max(...swingHighs);
      rangeLow  = Math.min(...swingLows);
    }
  }

  // Fallback: use raw candle range if swing range is invalid or price is outside it
  if (!rangeHigh || !rangeLow || currentPrice > rangeHigh || currentPrice < rangeLow) {
    if (candles?.length) {
      rangeHigh = Math.max(...candles.map(c => c.h));
      rangeLow  = Math.min(...candles.map(c => c.l));
    } else {
      return null;
    }
  }

  const range = rangeHigh - rangeLow;
  if (range <= 0) return null;

  const pct = ((currentPrice - rangeLow) / range) * 100;

  // Fibonacci levels within the range
  const fibs = [
    { label: '0.0%  (RANGE LOW)',  price: rangeLow,               pct: 0   },
    { label: '23.6%',              price: rangeLow + range * 0.236, pct: 23.6 },
    { label: '38.2%',              price: rangeLow + range * 0.382, pct: 38.2 },
    { label: '50.0% (EQ)',         price: rangeLow + range * 0.5,   pct: 50  },
    { label: '61.8%',              price: rangeLow + range * 0.618, pct: 61.8 },
    { label: '78.6%',              price: rangeLow + range * 0.786, pct: 78.6 },
    { label: '100% (RANGE HIGH)',  price: rangeHigh,               pct: 100 },
  ];

  let zone = 'EQUILIBRIUM';
  if (pct > 50) zone = 'PREMIUM';
  if (pct < 50) zone = 'DISCOUNT';
  if (pct > 78.6) zone = 'EXTREME PREMIUM';
  if (pct < 21.4) zone = 'EXTREME DISCOUNT';

  return { pct: pct.toFixed(1), zone, rangeHigh, rangeLow, range, fibs, currentPrice };
}

/* ── CONFLUENCE SCORING ──────────────────────────────────────── */
function calcConfluenceScore(extStruct, intStruct, obs, fvgs, eqheql, pdArray, currentPrice) {
  let score = 0;
  let longReasons = [];
  let shortReasons = [];

  if (!extStruct) return { score: 0, bias: 'NO TRADE', longReasons, shortReasons };

  const bias = extStruct.externalBias;

  // External structure
  if (bias === 'BULLISH') { score += 2; longReasons.push('External structure BULLISH (HH/HL)'); }
  if (bias === 'BEARISH') { score -= 2; shortReasons.push('External structure BEARISH (LL/LH)'); }

  // Internal structure
  if (intStruct?.status === 'ENTRY_TRIGGER' && bias === 'BULLISH') {
    score += 2; longReasons.push('Internal MSS confirms bullish entry trigger');
  }
  if (intStruct?.status === 'ENTRY_TRIGGER' && bias === 'BEARISH') {
    score -= 2; shortReasons.push('Internal MSS confirms bearish entry trigger');
  }
  if (intStruct?.status === 'PULLBACK' && bias === 'BULLISH') {
    score += 1; longReasons.push('Pullback in progress — waiting for IMSS up');
  }
  if (intStruct?.status === 'PULLBACK' && bias === 'BEARISH') {
    score -= 1; shortReasons.push('Pullback in progress — waiting for IMSS down');
  }

  // Premium / Discount
  if (pdArray) {
    const pctNum = parseFloat(pdArray.pct);
    // Only score discount if genuinely in lower 40% of range (not just below 50%)
    if (pctNum <= 40) {
      score += 1; longReasons.push(`Price in ${pdArray.zone} (${pdArray.pct}% of range) — below 40%`);
    }
    // Only score premium if genuinely in upper 60%+ of range
    if (pctNum >= 60) {
      score -= 1; shortReasons.push(`Price in ${pdArray.zone} (${pdArray.pct}% of range) — above 60%`);
    }
  }

  // Active Order Blocks — quality filtered (impulse >= 2% to count as significant)
  // Bull OB: price must be ABOVE (approaching from above = retest support)
  // or INSIDE the zone right now
  const activeBullOB = obs.filter(o =>
    o.bias === 'BULL' &&
    (o.state === 'UNTESTED' || o.state === 'TESTED') &&
    (o.pos === 'ABOVE' || o.pos === 'INSIDE') &&
    parseFloat(o.impulseSize) >= 2.0
  );
  // Bear OB: price must be BELOW (approaching from below = retest resistance)
  // or INSIDE the zone right now
  const activeBearOB = obs.filter(o =>
    o.bias === 'BEAR' &&
    (o.state === 'UNTESTED' || o.state === 'TESTED') &&
    (o.pos === 'BELOW' || o.pos === 'INSIDE') &&
    parseFloat(o.impulseSize) >= 2.0
  );

  // Age decay: OBs formed recently carry full weight; older ones decay toward
  // a floor of 0.25. createdAt is the candle array index, so a high index means
  // the OB was formed near the end of the window = recent = high weight.
  // Formula: weight = max(0.25, createdAt / totalCandles)
  // OB at index 748/750 = weight 0.997 (~2.0 contrib). At 375/750 = weight 0.5 (1.0 contrib).
  // At index 10/750 = floor 0.25 (0.5 contrib). Score contribution = 2 × weight.
  function obAgeWeight(ob) {
    const total = ob.totalCandles || 750;
    const raw   = ob.createdAt / total;
    return Math.max(0.25, raw);
  }

  if (activeBullOB.length) {
    const bestOB     = activeBullOB[0]; // dedup already sorted newest-first
    const weight     = obAgeWeight(bestOB);
    const contrib    = parseFloat((2 * weight).toFixed(2));
    score           += contrib;
    const agePct     = Math.round(weight * 100);
    longReasons.push(
      `${activeBullOB.length} vol-confirmed bullish OB(s) — impulse ≥2% · age weight ${agePct}% (+${contrib})`
    );
  }
  if (activeBearOB.length) {
    const bestOB     = activeBearOB[0];
    const weight     = obAgeWeight(bestOB);
    const contrib    = parseFloat((2 * weight).toFixed(2));
    score           -= contrib;
    const agePct     = Math.round(weight * 100);
    shortReasons.push(
      `${activeBearOB.length} vol-confirmed bearish OB(s) — impulse ≥2% · age weight ${agePct}% (-${contrib})`
    );
  }

  // Unfilled FVGs — quality filtered (gap >= 0.5% to be meaningful)
  // Bull FVG: gap below price — support magnet, price above it = long confluence
  const bullFVG = fvgs.filter(f =>
    f.bias === 'BULL' && f.fillState !== 'FILLED' &&
    (f.pos === 'ABOVE' || f.pos === 'INSIDE') &&
    parseFloat(f.gapSize) >= 0.5
  );
  // Bear FVG: gap above price — resistance magnet, price below it = short confluence
  const bearFVG = fvgs.filter(f =>
    f.bias === 'BEAR' && f.fillState !== 'FILLED' &&
    (f.pos === 'BELOW' || f.pos === 'INSIDE') &&
    parseFloat(f.gapSize) >= 0.5
  );

  if (bullFVG.length) { score += 1; longReasons.push(`${bullFVG.length} significant bullish FVG(s) — gap ≥0.5%`); }
  if (bearFVG.length) { score -= 1; shortReasons.push(`${bearFVG.length} significant bearish FVG(s) — gap ≥0.5%`); }

  // EQL swept (liquidity taken below = long opportunity)
  const sweptEQL = eqheql?.eql?.filter(e => e.swept);
  const sweptEQH = eqheql?.eqh?.filter(e => e.swept);
  if (sweptEQL?.length) { score += 2; longReasons.push(`${sweptEQL.length} EQL swept — buy-side liquidity likely forming`); }
  if (sweptEQH?.length) { score -= 2; shortReasons.push(`${sweptEQH.length} EQH swept — sell-side liquidity likely forming`); }

  // Score → trade idea
  const absScore = Math.abs(score);
  let tradeIdea, confidence;
  if (score >= 7)        { tradeIdea = 'STRONG LONG';  confidence = 'HIGH'; }
  else if (score >= 6)   { tradeIdea = 'STRONG LONG';  confidence = 'HIGH'; }
  else if (score >= 4)   { tradeIdea = 'LONG WATCH';   confidence = 'MEDIUM'; }
  else if (score >= 2)   { tradeIdea = 'LONG BIAS';    confidence = 'LOW'; }
  else if (score <= -7)  { tradeIdea = 'STRONG SHORT'; confidence = 'HIGH'; }
  else if (score <= -6)  { tradeIdea = 'STRONG SHORT'; confidence = 'HIGH'; }
  else if (score <= -4)  { tradeIdea = 'SHORT WATCH';  confidence = 'MEDIUM'; }
  else if (score <= -2)  { tradeIdea = 'SHORT BIAS';   confidence = 'LOW'; }
  else                   { tradeIdea = 'NO TRADE';      confidence = 'WAIT'; }

  // Entry zone = closest active OB or FVG in trade direction
  let entryZone = null;
  if (score > 0 && activeBullOB.length) {
    entryZone = { high: activeBullOB[0].zoneHigh, low: activeBullOB[0].zoneLow, type: 'Bullish OB' };
  } else if (score > 0 && bullFVG.length) {
    entryZone = { high: bullFVG[0].gapHigh, low: bullFVG[0].gapLow, type: 'Bullish FVG' };
  } else if (score < 0 && activeBearOB.length) {
    entryZone = { high: activeBearOB[0].zoneHigh, low: activeBearOB[0].zoneLow, type: 'Bearish OB' };
  } else if (score < 0 && bearFVG.length) {
    entryZone = { high: bearFVG[0].gapHigh, low: bearFVG[0].gapLow, type: 'Bearish FVG' };
  }

  // ── SL: exact structural level that invalidates the setup ──
  // Long: below the OB low (entry zone bottom) with small buffer
  // Short: above OB high with small buffer
  // Fallback: last swing low/high
  let sl = null;
  if (entryZone && score > 0)  sl = entryZone.low  * 0.998; // 0.2% below OB low
  if (entryZone && score < 0)  sl = entryZone.high * 1.002; // 0.2% above OB high
  if (!sl && score > 0)  sl = extStruct.lastLow?.price  ? extStruct.lastLow.price  * 0.995 : null;
  if (!sl && score < 0)  sl = extStruct.lastHigh?.price ? extStruct.lastHigh.price * 1.005 : null;

  // Entry midpoint
  const entryMid = entryZone ? (entryZone.high + entryZone.low) / 2 : currentPrice;
  const risk     = (sl && entryMid) ? Math.abs(entryMid - sl) : null;

  // ── TPs: SMC structure levels — liquidity, FVGs, swing extremes ──
  // Priority: EQH/EQL → unfilled FVGs → swing highs/lows → P/D range extreme
  let tp1 = null, tp2 = null, tp3 = null;
  let tp1src = '', tp2src = '', tp3src = '';

  // Tolerance: two levels are "the same" if within 0.3% of each other
  const isSame = (a, b) => a && b && Math.abs(a - b) / b < 0.003;

  if (score > 0) {
    // Build a sorted pool of all unique candidate levels above entry
    // Priority order: EQH → FVG bottom → swing highs → R multiples
    const eqhAbove = (eqheql?.eqh || [])
      .filter(e => !e.swept && e.level > entryMid)
      .sort((a, b) => a.level - b.level);

    const fvgAbove = (fvgs || [])
      .filter(f => f.bias === 'BEAR' && f.fillState !== 'FILLED' && f.gapLow > entryMid)
      .sort((a, b) => a.gapLow - b.gapLow);

    const swingHighAbove = (extStruct?.labeledSwings || [])
      .filter(s => s.type === 'high' && s.price > entryMid)
      .sort((a, b) => a.price - b.price);

    // Build candidate pool — each with price and label, sorted ascending
    const candidates = [];
    eqhAbove.forEach(e  => candidates.push({ price: e.level,   src: 'EQH — Buy Side Liquidity' }));
    fvgAbove.forEach(f  => candidates.push({ price: f.gapLow,  src: 'Bearish FVG (fill target)' }));
    swingHighAbove.forEach(s => candidates.push({ price: s.price, src: 'Swing High' }));
    // Deduplicate: remove any candidate within 0.3% of another
    const unique = [];
    candidates.sort((a, b) => a.price - b.price).forEach(c => {
      if (!unique.some(u => isSame(u.price, c.price))) unique.push(c);
    });

    // TP1: nearest unique level above entry
    if (unique[0]) { tp1 = unique[0].price; tp1src = unique[0].src; }
    else if (risk) { tp1 = entryMid + risk * 1.5; tp1src = '1.5R (no structure above)'; }

    // TP2: next unique level strictly above TP1
    const tp2cand = unique.find(u => u.price > (tp1 || entryMid) && !isSame(u.price, tp1));
    if (tp2cand) { tp2 = tp2cand.price; tp2src = tp2cand.src; }
    else if (tp1 && risk) { tp2 = entryMid + risk * 2.5; tp2src = '2.5R (no structure above)'; }

    // TP3: next unique level strictly above TP2, then range high if genuinely further
    const tp3cand = unique.find(u => u.price > (tp2 || tp1 || entryMid) && !isSame(u.price, tp2) && !isSame(u.price, tp1));
    if (tp3cand) {
      tp3 = tp3cand.price; tp3src = tp3cand.src;
    } else if (pdArray?.rangeHigh && pdArray.rangeHigh > (tp2 || tp1 || entryMid) * 1.003
      && !isSame(pdArray.rangeHigh, tp2) && !isSame(pdArray.rangeHigh, tp1)) {
      tp3 = pdArray.rangeHigh; tp3src = 'Range High (Premium Extreme)';
    } else if (tp2 && risk) {
      tp3 = entryMid + risk * 3.5; tp3src = '3.5R (no further structure)';
    }

    // Final guard: ensure strict TP1 < TP2 < TP3
    if (tp2 && tp1 && tp2 <= tp1 * 1.003) tp2 = null;
    if (tp3 && tp2 && tp3 <= tp2 * 1.003) tp3 = null;
    if (tp3 && !tp2 && tp3 <= tp1 * 1.003) tp3 = null;

  } else if (score < 0) {
    const eqlBelow = (eqheql?.eql || [])
      .filter(e => !e.swept && e.level < entryMid)
      .sort((a, b) => b.level - a.level);

    const fvgBelow = (fvgs || [])
      .filter(f => f.bias === 'BULL' && f.fillState !== 'FILLED' && f.gapHigh < entryMid)
      .sort((a, b) => b.gapHigh - a.gapHigh);

    const swingLowBelow = (extStruct?.labeledSwings || [])
      .filter(s => s.type === 'low' && s.price < entryMid)
      .sort((a, b) => b.price - a.price);

    const candidates = [];
    eqlBelow.forEach(e   => candidates.push({ price: e.level,    src: 'EQL — Sell Side Liquidity' }));
    fvgBelow.forEach(f   => candidates.push({ price: f.gapHigh,  src: 'Bullish FVG (fill target)' }));
    swingLowBelow.forEach(s => candidates.push({ price: s.price, src: 'Swing Low' }));
    const unique = [];
    candidates.sort((a, b) => b.price - a.price).forEach(c => {
      if (!unique.some(u => isSame(u.price, c.price))) unique.push(c);
    });

    if (unique[0]) { tp1 = unique[0].price; tp1src = unique[0].src; }
    else if (risk) { tp1 = entryMid - risk * 1.5; tp1src = '1.5R (no structure below)'; }

    const tp2cand = unique.find(u => u.price < (tp1 || entryMid) && !isSame(u.price, tp1));
    if (tp2cand) { tp2 = tp2cand.price; tp2src = tp2cand.src; }
    else if (tp1 && risk) { tp2 = entryMid - risk * 2.5; tp2src = '2.5R (no structure below)'; }

    const tp3cand = unique.find(u => u.price < (tp2 || tp1 || entryMid) && !isSame(u.price, tp2) && !isSame(u.price, tp1));
    if (tp3cand) {
      tp3 = tp3cand.price; tp3src = tp3cand.src;
    } else if (pdArray?.rangeLow && pdArray.rangeLow < (tp2 || tp1 || entryMid) * 0.997
      && !isSame(pdArray.rangeLow, tp2) && !isSame(pdArray.rangeLow, tp1)) {
      tp3 = pdArray.rangeLow; tp3src = 'Range Low (Discount Extreme)';
    } else if (tp2 && risk) {
      tp3 = entryMid - risk * 3.5; tp3src = '3.5R (no further structure)';
    }

    // Final guard: ensure strict TP1 > TP2 > TP3
    if (tp2 && tp1 && tp2 >= tp1 * 0.997) tp2 = null;
    if (tp3 && tp2 && tp3 >= tp2 * 0.997) tp3 = null;
    if (tp3 && !tp2 && tp3 >= tp1 * 0.997) tp3 = null;
  }

  // ── R ratios — calculated from structure levels, not set ──
  const calcR = (tp) => (risk && tp && entryMid) ? (Math.abs(tp - entryMid) / risk).toFixed(2) : null;
  const rr1 = calcR(tp1);
  const rr2 = calcR(tp2);
  const rr3 = calcR(tp3);
  const rr  = rr1; // primary R shown in header

  return {
    score,
    bias: score > 0 ? 'LONG' : score < 0 ? 'SHORT' : 'NEUTRAL',
    tradeIdea,
    confidence,
    longReasons,
    shortReasons,
    entryZone,
    entryMid,
    sl,
    tp1, tp1src, rr1,
    tp2, tp2src, rr2,
    tp3, tp3src, rr3,
    rr,
  };
}

/* ── INJECT LIVE CANDLE ─────────────────────────────────────── */
// The last candle in the array is the current incomplete candle.
// We replace its H/L/C with currentPrice so every state machine
// sees real-time price as the "latest action."
function injectLiveCandle(candles, currentPrice) {
  const live = candles.slice(); // shallow copy
  const last  = { ...live[live.length - 1] };
  // Update close to live price; expand high/low if price moved beyond them
  last.c = currentPrice;
  last.h = Math.max(last.h, currentPrice);
  last.l = Math.min(last.l, currentPrice);
  live[live.length - 1] = last;
  return live;
}

/* ── REAL-TIME LEVEL STATUS ─────────────────────────────────── */
// Given a proposed trade and current price, determine what has
// already happened to the key levels
function auditTradeLevels(confluence, currentPrice) {
  if (!confluence || confluence.bias === 'NEUTRAL') return confluence;

  const c = { ...confluence };
  const isLong  = c.bias === 'LONG';
  const price   = currentPrice;

  // ── ENTRY ZONE STATUS ──
  if (c.entryZone) {
    if (isLong) {
      if (price < c.entryZone.low) {
        // Price hasn't reached entry yet — waiting
        c.entryStatus = 'WAITING';
        c.entryNote   = `Price needs to pull back to ${fPrice(c.entryZone.low)}–${fPrice(c.entryZone.high)}`;
      } else if (price >= c.entryZone.low && price <= c.entryZone.high) {
        // Price is inside entry zone right now — live opportunity
        c.entryStatus = 'LIVE';
        c.entryNote   = '⚡ PRICE IS INSIDE ENTRY ZONE RIGHT NOW';
      } else {
        // Price already blew past the entry zone — missed
        c.entryStatus = 'MISSED';
        c.entryNote   = `Entry zone already passed — price moved to ${fPrice(price)}`;
      }
    } else {
      // Short
      if (price > c.entryZone.high) {
        c.entryStatus = 'WAITING';
        c.entryNote   = `Price needs to rally to ${fPrice(c.entryZone.low)}–${fPrice(c.entryZone.high)}`;
      } else if (price >= c.entryZone.low && price <= c.entryZone.high) {
        c.entryStatus = 'LIVE';
        c.entryNote   = '⚡ PRICE IS INSIDE ENTRY ZONE RIGHT NOW';
      } else {
        c.entryStatus = 'MISSED';
        c.entryNote   = `Entry zone already passed — price moved to ${fPrice(price)}`;
      }
    }
  }

  // ── SL STATUS ──
  if (c.sl) {
    if (isLong  && price <= c.sl) { c.slHit = true; c.entryStatus = 'INVALIDATED'; }
    if (!isLong && price >= c.sl) { c.slHit = true; c.entryStatus = 'INVALIDATED'; }
  }

  // ── TP STATUS ──
  if (c.tp1) {
    if (isLong  && price >= c.tp1) { c.tp1Hit = true; }
    if (!isLong && price <= c.tp1) { c.tp1Hit = true; }
  }
  if (c.tp2) {
    if (isLong  && price >= c.tp2) { c.tp2Hit = true; }
    if (!isLong && price <= c.tp2) { c.tp2Hit = true; }
  }
  if (c.tp3) {
    if (isLong  && price >= c.tp3) { c.tp3Hit = true; }
    if (!isLong && price <= c.tp3) { c.tp3Hit = true; }
  }

  // ── OVERALL TRADE STATUS ──
  if (c.slHit) {
    c.tradeStatus = 'INVALIDATED';
    c.tradeNote   = '✗ SL LEVEL BREACHED — trade invalidated, do not enter';
    c.tradeIdea   = 'NO TRADE';
    c.confidence  = 'WAIT';
  } else if (c.tp3Hit) {
    c.tradeStatus = 'TP3 REACHED';
    c.tradeNote   = '✓ ALL TARGETS HIT — trade complete, look for new setup';
    c.tradeIdea   = 'SETUP COMPLETE';
    c.confidence  = 'WAIT';
  } else if (c.tp2Hit) {
    c.tradeStatus = 'TP2 REACHED';
    c.tradeNote   = '✓ TP2 HIT — trail SL to TP1, targeting TP3';
  } else if (c.tp1Hit) {
    c.tradeStatus = 'TP1 REACHED';
    c.tradeNote   = '✓ TP1 HIT — move SL to breakeven, targeting TP2';
  } else if (c.entryStatus === 'MISSED') {
    c.tradeStatus = 'ENTRY MISSED';
    c.tradeNote   = 'Entry zone passed — wait for price to return or new setup';
    c.tradeIdea   = 'WAIT — ENTRY MISSED';
    c.confidence  = 'WAIT';
  } else if (c.entryStatus === 'LIVE') {
    c.tradeStatus = 'ENTRY NOW';
    c.tradeNote   = '⚡ LIVE OPPORTUNITY — price at entry zone now';
  } else if (c.entryStatus === 'WAITING') {
    c.tradeStatus = 'WAITING';
    c.tradeNote   = 'Setup valid — waiting for price to reach entry zone';
  } else {
    c.tradeStatus = 'MONITORING';
    c.tradeNote   = 'Watching for entry confirmation';
  }

  return c;
}

/* ── MASTER SMC ANALYSIS FUNCTION ───────────────────────────── */
function runSMCAnalysis(candles, currentPrice, tf) {
  if (!candles || candles.length < 10) return null;

  // Resolve adaptive params for this timeframe
  const tfp = getTFParams(tf || '1h');

  // Inject live price into last candle so all state machines
  // see the real-time price as the most recent action
  const liveCandles = injectLiveCandle(candles, currentPrice);

  // External swings: TF-adaptive strength (was hardcoded 2)
  const extSwings  = detectSwings(liveCandles, tfp.swingStrength);
  // Internal swings: TF-adaptive strength, last 20 candles (unchanged window)
  const intCandles = liveCandles.slice(-20);

  const extStruct  = classifyStructure(extSwings, liveCandles, currentPrice);
  const intStruct  = classifyInternalStructure(liveCandles, currentPrice, extStruct?.externalBias || 'RANGING', tfp.internalStrength);
  const obs        = detectOrderBlocks(liveCandles, currentPrice);
  const fvgs       = detectFVGs(liveCandles, currentPrice);
  // Pass TF-adaptive tolerance into EQH/EQL detector (was hardcoded 0.0015)
  const eqheql     = detectEQHEQL(extSwings, liveCandles, currentPrice, tfp.eqTolerance);
  const pdArray    = calcPremiumDiscount(extStruct, currentPrice, liveCandles);

  // Score confluence — then audit all levels against current price
  const rawConfluence  = calcConfluenceScore(extStruct, intStruct, obs, fvgs, eqheql, pdArray, currentPrice);
  const confluence     = auditTradeLevels(rawConfluence, currentPrice);

  return { extStruct, intStruct, obs, fvgs, eqheql, pdArray, confluence };
}



/* ══════════════════════════════════════════════════════════════
   SMC RENDERERS — COIN SCANNER
══════════════════════════════════════════════════════════════ */

const STATE_LABELS = {
  UNTESTED : { text: 'UNTESTED',   cls: 'smc-state-untested'  },
  TESTED   : { text: 'TESTED',     cls: 'smc-state-tested'    },
  MITIGATED: { text: 'MITIGATED',  cls: 'smc-state-mitigated' },
  BROKEN   : { text: 'BROKEN',     cls: 'smc-state-broken'    },
  FLIPPED  : { text: 'FLIPPED',    cls: 'smc-state-flipped'   },
  UNFILLED : { text: 'UNFILLED',   cls: 'smc-state-untested'  },
  PARTIAL  : { text: 'PARTIAL',    cls: 'smc-state-tested'    },
  FILLED   : { text: 'FILLED',     cls: 'smc-state-broken'    },
  INTACT   : { text: 'INTACT',     cls: 'smc-state-untested'  },
  SWEPT    : { text: 'SWEPT ✓',    cls: 'smc-state-swept'     },
};

function smcStateBadge(state) {
  const s = STATE_LABELS[state] || { text: state, cls: '' };
  return `<span class="smc-state-badge ${s.cls}">${s.text}</span>`;
}

function smcDistBadge(dist, pos) {
  const d = parseFloat(dist);
  const sign = d >= 0 ? '+' : '';
  const cls = pos === 'INSIDE' ? 'smc-dist-inside'
    : d > 0 ? 'smc-dist-above' : 'smc-dist-below';
  return pos === 'INSIDE'
    ? `<span class="${cls}">◀ INSIDE</span>`
    : `<span class="${cls}">${sign}${Math.abs(d).toFixed(2)}%</span>`;
}

/* ── EXTERNAL MARKET STRUCTURE CARD ─────────────────────────── */
function renderExternalStructure(extStruct, container) {
  if (!extStruct) {
    container.innerHTML = '<div class="smc-placeholder">Insufficient candle data for structure detection</div>';
    return;
  }

  const biasClass = extStruct.externalBias === 'BULLISH' ? 'bull'
    : extStruct.externalBias === 'BEARISH' ? 'bear' : 'accent';

  const eventsHTML = extStruct.events.map(e => `
    <div class="smc-event-row ${e.type === 'MSS' ? 'smc-mss' : 'smc-bos'}">
      <span class="smc-event-tag ${e.type === 'MSS' ? 'smc-tag-mss' : 'smc-tag-bos'}">${e.type}</span>
      <span class="smc-event-dir ${e.direction === 'BULLISH' ? 'bull' : 'bear'}">${e.direction}</span>
      <span class="smc-event-price">${fPrice(e.level)}</span>
    </div>
  `).join('') || '<div class="smc-placeholder">No active BOS/MSS on this timeframe</div>';

  const swingRows = (extStruct.labeledSwings || []).slice(-6).map(s => {
    const cls = s.label === 'HH' || s.label === 'HL' ? 'bull'
      : s.label === 'LL' || s.label === 'LH' ? 'bear' : 'accent';
    return `<div class="smc-swing-pill ${cls}">${s.label}</div>`;
  }).join('');

  container.innerHTML = `
    <div class="smc-bias-header">
      <span class="smc-section-label">EXTERNAL BIAS</span>
      <span class="smc-bias-badge ${biasClass}">${extStruct.externalBias}</span>
    </div>
    <div class="smc-swing-trail">${swingRows}</div>
    <div class="smc-divider"></div>
    <div class="smc-section-label" style="margin-bottom:6px;">STRUCTURE EVENTS</div>
    ${eventsHTML}
    <div class="smc-divider"></div>
    <div class="smc-level-row">
      <span class="smc-level-tag accent">KEY HIGH</span>
      <span class="smc-level-price">${fPrice(extStruct.lastHigh?.price)}</span>
    </div>
    <div class="smc-level-row">
      <span class="smc-level-tag accent">KEY LOW</span>
      <span class="smc-level-price">${fPrice(extStruct.lastLow?.price)}</span>
    </div>
  `;
}

/* ── INTERNAL MARKET STRUCTURE CARD ─────────────────────────── */
function renderInternalStructure(intStruct, container) {
  if (!intStruct) {
    container.innerHTML = '<div class="smc-placeholder">Insufficient data for internal structure</div>';
    return;
  }

  const biasClass = intStruct.internalBias === 'BULLISH' ? 'bull'
    : intStruct.internalBias === 'BEARISH' ? 'bear' : 'accent';

  const statusClass = intStruct.status === 'ENTRY_TRIGGER' ? 'smc-status-entry'
    : intStruct.status === 'PULLBACK' ? 'smc-status-pullback' : 'smc-status-neutral';

  const iEventsHTML = intStruct.iEvents.map(e => `
    <div class="smc-event-row ${e.type === 'IMSS' ? 'smc-mss' : 'smc-bos'}">
      <span class="smc-event-tag ${e.type === 'IMSS' ? 'smc-tag-mss' : 'smc-tag-bos'}">${e.type}</span>
      <span class="smc-event-dir ${e.direction === 'BULLISH' ? 'bull' : 'bear'}">${e.direction}</span>
      <span class="smc-event-price">${fPrice(e.level)}</span>
    </div>
  `).join('') || '<div class="smc-placeholder">No internal BOS/MSS detected</div>';

  container.innerHTML = `
    <div class="smc-bias-header">
      <span class="smc-section-label">INTERNAL BIAS</span>
      <span class="smc-bias-badge ${biasClass}">${intStruct.internalBias}</span>
    </div>
    <div class="smc-status-banner ${statusClass}">${intStruct.status.replace('_', ' ')}</div>
    <div class="smc-status-desc">${intStruct.statusDesc}</div>
    <div class="smc-divider"></div>
    <div class="smc-section-label" style="margin-bottom:6px;">INTERNAL EVENTS</div>
    ${iEventsHTML}
    <div class="smc-divider"></div>
    <div class="smc-level-row">
      <span class="smc-level-tag bull">LAST INT HIGH</span>
      <span class="smc-level-price">${fPrice(intStruct.lastIHigh?.price)}</span>
    </div>
    <div class="smc-level-row">
      <span class="smc-level-tag bear">LAST INT LOW</span>
      <span class="smc-level-price">${fPrice(intStruct.lastILow?.price)}</span>
    </div>
  `;
}

/* ── ORDER BLOCKS CARD ──────────────────────────────────────── */
function renderOrderBlocks(obs, container) {
  if (!obs || !obs.length) {
    container.innerHTML = '<div class="smc-placeholder">No active order blocks detected</div>';
    return;
  }

  container.innerHTML = obs.map(ob => {
    const biasLabel = ob.bias === 'BULL' ? 'BULLISH OB' : 'BEARISH OB';
    const biasCls   = ob.bias === 'BULL' ? 'bull' : 'bear';
    const sl = STATE_LABELS[ob.state] || { text: ob.state, cls: '' };

    let rtLabel = '';
    let cardExtra = '';
    if (ob.pos === 'INSIDE') {
      rtLabel = '<span class="smc-approaching">⚡ PRICE INSIDE OB NOW</span>';
      cardExtra = 'smc-ob-active';
    } else if (ob.approaching) {
      rtLabel = '<span class="smc-approaching">◷ APPROACHING</span>';
    } else if (ob.bias === 'BULL' && ob.pos === 'ABOVE') {
      const distNum = Math.abs(parseFloat(ob.dist));
      rtLabel = distNum > 5
        ? '<span class="smc-ob-stale">↑ Price moved above — monitor for retest</span>'
        : '<span class="smc-approaching">↑ Above — watching for retest</span>';
    } else if (ob.bias === 'BEAR' && ob.pos === 'BELOW') {
      const distNum = Math.abs(parseFloat(ob.dist));
      rtLabel = distNum > 5
        ? '<span class="smc-ob-stale">↓ Price moved below — monitor for retest</span>'
        : '<span class="smc-approaching">↓ Below — watching for retest</span>';
    }

    return `
      <div class="smc-ob-card ${ob.bias === 'BULL' ? 'smc-ob-bull' : 'smc-ob-bear'} ${cardExtra}">
        <div class="smc-ob-header">
          <span class="smc-ob-label ${biasCls}">${biasLabel}</span>
          <span class="smc-state-badge ${sl.cls}">${sl.text}</span>
          ${rtLabel}
        </div>
        <div class="smc-ob-range">${fPrice(ob.zoneLow)} — ${fPrice(ob.zoneHigh)}</div>
        <div class="smc-ob-meta">
          <span>DIST: ${smcDistBadge(ob.dist, ob.pos)}</span>
          <span>IMPULSE: ${ob.impulseSize}%</span>
          <span>POS: <span class="accent">${ob.pos}</span></span>
        </div>
      </div>
    `;
  }).join('');
}

/* ── FVG CARD ───────────────────────────────────────────────── */
function renderFVGs(fvgs, container) {
  if (!fvgs || !fvgs.length) {
    container.innerHTML = '<div class="smc-placeholder">No active fair value gaps</div>';
    return;
  }

  container.innerHTML = fvgs.map(f => {
    const biasLabel = f.bias === 'BULL' ? 'BULLISH FVG' : 'BEARISH FVG';
    const biasCls   = f.bias === 'BULL' ? 'bull' : 'bear';
    const sl = STATE_LABELS[f.fillState] || { text: f.fillState, cls: '' };
    const distSign  = f.dist > 0 ? '+' : '';

    // Real-time status
    let rtLabel = '';
    if (f.pos === 'INSIDE') {
      rtLabel = '<span class="smc-approaching">⚡ PRICE FILLING GAP NOW</span>';
    } else if (f.fillState === 'FILLED') {
      rtLabel = '<span class="smc-ob-stale">✓ GAP FILLED — no longer active</span>';
    } else if (Math.abs(f.dist) <= 1.5) {
      rtLabel = '<span class="smc-approaching">◷ APPROACHING — within 1.5%</span>';
    } else if (f.bias === 'BULL' && f.pos === 'ABOVE') {
      rtLabel = '<span class="smc-ob-stale">↑ Price above gap — awaiting retest</span>';
    } else if (f.bias === 'BEAR' && f.pos === 'BELOW') {
      rtLabel = '<span class="smc-ob-stale">↓ Price below gap — awaiting retest</span>';
    }

    return `
      <div class="smc-fvg-card ${f.bias === 'BULL' ? 'smc-ob-bull' : 'smc-ob-bear'} ${f.fillState === 'FILLED' ? 'smc-level-stale' : ''}">
        <div class="smc-ob-header">
          <span class="smc-ob-label ${biasCls}">${biasLabel}</span>
          <span class="smc-state-badge ${sl.cls}">${sl.text}</span>
          ${rtLabel}
        </div>
        <div class="smc-ob-range">${fPrice(f.gapLow)} — ${fPrice(f.gapHigh)}</div>
        <div class="smc-ob-meta">
          <span>DIST: ${distSign}${Math.abs(f.dist).toFixed(2)}%</span>
          <span>GAP SIZE: ${f.gapSize}%</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ── EQH/EQL CARD ───────────────────────────────────────────── */
function renderEQHEQL(eqheql, container) {
  if (!eqheql || (!eqheql.eqh.length && !eqheql.eql.length)) {
    container.innerHTML = '<div class="smc-placeholder">No equal highs or lows detected</div>';
    return;
  }

  const eqhHTML = eqheql.eqh.map(e => `
    <div class="smc-level-row">
      <span class="smc-level-tag bear">EQH</span>
      <span class="smc-level-price">${fPrice(e.level)}</span>
      <span class="smc-level-touches">${e.touches}x</span>
      <span class="smc-state-badge ${e.swept ? 'smc-state-swept' : 'smc-state-untested'}">${e.swept ? 'SWEPT' : 'INTACT'}</span>
      <span class="smc-level-dist ${e.dist < 0 ? 'bull' : 'bear'}">${e.dist > 0 ? '+' : ''}${e.dist.toFixed(2)}%</span>
    </div>
  `).join('');

  const eqlHTML = eqheql.eql.map(e => `
    <div class="smc-level-row">
      <span class="smc-level-tag bull">EQL</span>
      <span class="smc-level-price">${fPrice(e.level)}</span>
      <span class="smc-level-touches">${e.touches}x</span>
      <span class="smc-state-badge ${e.swept ? 'smc-state-swept' : 'smc-state-untested'}">${e.swept ? 'SWEPT' : 'INTACT'}</span>
      <span class="smc-level-dist ${e.dist > 0 ? 'bull' : 'bear'}">${e.dist > 0 ? '+' : ''}${e.dist.toFixed(2)}%</span>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="smc-section-label" style="margin-bottom:6px;">EQUAL HIGHS — BUY SIDE LIQUIDITY</div>
    ${eqhHTML || '<div class="smc-placeholder">None detected</div>'}
    <div class="smc-divider"></div>
    <div class="smc-section-label" style="margin-bottom:6px;">EQUAL LOWS — SELL SIDE LIQUIDITY</div>
    ${eqlHTML || '<div class="smc-placeholder">None detected</div>'}
  `;
}

/* ── PREMIUM / DISCOUNT CARD ────────────────────────────────── */
function renderPremiumDiscount(pdArray, container) {
  if (!pdArray) {
    container.innerHTML = '<div class="smc-placeholder">Cannot calculate — no clear swing range</div>';
    return;
  }

  const pct = parseFloat(pdArray.pct);
  const zoneClass = pct >= 50 ? 'bear' : 'bull';

  const fibHTML = pdArray.fibs.map(f => {
    const isCurrentFib = Math.abs(((pdArray.currentPrice - f.price) / pdArray.currentPrice) * 100) < 2;
    return `
      <div class="smc-fib-row ${isCurrentFib ? 'smc-fib-current' : ''}">
        <span class="smc-fib-label">${f.label}</span>
        <span class="smc-fib-price">${fPrice(f.price)}</span>
        ${isCurrentFib ? '<span class="smc-fib-here">◀ PRICE</span>' : ''}
      </div>
    `;
  }).join('');

  // Visual meter
  const meterPct = Math.min(Math.max(pct, 0), 100);

  container.innerHTML = `
    <div class="smc-pd-header">
      <span class="smc-section-label">CURRENT ZONE</span>
      <span class="smc-bias-badge ${zoneClass}">${pdArray.zone}</span>
    </div>
    <div class="smc-pd-meter-wrap">
      <span class="smc-pd-label-l">DISCOUNT</span>
      <div class="smc-pd-meter">
        <div class="smc-pd-eq-line"></div>
        <div class="smc-pd-cursor" style="left:${meterPct}%"></div>
        <div class="smc-pd-fill-disc" style="width:${Math.min(meterPct, 50)}%"></div>
        <div class="smc-pd-fill-prem" style="left:50%;width:${Math.max(meterPct - 50, 0)}%"></div>
      </div>
      <span class="smc-pd-label-r">PREMIUM</span>
    </div>
    <div class="smc-pd-pct ${zoneClass}">${pct}% OF RANGE</div>
    <div class="smc-divider"></div>
    <div class="smc-section-label" style="margin-bottom:6px;">FIBONACCI ARRAY</div>
    <div class="smc-fib-list">${fibHTML}</div>
  `;
}

/* ── CONFLUENCE CARD ────────────────────────────────────────── */
function renderConfluence(confluence, container, ticker, tf, currentPrice) {
  if (!confluence) {
    container.innerHTML = '<div class="smc-placeholder">Cannot score — insufficient data</div>';
    return;
  }

  const biasClass = confluence.bias === 'LONG' ? 'bull'
    : confluence.bias === 'SHORT' ? 'bear' : 'accent';

  const confClass = confluence.confidence === 'HIGH' ? 'smc-conf-high'
    : confluence.confidence === 'MEDIUM' ? 'smc-conf-med' : 'smc-conf-low';

  // ── TRADE STATUS BANNER ──
  const statusMap = {
    'ENTRY NOW'       : { cls: 'smc-status-live',        icon: '⚡' },
    'WAITING'         : { cls: 'smc-status-waiting',     icon: '◷' },
    'TP1 REACHED'     : { cls: 'smc-status-tp1',         icon: '✓' },
    'TP2 REACHED'     : { cls: 'smc-status-tp2',         icon: '✓✓' },
    'TP3 REACHED'     : { cls: 'smc-status-tp3',         icon: '✓✓✓' },
    'ENTRY MISSED'    : { cls: 'smc-status-missed',      icon: '↷' },
    'INVALIDATED'     : { cls: 'smc-status-invalidated', icon: '✗' },
    'SETUP COMPLETE'  : { cls: 'smc-status-complete',    icon: '★' },
    'MONITORING'      : { cls: 'smc-status-monitoring',  icon: '◉' },
  };
  const st = statusMap[confluence.tradeStatus] || { cls: 'smc-status-monitoring', icon: '◉' };

  const statusBannerHTML = confluence.tradeStatus ? `
    <div class="smc-realtime-banner ${st.cls}">
      <span class="smc-rt-icon">${st.icon}</span>
      <div class="smc-rt-text">
        <div class="smc-rt-status">${confluence.tradeStatus}</div>
        <div class="smc-rt-note">${confluence.tradeNote || ''}</div>
      </div>
    </div>
  ` : '';

  // ── ENTRY STATUS BADGE ──
  const entryStatusCls = {
    'LIVE'       : 'smc-entry-live',
    'WAITING'    : 'smc-entry-waiting',
    'MISSED'     : 'smc-entry-missed',
    'INVALIDATED': 'smc-entry-invalidated',
  }[confluence.entryStatus] || '';

  // ── TP ROWS with hit indicators and source labels ──
  function tpRow(label, price, rr, src, hit, extra) {
    if (!price) return '';
    const hitBadge = hit ? `<span class="smc-tp-hit">✓ HIT</span>` : '';
    const cls = hit ? 'smc-trade-val bull smc-tp-hit-val' : 'smc-trade-val bull';
    const rrBadge = rr ? `<span class="smc-tp-rr">1:${rr}R</span>` : '';
    const srcLabel = src ? `<span class="smc-tp-src">${src}</span>` : '';
    return `<div class="smc-trade-row ${hit ? 'smc-row-hit' : ''}">
      <span class="smc-trade-label">${label}</span>
      <span class="${cls}">${fPrice(price)}</span>
      ${rrBadge}
      ${hitBadge}
      ${srcLabel}
      ${extra || ''}
    </div>`;
  }

  // SL row
  const slCls = confluence.slHit ? 'smc-trade-val bear smc-tp-hit-val' : 'smc-trade-val bear';
  const slHTML = confluence.sl ? `
    <div class="smc-trade-row ${confluence.slHit ? 'smc-row-invalidated' : ''}">
      <span class="smc-trade-label">STOP LOSS</span>
      <span class="${slCls}">${fPrice(confluence.sl)}</span>
      ${confluence.slHit ? '<span class="smc-sl-hit">✗ HIT — INVALIDATED</span>' : ''}
    </div>` : '';

  // Entry row
  const entryHTML = confluence.entryZone ? `
    <div class="smc-trade-row">
      <span class="smc-trade-label">ENTRY ZONE</span>
      <span class="smc-trade-val accent">${fPrice(confluence.entryZone.low)} — ${fPrice(confluence.entryZone.high)}</span>
      <span class="smc-trade-type">${confluence.entryZone.type}</span>
      ${confluence.entryStatus ? `<span class="smc-entry-badge ${entryStatusCls}">${confluence.entryStatus}</span>` : ''}
    </div>
    ${confluence.entryNote ? `<div class="smc-entry-note">${confluence.entryNote}</div>` : ''}
  ` : '';

  const tp1HTML = tpRow(
    'TP 1', confluence.tp1, confluence.rr1, confluence.tp1src, confluence.tp1Hit,
    confluence.tp1Hit && !confluence.tp2Hit ? '<span class="smc-tp-action">→ Trail SL to entry</span>' : ''
  );
  const tp2HTML = tpRow(
    'TP 2', confluence.tp2, confluence.rr2, confluence.tp2src, confluence.tp2Hit,
    confluence.tp2Hit && !confluence.tp3Hit ? '<span class="smc-tp-action">→ Trail SL to TP1</span>' : ''
  );
  const tp3HTML = tpRow('TP 3', confluence.tp3, confluence.rr3, confluence.tp3src, confluence.tp3Hit, '');

  // Analysis reasons
  const reasonsHTML = [
    ...confluence.longReasons.map(r  => `<div class="smc-reason bull">▲ ${r}</div>`),
    ...confluence.shortReasons.map(r => `<div class="smc-reason bear">▼ ${r}</div>`),
  ].join('');

  // Build copy signal text
  const signalLines = [
    `═══ CRYPTEX SMC SIGNAL ═══`,
    `COIN: ${ticker || '—'} | TF: ${tf || '—'} | ${new Date().toUTCString()}`,
    `CURRENT PRICE: ${fPrice(currentPrice)}`,
    ``,
    `TRADE STATUS: ${confluence.tradeStatus || '—'}`,
    confluence.tradeNote ? `NOTE: ${confluence.tradeNote}` : '',
    ``,
    `BIAS: ${confluence.tradeIdea} | SCORE: ${confluence.score > 0 ? '+' : ''}${confluence.score} | ${confluence.confidence} PROBABILITY`,
    ``,
    `ANALYSIS:`,
    ...confluence.longReasons.map(r  => `  ▲ ${r}`),
    ...confluence.shortReasons.map(r => `  ▼ ${r}`),
    ``,
    confluence.entryZone ? `ENTRY ZONE:   ${fPrice(confluence.entryZone.low)} — ${fPrice(confluence.entryZone.high)} (${confluence.entryZone.type})` : '',
    confluence.entryNote ? `ENTRY STATUS: ${confluence.entryNote}` : '',
    confluence.sl        ? `STOP LOSS:    ${fPrice(confluence.sl)}${confluence.slHit ? ' ← HIT/INVALIDATED' : ''}` : '',
    confluence.tp1 ? `TP 1:         ${fPrice(confluence.tp1)}${confluence.rr1 ? ` (1:${confluence.rr1}R)` : ''}${confluence.tp1src ? ` — ${confluence.tp1src}` : ''}${confluence.tp1Hit ? ' ← REACHED' : ''}` : '',
    confluence.tp2 ? `TP 2:         ${fPrice(confluence.tp2)}${confluence.rr2 ? ` (1:${confluence.rr2}R)` : ''}${confluence.tp2src ? ` — ${confluence.tp2src}` : ''}${confluence.tp2Hit ? ' ← REACHED' : ''}` : '',
    confluence.tp3 ? `TP 3:         ${fPrice(confluence.tp3)}${confluence.rr3 ? ` (1:${confluence.rr3}R)` : ''}${confluence.tp3src ? ` — ${confluence.tp3src}` : ''}${confluence.tp3Hit ? ' ← REACHED' : ''}` : '',
    ``,
    `NOT FINANCIAL ADVICE — CRYPTEX v2.0 SMC EDITION`,
  ].filter(l => l !== '').join('\n');

  container.innerHTML = `
    <div class="smc-conf-main">
      <div class="smc-conf-score-wrap">
        <div class="smc-conf-score ${biasClass}">${confluence.score > 0 ? '+' : ''}${confluence.score}</div>
        <div class="smc-conf-label">SCORE</div>
      </div>
      <div class="smc-conf-idea-wrap">
        <div class="smc-conf-idea ${biasClass}">${confluence.tradeIdea}</div>
        <div class="smc-conf-badge ${confClass}">${confluence.confidence} PROBABILITY</div>
      </div>
      <div class="smc-conf-price-wrap">
        <div class="smc-conf-cur-label">CURRENT PRICE</div>
        <div class="smc-conf-cur-price">${fPrice(currentPrice)}</div>
      </div>
      <button class="smc-copy-btn" id="smc-copy-signal-btn">⎘ COPY SIGNAL</button>
    </div>

    ${statusBannerHTML}

    <div class="smc-divider"></div>
    <div class="smc-reasons">${reasonsHTML || '<div class="smc-placeholder">Neutral — no clear setup</div>'}</div>

    ${entryHTML || slHTML || tp1HTML ? `
      <div class="smc-divider"></div>
      <div class="smc-trade-idea">
        ${entryHTML}
        ${slHTML}
        <div class="smc-tp-row">
          ${tp1HTML}${tp2HTML}${tp3HTML}
        </div>
      </div>
    ` : ''}
  `;

  // Copy button handler
  const copyBtn = container.querySelector('#smc-copy-signal-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const doFallback = () => {
        const ta = document.createElement('textarea');
        ta.value = signalLines;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      };
      const markCopied = () => {
        copyBtn.textContent = '✓ COPIED';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = '⎘ COPY SIGNAL';
          copyBtn.classList.remove('copied');
        }, 2000);
      };
      SFX.play('copy');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(signalLines).then(markCopied).catch(() => { doFallback(); markCopied(); });
      } else {
        doFallback(); markCopied();
      }
    });
  }
}

/* ── MASTER SMC RENDER FOR COIN SCANNER ─────────────────────── */
function renderSMCCoin(smc, ticker, tf, currentPrice) {
  if (!smc) return;
  renderExternalStructure(smc.extStruct, $('smc-ext-structure'));
  renderInternalStructure(smc.intStruct, $('smc-int-structure'));
  renderOrderBlocks(smc.obs,             $('smc-orderblocks'));
  renderFVGs(smc.fvgs,                   $('smc-fvgs'));
  renderEQHEQL(smc.eqheql,              $('smc-eqheql'));
  renderPremiumDiscount(smc.pdArray,    $('smc-pd'));
  renderConfluence(smc.confluence,      $('smc-confluence'), ticker, tf, currentPrice);
}



/* ══════════════════════════════════════════════════════════════
   SMC MARKET SCANNER ENGINE
   Fetches all pairs, runs SMC analysis on each with klines,
   surfaces only actionable setups (score >= 4 or <= -4)
══════════════════════════════════════════════════════════════ */

async function fetchKlineQuick(symbol, tf, limit = 750) {
  try {
    const interval = TF_MAP.binance[tf] || '1h';
    const url = `${CFG.BINANCE_FAPI}/klines?symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const res = await fetchWithTimeout(url, 8000);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 10) {
      return data.map(c => ({
        t: c[0], o: parseFloat(c[1]), h: parseFloat(c[2]),
        l: parseFloat(c[3]), c: parseFloat(c[4]), v: parseFloat(c[5]),
      }));
    }
  } catch (_) {}
  // Bybit fallback
  try {
    const interval = TF_MAP.bybit[tf] || '60';
    const url = `${CFG.BYBIT_API}/kline?category=linear&symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
    const res = await fetchWithTimeout(url, 8000);
    const data = await res.json();
    const list = data?.result?.list;
    if (Array.isArray(list) && list.length > 10) {
      return list.reverse().map(c => ({
        t: parseInt(c[0]), o: parseFloat(c[1]), h: parseFloat(c[2]),
        l: parseFloat(c[3]), c: parseFloat(c[4]), v: parseFloat(c[5]),
      }));
    }
  } catch (_) {}
  return null;
}

async function runSMCMarketScan() {
  const tf    = STATE.smcScanTf;
  const htf   = HTF_MAP[tf] || tf;
  const source = STATE.smcScanSource;
  const isSameTF = tf === htf;

  $('smc-scan-empty').style.display        = 'none';
  $('smc-heatmap-wrapper').style.display   = 'none';
  $('smc-scan-stats-bar').style.display    = 'none';
  closeSMCDrawer(); // close modal if open
  $('smc-scan-loading').style.display       = 'flex';
  $('smc-scan-loader-text').textContent     = `FETCHING ${source.toUpperCase()} PAIRS...`;
  $('smc-scan-btn').classList.add('loading');
  setStatus('loading', 'SMC SCANNING');
  SFX.play('scan_start');

  try {
    let allCoins;
    try {
      allCoins = source === 'binance' ? await fetchAllBinance() : await fetchAllBybit();
    } catch (_) {
      allCoins = source === 'binance' ? await fetchAllBybit() : await fetchAllBinance();
    }

    // No volume filter — scan ALL pairs from the exchange, sorted by volume desc
    const liquid = allCoins
      .filter(c => c.lastPrice > 0)  // only exclude dead/zero-price pairs
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    $('smc-scan-loader-text').textContent =
      `SCANNING ${liquid.length} PAIRS — ${tf.toUpperCase()} ENTRY + ${htf.toUpperCase()} HTF CONFIRMATION...`;

    const results = [];
    let processed = 0;
    let skippedHTF = 0;

    for (let i = 0; i < liquid.length; i += 10) {
      const batch = liquid.slice(i, i + 10);
      const batchResults = await Promise.allSettled(
        batch.map(async coin => {
          try {
            const candles = await fetchKlineQuick(coin.symbol, tf);
            if (!candles || candles.length < 20) return null;

            // HTF candles — independent fetch with 300-bar window.
            // 300 bars of 4H = ~50 days. 300 bars of 1D = ~10 months.
            // This is genuinely independent history, not a slice of the LTF window.
            let htfCandles = null;
            if (!isSameTF) htfCandles = await fetchKlineQuick(coin.symbol, htf, 300);

            const smc = runSMCAnalysis(candles, coin.lastPrice, tf);
            if (!smc) return null;

            const absScore = Math.abs(smc.confluence.score);
            if (absScore < 4) return null;

            // Filter out non-actionable statuses
            const status = smc.confluence.tradeStatus;
            if (status === 'ENTRY MISSED' || status === 'INVALIDATED' ||
                status === 'SETUP COMPLETE' || status === 'TP3 REACHED') return null;

            // HTF structure confirmation — requires ≥6 clean swings on the HTF
            // dataset to be trusted. If insufficient swings, report UNCLEAR and
            // pass through rather than falsely confirming or falsely rejecting.
            let htfBias = '—';
            let htfConfirmed = true;
            if (htfCandles && htfCandles.length >= 20) {
              const htfTfp    = getTFParams(htf);
              const htfSwings = detectSwings(htfCandles, htfTfp.swingStrength);
              if (htfSwings.length < 6) {
                // Not enough HTF structure to confirm or reject — pass through
                htfBias = 'HTF UNCLEAR';
              } else {
                const htfSmc = runSMCAnalysis(htfCandles, coin.lastPrice, htf);
                htfBias = htfSmc?.extStruct?.externalBias || 'HTF UNCLEAR';
                const ltfBias = smc.extStruct?.externalBias;
                // Reject only if BOTH sides have unambiguous opposing bias.
                // RANGING or UNCLEAR on either side = no conviction to reject.
                if (htfBias !== 'RANGING' && htfBias !== 'HTF UNCLEAR' &&
                    ltfBias !== 'RANGING' && htfBias !== ltfBias) {
                  htfConfirmed = false;
                  skippedHTF++;
                }
              }
            }
            if (!htfConfirmed) return null;

            // Use extStruct bias as primary — it's the structural truth
            // confluence.bias is scoring-derived, extStruct.externalBias is data-derived
            const structBias = smc.extStruct?.externalBias || '—';
            return {
              symbol      : coin.symbol,
              price       : coin.lastPrice,
              change24h   : coin.changePct24h,
              quoteVolume : coin.quoteVolume,
              score       : smc.confluence.score,
              bias        : structBias,
              confBias    : smc.confluence.bias,
              tradeIdea   : smc.confluence.tradeIdea,
              confidence  : smc.confluence.confidence,
              tradeStatus : smc.confluence.tradeStatus || '—',
              extBias     : structBias,
              htfBias,
              intStatus   : smc.intStruct?.status || '—',
              pdZone      : smc.pdArray?.zone || '—',
              pdPct       : smc.pdArray?.pct  || '—',
              entryZone   : smc.confluence.entryZone,
              sl          : smc.confluence.sl,
              tp1         : smc.confluence.tp1,
              rr1         : smc.confluence.rr1,
              scanTf      : tf,   // freeze TF at scan time — drawer always shows correct TF
              scanHtf     : htf,
              smc,
            };
          } catch (_) { return null; }
        })
      );
      batchResults.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
      processed += batch.length;
      $('smc-scan-loader-text').textContent =
        `SCANNED ${processed}/${liquid.length} — ${results.length} CONFIRMED SETUPS (${skippedHTF} rejected by HTF)...`;
      await new Promise(res => setTimeout(res, 150));
    }

    STATE.smcScanResults = results;

    // ── MACRO REGIME NORMALISATION (Fix 5) ────────────────────────
    // Compute bullish ratio across ALL results that passed quality filters.
    // When the market is strongly one-directional, raise the score threshold
    // so only genuinely high-conviction setups qualify in that direction —
    // preventing the scanner from flooding with beta-driven signals.
    //
    // Regime index = % of results with BULLISH external structure.
    // ≥70% BULL → MACRO BULL regime → tighten LONG threshold to ≥5
    // ≤30% BULL → MACRO BEAR regime → tighten SHORT threshold to ≤-5
    // Between 30–70% → NEUTRAL regime → standard thresholds apply

    let regimeLabel  = 'NEUTRAL';
    let regimeCls    = '';
    let longThreshold  = 4;   // default: score ≥4 qualifies as LONG WATCH
    let shortThreshold = -4;  // default: score ≤-4 qualifies as SHORT WATCH

    if (results.length >= 5) {
      const bullCount = results.filter(r => r.extBias === 'BULLISH').length;
      const bullPct   = (bullCount / results.length) * 100;

      if (bullPct >= 70) {
        regimeLabel    = `MACRO BULL (${Math.round(bullPct)}% BULLISH)`;
        regimeCls      = 'bull';
        longThreshold  = 5;  // raise bar — need more than just beta to qualify
      } else if (bullPct <= 30) {
        regimeLabel    = `MACRO BEAR (${Math.round(100 - bullPct)}% BEARISH)`;
        regimeCls      = 'bear';
        shortThreshold = -5; // raise bar — need more than just beta to qualify
      } else {
        regimeLabel = `NEUTRAL (${Math.round(bullPct)}% BULL / ${Math.round(100 - bullPct)}% BEAR)`;
        regimeCls   = '';
      }
    }

    // Re-filter results using regime-adjusted thresholds.
    // Coins that only passed due to beta now fall below the raised bar.
    const filteredResults = results.filter(r => {
      const s = r.score;
      if (s > 0) return s >= longThreshold;
      if (s < 0) return Math.abs(s) >= Math.abs(shortThreshold);
      return false;
    });

    // Store regime context on each result for drawer display
    filteredResults.forEach(r => { r.regimeLabel = regimeLabel; });

    STATE.smcScanResults = filteredResults;

    $('smc-scan-loading').style.display   = 'none';
    $('smc-scan-stats-bar').style.display = 'flex';
    $('smc-scan-count').textContent       = filteredResults.length + ' SETUPS';
    $('smc-scan-scanned').textContent     = liquid.length + ' PAIRS';
    $('smc-scan-tf-badge').textContent    = `${tf.toUpperCase()} + ${htf.toUpperCase()} HTF`;

    // Regime badge — colour-coded
    const regimeBadgeEl = $('smc-scan-regime');
    regimeBadgeEl.textContent = regimeLabel;
    regimeBadgeEl.className   = 'source-badge ' + regimeCls;

    $('smc-scan-updated').textContent = nowStr();

    if (filteredResults.length === 0) {
      $('smc-scan-empty').style.display = 'flex';
      $('smc-scan-empty').querySelector('.empty-title').textContent = 'NO CONFIRMED SETUPS';
      $('smc-scan-empty').querySelector('.empty-sub').textContent   =
        regimeCls
          ? `${regimeLabel} — thresholds raised to filter beta. Try a different TF or wait for structure divergence.`
          : `No coins passed HTF + quality filters on ${tf.toUpperCase()}. Market may be ranging — try a different TF.`;
    } else {
      $('smc-heatmap-wrapper').style.display = 'block';
      renderSMCScanTable(filteredResults);
    }
    setStatus('ok', 'SMC SCAN COMPLETE');
    SFX.play('scan_complete');
  } catch(e) {
    SFX.play('error');
    $('smc-scan-loading').style.display = 'none';
    $('smc-scan-empty').style.display   = 'flex';
    $('smc-scan-empty').querySelector('.empty-title').textContent = 'SCAN FAILED';
    $('smc-scan-empty').querySelector('.empty-sub').textContent   = e.message;
    setStatus('error', 'ERROR');
  }
  $('smc-scan-btn').classList.remove('loading');
}

function getActiveFilter() {
  const active = document.querySelector('.smc-filter-btn.active');
  return active ? active.dataset.filter : 'all';
}

function applySmcFilter(results) {
  const filter = getActiveFilter();
  if (filter === 'all')   return results;
  if (filter === 'long')  return results.filter(r =>
    r.bias === 'LONG' && Math.abs(r.score) >= 6);
  if (filter === 'short') return results.filter(r =>
    r.bias === 'SHORT' && Math.abs(r.score) >= 6);
  if (filter === 'watch') return results.filter(r =>
    Math.abs(r.score) < 6);
  return results;
}

function initSMCScanFilters() {
  document.querySelectorAll('.smc-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.smc-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      SFX.play('filter_click');
      if (STATE.smcScanResults.length) renderSMCScanTable(STATE.smcScanResults);
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   SMC HEATMAP RENDERER
══════════════════════════════════════════════════════════════ */
function renderSMCScanTable(results) {
  const filtered = applySmcFilter(results);
  const sorted = [...filtered].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const strong = sorted.filter(c => Math.abs(c.score) >= 6);
  const watch  = sorted.filter(c => Math.abs(c.score) < 6);

  const strongEl = $('smc-heatmap-strong');
  const watchEl  = $('smc-heatmap-watch');

  function buildSection(el, list, label) {
    if (!list.length) { el.innerHTML = ''; return; }

    el.innerHTML = `<div class="heatmap-section-label">${label} — ${list.length}</div>
    <div class="heatmap-grid">
      ${list.map(c => {
        // Tile color driven by confluence scoring bias (confBias)
        // confBias = LONG/SHORT/NEUTRAL based on actual score direction
        // structBias (c.bias) = external structure = can be BULLISH even for short setups
        const isShort  = c.score < 0;  // score negative = short setup
        const isLong   = c.score > 0;  // score positive = long setup
        const isWatch  = Math.abs(c.score) < 6;
        const isLive   = c.tradeStatus === 'ENTRY NOW';
        const isTp1    = c.tradeStatus === 'TP1 REACHED';
        const isTp2    = c.tradeStatus === 'TP2 REACHED';

        let tileCls = 'hm-tile';
        if (isWatch)       tileCls += ' hm-watch';
        else if (isShort)  tileCls += ' hm-short';
        else if (isLong)   tileCls += ' hm-long';
        else               tileCls += ' hm-neutral';
        if (isLive)        tileCls += ' hm-live';

        const scoreStr  = `${c.score > 0 ? '+' : ''}${c.score}`;
        const sym       = c.symbol.replace('USDT', '');
        const chgStr    = `${c.change24h >= 0 ? '+' : ''}${(c.change24h || 0).toFixed(2)}%`;
        const chgCls    = c.change24h >= 0 ? 'hm-chg-up' : 'hm-chg-dn';
        const statusStr = isLive ? '⚡ ENTRY NOW'
          : isTp2 ? '✓✓ TP2 HIT'
          : isTp1 ? '✓ TP1 HIT'
          : c.tradeStatus || '—';
        const intStr    = (c.intStatus || '').replace('ENTRY_TRIGGER','TRIGGER').replace('_',' ');

        return `<div class="${tileCls}" data-idx="${results.indexOf(c)}">
          <div class="hm-sym">${sym}</div>
          <div class="hm-price">${fPrice(c.price)}</div>
          <div class="hm-score">${scoreStr}</div>
          <div class="hm-status">${statusStr}</div>
          <div class="hm-int">${intStr}</div>
          <div class="${chgCls} hm-chg">${chgStr}</div>
        </div>`;
      }).join('')}
    </div>`;

    // Tile click → open drawer
    el.querySelectorAll('.hm-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        SFX.play('tile_click');
        const idx = parseInt(tile.dataset.idx);
        openSMCDrawer(results[idx]);
      });
    });
  }

  buildSection(strongEl, strong, '⚡ HIGH PROBABILITY');
  buildSection(watchEl, watch, '◷ WATCH LIST');

  $('smc-heatmap-wrapper').style.display = 'block';
}

/* ══════════════════════════════════════════════════════════════
   SMC DRAWER
══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   SMC MODAL — open / close
══════════════════════════════════════════════════════════════ */
function openSMCDrawer(coin) {
  if (!coin?.smc) return;
  const smc = coin.smc;
  const sym = coin.symbol.replace('USDT', '');
  const tf  = (coin.scanTf  || STATE.smcScanTf).toUpperCase();
  const htf = (coin.scanHtf || HTF_MAP[STATE.smcScanTf] || STATE.smcScanTf).toUpperCase();

  // ── TOP BAR ──
  $('modal-symbol').textContent = sym;
  $('modal-price').textContent  = fPrice(coin.price);

  const chgEl = $('modal-change');
  chgEl.textContent = `${coin.change24h >= 0 ? '+' : ''}${(coin.change24h||0).toFixed(2)}%`;
  chgEl.className   = 'smc-modal-change ' + (coin.change24h >= 0 ? 'bull' : 'bear');

  const badgeEl = $('modal-badge');
  badgeEl.textContent = coin.tradeIdea || '—';
  badgeEl.className   = 'smc-modal-badge ' + (coin.score > 0 ? 'bull' : coin.score < 0 ? 'bear' : 'accent');

  // ── META BAR ──
  const scoreEl = $('modal-score');
  scoreEl.textContent = `${coin.score > 0 ? '+' : ''}${coin.score}`;
  scoreEl.className   = 'smc-pill-val ' + (coin.score > 0 ? 'bull' : coin.score < 0 ? 'bear' : '');

  $('modal-tf').textContent = tf;
  $('modal-tf-tag').textContent = `${tf} TIMEFRAME · HTF: ${htf}`;

  const htfEl = $('modal-htf');
  htfEl.textContent = coin.htfBias || '—';
  htfEl.className   = 'smc-pill-val ' + (coin.htfBias === 'BULLISH' ? 'bull' : coin.htfBias === 'BEARISH' ? 'bear' : '');

  const stEl = $('modal-status');
  stEl.textContent = coin.tradeStatus || '—';
  stEl.className   = 'smc-pill-val ' + (
    coin.tradeStatus === 'ENTRY NOW'   ? 'bull'   :
    coin.tradeStatus === 'WAITING'     ? 'accent' :
    coin.tradeStatus === 'INVALIDATED' ? 'bear'   : ''
  );

  const volEl = $('modal-vol');
  volEl.textContent = `${coin.change24h >= 0 ? '+' : ''}${(coin.change24h||0).toFixed(2)}% · $${fNum(coin.quoteVolume || 0)}`;
  volEl.className   = 'smc-pill-val ' + (coin.change24h >= 0 ? 'bull' : 'bear');

  // ── TF SWITCHER ──
  document.querySelectorAll('.modal-tf-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tf === (coin.scanTf || STATE.smcScanTf));
    btn.onclick = () => {
      const btnTf = btn.dataset.tf;
      SFX.play('tab_switch');
      closeSMCDrawer();
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelector('[data-tab="smccoin"]').classList.add('active');
      $('tab-smccoin').classList.add('active');
      $('smc-coin-input').value = sym;
      document.querySelectorAll('#smc-tf-selector-coin .tf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tf === btnTf);
      });
      STATE.smcCoinTf = btnTf;
      fetchSMCCoin();
    };
  });

  // ── RENDER SMC CARDS ──
  renderExternalStructure(smc.extStruct, $('modal-ext-structure'));
  renderInternalStructure(smc.intStruct, $('modal-int-structure'));
  renderPremiumDiscount(smc.pdArray,     $('modal-pd'));
  renderOrderBlocks(smc.obs,             $('modal-orderblocks'));
  renderFVGs(smc.fvgs,                   $('modal-fvgs'));
  renderEQHEQL(smc.eqheql,              $('modal-eqheql'));
  renderConfluence(smc.confluence,       $('modal-confluence'), sym, coin.scanTf || STATE.smcScanTf, coin.price);

  // ── OPEN ──
  const modal = $('smc-modal');
  modal.style.display = 'flex';   // make visible first
  requestAnimationFrame(() => {   // then animate in next frame
    modal.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
  SFX.play('drawer_open');
}

function closeSMCDrawer() {
  const modal = $('smc-modal');
  modal.classList.remove('open');
  document.body.style.overflow = '';
  SFX.play('drawer_close');
  setTimeout(() => {
    if (!modal.classList.contains('open')) modal.style.display = 'none';
  }, 250); // match transition duration
}

/* ══════════════════════════════════════════════════════════════
   SMC COIN SCANNER FETCH
══════════════════════════════════════════════════════════════ */
async function fetchSMCCoin() {
  const ticker = $('smc-coin-input').value.trim().toUpperCase();
  if (!ticker) return;
  const symbol = ticker + 'USDT';
  const tf     = STATE.smcCoinTf;

  // Reset UI
  $('smc-coin-empty').style.display   = 'none';
  $('smc-coin-error').style.display   = 'none';
  $('smc-coin-grid').style.display    = 'none';
  $('smc-coin-loading').style.display = 'flex';
  $('smc-coin-loader-text').textContent = 'FETCHING MARKET DATA...';
  $('smc-coin-fetch-btn').classList.add('loading');
  setStatus('loading', 'SMC ANALYSING');
  SFX.play('fetch_start');

  try {
    // Fetch market data for price
    let market;
    try { market = await fetchBinance(symbol); }
    catch (_) { market = await fetchBybit(symbol); }

    $('smc-coin-loader-text').textContent = `FETCHING ${tf.toUpperCase()} KLINES...`;
    const candles = await fetchKline(symbol, tf);

    if (!candles || candles.length < 10) throw new Error('Insufficient kline data for SMC analysis');

    // Independent HTF fetch — separate kline call, not a slice of the base TF window.
    // 300 HTF bars gives genuine historical depth (e.g. 300 × 4H = ~50 days).
    // Failure degrades gracefully: htfBiasLabel shows 'HTF UNAVAILABLE', main
    // analysis completes normally.
    const htf = HTF_MAP[tf] || tf;
    const isSameTF = htf === tf;
    let htfBiasLabel = '—';

    if (!isSameTF) {
      $('smc-coin-loader-text').textContent = `FETCHING ${htf.toUpperCase()} HTF KLINES...`;
      try {
        const htfCandles = await fetchKlineQuick(ticker, htf, 300);
        if (htfCandles && htfCandles.length >= 20) {
          const htfTfp    = getTFParams(htf);
          const htfSwings = detectSwings(htfCandles, htfTfp.swingStrength);
          if (htfSwings.length >= 6) {
            const htfSmc   = runSMCAnalysis(htfCandles, market.lastPrice, htf);
            htfBiasLabel   = htfSmc?.extStruct?.externalBias || 'HTF UNCLEAR';
          } else {
            htfBiasLabel = 'HTF UNCLEAR';
          }
        } else {
          htfBiasLabel = 'HTF UNAVAILABLE';
        }
      } catch (_) {
        htfBiasLabel = 'HTF UNAVAILABLE';
      }
    }

    $('smc-coin-loader-text').textContent = 'RUNNING SMC ENGINE...';
    const smc = runSMCAnalysis(candles, market.lastPrice, tf);

    if (!smc) throw new Error('SMC analysis failed — not enough swing points');

    // Attach independent HTF bias to the smc result so renderers can surface it
    smc.htfBias = htfBiasLabel;
    smc.htf     = htf;

    // Update header
    $('smc-coin-symbol').textContent = ticker;
    $('smc-coin-price').textContent  = fPrice(market.lastPrice);
    $('smc-coin-change').textContent = fPct(market.changePct24h);
    $('smc-coin-change').className   = 'smc-coin-change ' + pctClass(market.changePct24h);
    $('smc-coin-tf-label').textContent  = tf.toUpperCase();
    $('smc-coin-htf-label').textContent = isSameTF ? tf.toUpperCase() : htf.toUpperCase();

    // HTF bias badge — colour-coded: BULLISH=bull, BEARISH=bear, else neutral
    const htfBadgeEl = $('smc-coin-htf-bias');
    htfBadgeEl.textContent = smc.htfBias || '—';
    htfBadgeEl.className   = 'source-badge ' + (
      smc.htfBias === 'BULLISH' ? 'bull' :
      smc.htfBias === 'BEARISH' ? 'bear' : ''
    );

    $('smc-coin-updated').textContent  = nowStr();
    $('smc-coin-header-bar').style.display = 'flex';

    $('smc-coin-loading').style.display = 'none';
    $('smc-coin-grid').style.display    = 'grid';

    renderSMCCoin(smc, ticker, tf, market.lastPrice);
    setStatus('ok', 'SMC READY');
    SFX.play('fetch_complete');
  } catch(e) {
    SFX.play('error');
    $('smc-coin-loading').style.display = 'none';
    $('smc-coin-error').style.display   = 'flex';
    $('smc-coin-error').querySelector('.error-title').textContent = 'SMC ANALYSIS FAILED';
    $('smc-coin-error').querySelector('.error-sub').textContent   = e.message;
    setStatus('error', 'ERROR');
  }
  $('smc-coin-fetch-btn').classList.remove('loading');
}



/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */
function initSMCTabs() {
  initSMCScanFilters();
  // SMC Coin TF selector
  document.querySelectorAll('#smc-tf-selector-coin .tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#smc-tf-selector-coin .tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.smcCoinTf = btn.dataset.tf;
    });
  });

  // SMC Scan TF selector
  document.querySelectorAll('#smc-tf-selector-scan .tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#smc-tf-selector-scan .tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.smcScanTf = btn.dataset.tf;
    });
  });

  // SMC scan source toggle
  document.querySelectorAll('.smc-src-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.smc-src-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.smcScanSource = btn.dataset.src;
    });
  });
}

function init() {
  startClock();
  initTabs();
  initTfSelectors();
  initSourceToggle();
  initScannerTabs();
  initSMCTabs();

  // Fetch button — single coin
  $('fetch-btn').addEventListener('click', fetchCoin);
  $('coin-input').addEventListener('keydown', e => { if (e.key === 'Enter') fetchCoin(); });

  // Scanner fetch
  $('scanner-fetch-btn').addEventListener('click', runScanner);

  // SMC Coin Scanner
  $('smc-coin-fetch-btn').addEventListener('click', fetchSMCCoin);
  $('smc-coin-input').addEventListener('keydown', e => { if (e.key === 'Enter') fetchSMCCoin(); });

  // SMC Market Scanner
  $('smc-scan-btn').addEventListener('click', runSMCMarketScan);
  $('smc-modal-close').addEventListener('click', closeSMCDrawer);

  // Description toggle init
  $('desc-toggle').addEventListener('click', () => {
    const el = $('coin-description');
    el.classList.toggle('expanded');
    $('desc-toggle').textContent = el.classList.contains('expanded') ? 'READ LESS' : 'READ MORE';
  });
}

document.addEventListener('DOMContentLoaded', init);
