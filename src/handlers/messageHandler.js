const whatsapp = require('../services/whatsapp');
const K = require('../data/knowledge');
const ai = require('../services/ai');
const config = require('../config');

const processed = new Set();
const sessions = new Map(); // from -> { lastMenu }

const MENU_ORDER = ['about', 'services', 'process', 'packages', 'clients', 'faq', 'contact', 'human'];

function cleanupProcessed() {
  if (processed.size > 5000) processed.clear();
}

async function sendMenu(to) {
  sessions.set(to, { last: 'menu' });
  await whatsapp.list(to, K.MAIN_MENU);
}

async function sendReply(to, id) {
  const body = K.REPLIES[id];
  if (!body) {
    await sendMenu(to);
    return;
  }
  sessions.set(to, { last: id });
  await whatsapp.text(to, body);
  // quick navigation buttons
  await whatsapp.buttons(to, {
    body: 'What next?',
    buttons: [
      { id: 'menu', title: 'Main Menu' },
      { id: 'contact', title: 'Book a Call' },
      { id: 'human', title: 'Talk to Human' },
    ],
  });
}

function numberToId(text) {
  const n = parseInt(text.trim(), 10);
  if (isNaN(n) || n < 1 || n > MENU_ORDER.length) return null;
  return MENU_ORDER[n - 1];
}

async function handleIncoming(message, from) {
  if (processed.has(message.id)) return;
  processed.add(message.id);
  cleanupProcessed();

  const type = message.type;

  if (type === 'interactive') {
    const interactive = message.interactive || {};
    let id = null;
    if (interactive.type === 'list_reply') id = interactive.list_reply?.id;
    else if (interactive.type === 'button_reply') id = interactive.button_reply?.id;
    if (id) {
      if (id === 'menu') await sendMenu(from);
      else await sendReply(from, id);
      return;
    }
  }

  if (type === 'text') {
    const text = (message.text?.body || '').trim();
    if (!text) {
      await sendMenu(from);
      return;
    }
    // number shortcut
    const nid = numberToId(text);
    if (nid) {
      if (nid === 'menu') await sendMenu(from);
      else await sendReply(from, nid);
      return;
    }
    const kw = K.matchKeyword(text);
    if (kw === 'menu') {
      await sendMenu(from);
    } else if (kw) {
      await sendReply(from, kw);
    } else {
      // unknown: try AI if configured, else helpful fallback + menu
      if (config.openaiKey) {
        const reply = await ai.answer(text);
        if (reply) {
          sessions.set(from, { last: 'ai' });
          await whatsapp.text(from, reply);
          await whatsapp.buttons(from, {
            body: 'What next?',
            buttons: [
              { id: 'menu', title: 'Main Menu' },
              { id: 'contact', title: 'Book a Call' },
              { id: 'human', title: 'Talk to Human' },
            ],
          });
          return;
        }
      }
      await whatsapp.text(
        from,
        "I'm not sure I understood that. 🤔\n\nHere's our main menu — pick an option and I'll help you out!"
      );
      await sendMenu(from);
    }
    return;
  }

  // non-text
  await whatsapp.text(
    from,
    "I can currently read text messages only. Please type your question or choose from the menu below. 👇"
  );
  await sendMenu(from);
}

module.exports = { handleIncoming, sendMenu, sendReply };