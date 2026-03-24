require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ─── SIMPLE HTTPS FETCH (no external dependencies) ──────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0, 100))); }
      });
    }).on('error', reject);
  });
}

// ─── PRICE CACHE (serves last known price if API fails) ─────────────
let priceCache = {
  BTC: { price: 97500, change: 1.2 },
  ETH: { price: 3200, change: 0.8 }
};
let lastCacheTime = 0;

async function refreshPriceCache() {
  try {
    // Try Binance — most reliable, no API key needed
    const [btc, eth] = await Promise.all([
      httpsGet('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      httpsGet('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT')
    ]);
    priceCache = {
      BTC: { price: parseFloat(btc.lastPrice), change: parseFloat(btc.priceChangePercent) },
      ETH: { price: parseFloat(eth.lastPrice), change: parseFloat(eth.priceChangePercent) }
    };
    lastCacheTime = Date.now();
    console.log(`✅ Prices updated — BTC: $${priceCache.BTC.price.toFixed(2)}, ETH: $${priceCache.ETH.price.toFixed(2)}`);
  } catch(err) {
    console.error('Binance failed, trying CoinGecko...', err.message);
    try {
      const data = await httpsGet('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true');
      priceCache = {
        BTC: { price: data.bitcoin.usd, change: data.bitcoin.usd_24h_change },
        ETH: { price: data.ethereum.usd, change: data.ethereum.usd_24h_change }
      };
      lastCacheTime = Date.now();
      console.log('✅ Prices updated via CoinGecko fallback');
    } catch(err2) {
      console.error('All price APIs failed, using cached values:', err2.message);
    }
  }
}

// Refresh prices every 60 seconds
refreshPriceCache();
setInterval(refreshPriceCache, 60000);

// ─── LANDING TICKERS (BTC + ETH) ────────────────────────────────────
app.get('/api/crypto/landing', async (req, res) => {
  // If cache is stale (>5 min), try refreshing first
  if (Date.now() - lastCacheTime > 300000) await refreshPriceCache();
  res.json([
    { id: 'bitcoin',  symbol: 'BTC', priceUsd: priceCache.BTC.price, changePercent24Hr: priceCache.BTC.change },
    { id: 'ethereum', symbol: 'ETH', priceUsd: priceCache.ETH.price, changePercent24Hr: priceCache.ETH.change }
  ]);
});

// ─── DASHBOARD MARKET TABLE ──────────────────────────────────────────
app.get('/api/crypto/market', async (req, res) => {
  try {
    const symbols = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT'];
    const names   = { BTC:'Bitcoin', ETH:'Ethereum', BNB:'BNB', SOL:'Solana', XRP:'XRP', DOGE:'Dogecoin', ADA:'Cardano', AVAX:'Avalanche', DOT:'Polkadot', LINK:'Chainlink' };

    const results = await Promise.all(
      symbols.map(s => httpsGet(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`))
    );

    const data = results.map((c, i) => {
      const sym = symbols[i].replace('USDT', '');
      return {
        name: names[sym] || sym,
        symbol: sym,
        priceUsd: parseFloat(c.lastPrice),
        changePercent24Hr: parseFloat(c.priceChangePercent),
        marketCapUsd: null,
        volumeUsd24Hr: parseFloat(c.quoteVolume),
        image: `https://assets.coincap.io/assets/icons/${sym.toLowerCase()}@2x.png`
      };
    });
    res.json(data);
  } catch(err) {
    console.error('Market error:', err.message);
    // Return cached BTC/ETH at minimum
    res.json([
      { name:'Bitcoin',  symbol:'BTC', priceUsd: priceCache.BTC.price, changePercent24Hr: priceCache.BTC.change, volumeUsd24Hr: 0, marketCapUsd: null, image:'https://assets.coincap.io/assets/icons/btc@2x.png' },
      { name:'Ethereum', symbol:'ETH', priceUsd: priceCache.ETH.price, changePercent24Hr: priceCache.ETH.change, volumeUsd24Hr: 0, marketCapUsd: null, image:'https://assets.coincap.io/assets/icons/eth@2x.png' }
    ]);
  }
});

// ─── AI CHAT ─────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  try {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: system,
      messages: messages
    });

    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      };
      const reqHttp = https.request(options, (response) => {
        let raw = '';
        response.on('data', chunk => raw += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch(e) { reject(new Error('Parse error: ' + raw.slice(0, 200))); }
        });
      });
      reqHttp.on('error', reject);
      reqHttp.write(body);
      reqHttp.end();
    });

    const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response.";
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'AI service error: ' + err.message });
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    apiKey: process.env.ANTHROPIC_API_KEY ? '✓ loaded' : '✗ missing',
    cachedBTC: '$' + priceCache.BTC.price.toFixed(2),
    cachedETH: '$' + priceCache.ETH.price.toFixed(2),
    lastUpdated: lastCacheTime ? new Date(lastCacheTime).toISOString() : 'never'
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ CryptoVault running on port ${PORT}`);
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ Loaded' : '✗ MISSING — add to Railway Variables'}\n`);
});
