const express = require('express');
const config = require('./config');
const { handleIncoming } = require('./handlers/messageHandler');
const sheets = require('./services/sheets');

// Initialize Google Sheets lead tracking (non-blocking)
sheets.initSheets().then((ok) => {
  if (ok) console.log('[sheets] Lead tracking enabled');
}).catch((e) => console.error('[sheets] init failed:', e.message));

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-famebros-bot' });
});

// Webhook verification (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('[webhook] verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const messages = value.messages || [];
        for (const msg of messages) {
          const from = msg.from;
          if (!from) continue;
          if (msg.type === 'unknown') continue;
          console.log(`[webhook] incoming from ${from} type=${msg.type}`);
          await handleIncoming(msg, from).catch((e) =>
            console.error('[handler] error:', e.message)
          );
        }
      }
    }
    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] processing error:', err.message);
    return res.sendStatus(500);
  }
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
    console.log(`[server] webhook URL: http://localhost:${config.port}/webhook`);
  });
}

module.exports = app;