const axios = require('axios');
const config = require('../config');
const K = require('../data/knowledge');

const SYSTEM_PROMPT = `You are the WhatsApp assistant for ${config.business.name}, a social media marketing & content agency in Mumbai.
Answer customer questions concisely (max 4-6 lines) about the agency, services, packages, pricing, process, clients, and contact.
Use only the facts below. If unsure, direct them to book a free call or talk to a human. Never invent prices beyond the stated "from" amounts. Keep a friendly, professional tone. Use WhatsApp-friendly formatting (*bold*).

FACTS:
${K.ABOUT}

${K.SERVICES}

${K.PROCESS}

${K.CLIENTS}

${K.PACKAGES}

${K.FAQ}

${K.CONTACT}`;

async function answer(question) {
  if (!config.openaiKey) return null;
  try {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: question },
        ],
        max_tokens: 300,
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${config.openaiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return res.data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('[ai] error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { answer };