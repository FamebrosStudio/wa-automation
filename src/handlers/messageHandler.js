const whatsapp = require('../services/whatsapp');
const K = require('../data/knowledge');
const ai = require('../services/ai');
const config = require('../config');
const leads = require('../services/leads');
const sheets = require('../services/sheets');

const processed = new Set();
const sessions = new Map();

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
  console.log(`[LEAD:QUALIFIED] ${leadSummary.phone} | interests: ${leadSummary.interests.join(', ')} | msgs: ${leadSummary.messageCount}`);
  if (leadSummary.humanRequested) {
    console.log(`[LEAD:QUALIFIED] User requested human contact - priority follow-up needed`);
  }
  // Send WhatsApp notification to admin if configured and different from business phone
  const businessPhone = (config.business.phone || '').replace(/[^0-9]/g, '');
  if (config.adminPhone && config.adminPhone !== businessPhone) {
    const msg = `New qualified lead!\nPhone: ${leadSummary.phone}\nStatus: ${leadSummary.status}\nInterests: ${leadSummary.interests.join(', ') || 'none'}\nMessages: ${leadSummary.messageCount}\nHuman requested: ${leadSummary.humanRequested ? 'Yes' : 'No'}\nLast message: ${(leadSummary.conversationSummary || '').slice(0, 200)}`;
    try {
      await whatsapp.text(config.adminPhone, msg);
    } catch (e) {
      console.error('[notify] Failed to send admin notification:', e.message);
    }
  } else {
    console.log(`[LEAD:QUALIFIED] ${leadSummary.phone} | ${leadSummary.status} | interests: ${leadSummary.interests.join(', ') || 'none'} | msgs: ${leadSummary.messageCount} | human: ${leadSummary.humanRequested ? 'Yes' : 'No'}`);
  }
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
      leads.addMessage(from, 'user', `[selected: ${id}]`);

      let interactionType = null;
      if (id === 'human' || id === 'contact') interactionType = 'human_request';
      const { status, lead } = leads.classifyLead(from, id, interactionType);

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

    // Enhanced natural language understanding
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

    // Fallback - conversational, not template-like
    const { status } = leads.classifyLead(from, text, null);
    sheets.upsertLead(leads.getLeadSummary(from)).catch(() => {});
    await whatsapp.text(
      from,
      "Hmm, I am not quite sure what you mean. Let me show you the options so you can pick what interests you."
    );
    await sendMenu(from);
    return;
  }

  // non-text
  await whatsapp.text(
    from,
    "I can currently read text messages only. Please type your question or choose from the menu below."
  );
  await sendMenu(from);
}

module.exports = { handleIncoming, sendMenu, sendReply };
