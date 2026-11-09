const axios = require('axios');
const config = require('../config');

const BASE = `https://graph.facebook.com/${config.graphVersion}`;

async function send(payload) {
  if (process.env.BOT_ENABLED !== 'true') throw new Error('Sales automation is disabled');
  const firestore = require('./firestore');
  const { eligibility } = require('./eligibility');
  if (!firestore.isConfigured()) throw new Error('Durable contact eligibility is unavailable');
  const decision = eligibility(await firestore.getLeadByPhone(payload.to));
  if (!decision.allowed) throw new Error(`Automated send suppressed: ${decision.reason}`);
  if (!config.whatsappToken || !config.phoneNumberId) {
    // Do not acknowledge an inbound webhook as handled when no reply could be sent.
    // Throwing lets the webhook return 503 so Meta can retry after configuration is fixed.
    throw new Error('WhatsApp sending is not configured: set WHATSAPP_TOKEN and PHONE_NUMBER_ID');
  }
  const url = `${BASE}/${config.phoneNumberId}/messages`;
  try {
    const res = await axios.post(url, payload, {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
    });
    return res.data;
  } catch (err) {
    console.error('[whatsapp] send error:', err.response?.data || err.message);
    throw err;
  }
}

function text(to, body, previewUrl = false) {
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body, preview_url: previewUrl },
  });
}

function list(to, { header, body, footer, button, sections }) {
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: header ? { type: 'text', text: header } : undefined,
      body: { text: body },
      footer: footer ? { text: footer } : undefined,
      action: { button, sections },
    },
  });
}

function buttons(to, { body, footer, buttons }) {
  return send({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      footer: footer ? { text: footer } : undefined,
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

module.exports = { send, text, list, buttons };
