require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve index.html at root
app.use(express.static(__dirname));

// ─── AI CHAT ────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: system,
        messages: messages
      })
    });
    const data = await response.json();
    const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response.";
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'AI service error' });
  }
});

// ─── CRYPTO PRICES (BTC, ETH for landing tickers) ───────────────────
app.get('/api/crypto/landing', async (req, res) => {
  try {
    const response = await fetch('https://api.coincap.io/v2/assets?ids=bitcoin,ethereum');
    const { data } = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch crypto prices' });
  }
});

// ─── CRYPTO TABLE (dashboard live market) ───────────────────────────
app.get('/api/crypto/market', async (req, res) => {
  try {
    const response = await fetch('https://api.coincap.io/v2/assets?limit=10');
    const { data } = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ CryptoVault running at http://localhost:${PORT}`);
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ Loaded' : '✗ MISSING'}\n`);
});
