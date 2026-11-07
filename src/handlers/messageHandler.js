const whatsapp = require('../services/whatsapp');
const K = require('../data/knowledge');
const ai = require('../services/ai');
const config = require('../config');
const leads = require('../services/leads');
const sheets = require('../services/sheets');

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

async function notifyTeamQualified(leadSummary) {
  // Log qualified lead for team attention
  console.log(`[LEAD:QUALIFIED] ${leadSummary.phone} | interests: ${leadSummary.interests.join(', ')} | msgs: ${leadSummary.messageCount}`);
  if (leadSummary.humanRequested) {
    console.log(`[LEAD:QUALIFIED] User requested human contact - priority follow-up needed`);
  }
}

async function handleIncoming(message, from) {
  if (processed.has(message.id)) return;
  processed.add(message.id);
  cleanupProcessed();

  // Track conversation for AI context
  const type = message.type;

  if (type === 'interactive') {
    const interactive = message.interactive || {};
    let id = null;
    if (interactive.type === 'list_reply') id = interactive.list_reply?.id;
    else if (interactive.type === 'button_reply') id = interactive.button_reply?.id;

    if (id) {
      leads.addMessage(from, 'user', `[selected: ${id}]`);

      // Classify lead based on interaction
      let interactionType = null;
      if (id === 'human' || id === 'contact') interactionType = 'human_request';
      const { status, lead } = leads.classifyLead(from, id, interactionType);

      // Persist to sheets (fire and forget)
      sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});

      if (status === leads.STATUS.QUALIFIED) {
        notifyTeamQualified(leads.getLeadSummary(from));
      }

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

    leads.addMessage(from, 'user', text);

    // number shortcut
    const nid = numberToId(text);
    if (nid) {
      let interactionType = null;
      if (nid === 'human' || nid === 'contact') interactionType = 'human_request';
      const { status } = leads.classifyLead(from, text, interactionType);
      sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});
      if (status === leads.STATUS.QUALIFIED) notifyTeamQualified(leads.getLeadSummary(from));

      if (nid === 'menu') await sendMenu(from);
      else await sendReply(from, nid);
      return;
    }

    const kw = K.matchKeyword(text);
    if (kw === 'menu') {
      leads.classifyLead(from, text, null);
      sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});
      await sendMenu(from);
      return;
    } else if (kw) {
      let interactionType = null;
      if (kw === 'human' || kw === 'contact') interactionType = 'human_request';
      const { status } = leads.classifyLead(from, text, interactionType);
      sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});
      if (status === leads.STATUS.QUALIFIED) notifyTeamQualified(leads.getLeadSummary(from));
      await sendReply(from, kw);
      return;
    }

    // Unknown text: try AI if configured
    if (config.openaiKey) {
      const history = leads.getHistory(from);
      const reply = await ai.answer(text, history);
      if (reply) {
        const { status } = leads.classifyLead(from, text, null);
        leads.addMessage(from, 'assistant', reply);
        sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});
        if (status === leads.STATUS.QUALIFIED) notifyTeamQualified(leads.getLeadSummary(from));

        await whatsapp.text(from, reply);

        // Smart follow-up
        const lead = leads.getLead(from);
        const followUp = ai.getFollowUp(lead.interests, lead.messageCount);
        const buttons = [
          { id: 'menu', title: 'Main Menu' },
          { id: 'contact', title: 'Book a Call' },
          { id: 'human', title: 'Talk to Human' },
        ];
        if (followUp) {
          await whatsapp.buttons(from, { body: followUp, buttons });
        } else {
          await whatsapp.buttons(from, { body: 'What next?', buttons });
        }
        return;
      }
    }

    // Fallback
    const { status } = leads.classifyLead(from, text, null);
    sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});
    await whatsapp.text(
      from,
      "I'm not sure I understood that. Ã°Å¸Â¤â€\n\nHere's our main menu Ã¢â‚¬â€ pick an option and I'll help you out!"
    );
    await sendMenu(from);
    return;
  }

  // non-text
  await whatsapp.text(
    from,
    "I can currently read text messages only. Please type your question or choose from the menu below. Ã°Å¸â€˜â€¡"
  );
  await sendMenu(from);
}

module.exports = { handleIncoming, sendMenu, sendReply };
