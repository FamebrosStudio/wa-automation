const axios = require('axios');
const config = require('../config');

const BASE = `https://graph.facebook.com/${config.graphVersion}`;

async function send(payload) {
  if (!config.whatsappToken || !config.phoneNumberId) {
    console.warn('[whatsapp] missing token/phone_number_id; payload logged only');
    console.log(JSON.stringify(payload, null, 2));
    return { skipped: true };
  }
  const url = `${BASE}/${config.phoneNumberId}/messages`;
  try {
    const res = await axios.post(url, payload, {
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
EOF
