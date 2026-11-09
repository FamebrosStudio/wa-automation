const whatsapp = require('../services/whatsapp');
const K = require('../data/knowledge');
const leads = require('../services/leads');
const flow = require('../services/flow');
const firestore = require('../services/firestore');

const processed = new Set();
const sessions = new Map();
const phoneQueues = new Map();

const MENU_ORDER = ['service_social', 'service_ads', 'service_photo', 'service_website', 'service_team'];
const SERVICE_IDS = {
  service_social: 'social', service_ads: 'ads', service_photo: 'photo',
  service_website: 'website', service_team: 'team',
};

function cleanupProcessed() {
  if (processed.size > 5000) processed.clear();
}

async function sendMenu(to) {
  sessions.set(to, { last: 'menu' });
  await whatsapp.list(to, K.MAIN_MENU);
}

async function startService(to, id) {
  const serviceKey = SERVICE_IDS[id];
  const firstStep = flow.startServiceFlow(to, serviceKey);
  if (!firstStep) return sendMenu(to);
  leads.updateLead(to, { service: flow.SERVICE_FLOWS[serviceKey].service });
  await whatsapp.text(to, firstStep.intro);
  if (firstStep.options?.length) await sendFlowChoices(to, firstStep.step, firstStep.options);
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
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  if (n < 1 || n > MENU_ORDER.length) return null;
  return MENU_ORDER[n - 1];
}

function interactiveReplyId(message) {
  const interactive = message?.interactive || {};
  if (interactive.type === 'list_reply') return interactive.list_reply?.id || null;
  if (interactive.type === 'button_reply') return interactive.button_reply?.id || null;
  return null;
}

function isBotOption(id) {
  return Boolean(id && (SERVICE_IDS[id] || ['menu', 'contact', 'human'].includes(id) || /^flow_[a-z0-9]+_\d+$/i.test(id)));
}

async function startLeadCapture(from) {
  await whatsapp.text(from, `${flow.startFlow(from)} Type cancel at any time to stop.`);
}

async function handleFlowText(from, text) {
  // Interactive option IDs are transport values, not customer message content.
  if (!/^flow_[a-z0-9]+_\d+$/i.test(text)) leads.classifyLead(from, text, null);
  const result = flow.processFlowResponse(from, text);
  if (!result) return false;
  leads.addMessage(from, 'assistant', result.reply);
  await whatsapp.text(from, result.reply);
  if (result.options?.length) await sendFlowChoices(from, result.step, result.options);
  if (result.cancelled) {
    await whatsapp.buttons(from, { body: 'What would you like to do next?', buttons: [
      { id: 'menu', title: 'Main Menu' }, { id: 'contact', title: 'Book a Call' }, { id: 'human', title: 'Talk to Human' },
    ] });
  }
  return true;
}

async function sendFlowChoices(to, step, options) {
  const shortLabels = {
    "I'm a creator/influencer": 'Creator / influencer',
    "I'm starting a new business": 'Starting a new business',
    'WhatsApp Enquiries': 'WhatsApp enquiries',
    'Lead Form Enquiries': 'Lead form enquiries',
    'Brand Awareness': 'Brand awareness',
    'Restaurant/Food Shoot': 'Restaurant/Food shoot',
    'Fashion/Model Shoot': 'Fashion/Model shoot',
    'Brand Promotional Reel': 'Brand promo reel',
  };
  await whatsapp.list(to, {
    body: 'Tap an option to continue', button: 'Choose',
    sections: [{ title: 'Options', rows: options.map((text, index) => ({
      id: `flow_${step}_${index}`,
      title: `${index + 1} ${shortLabels[text] || text}`.slice(0, 24),
      description: text.slice(0, 72),
    })) }],
  });
}

async function handleIncomingInMemory(message, from) {
  if (processed.has(message.id)) return;
  processed.add(message.id);
  cleanupProcessed();

  const lead = leads.getLead(from);
  const firstMessage = !lead.welcomeSent;
  if (firstMessage) {
    leads.updateLead(from, { welcomeSent: true });
    await sendMenu(from);
  }

  const type = message.type;

  if (type === 'interactive') {
    const id = interactiveReplyId(message);

    if (id) {
      leads.addMessage(from, 'user', `[selected: ${id}]`);

      if (flow.hasActiveFlow(from) && /^flow_[a-z0-9]+_\d+$/i.test(id)) {
        await handleFlowText(from, id);
        return;
      }

      if (SERVICE_IDS[id]) {
        await startService(from, id);
        return;
      }

      if (flow.hasActiveFlow(from)) flow.cancelFlow(from);

      if (id === 'contact') {
        leads.classifyLead(from, id, null);
        await startLeadCapture(from);
        return;
      }
      let interactionType = null;
      if (id === 'human' || id === 'contact') interactionType = 'human_request';
      leads.classifyLead(from, id, interactionType);

      if (id === 'menu') await sendMenu(from);
      else await sendReply(from, id);
      return;
    }
  }

  if (type === 'text') {
    const text = (message.text?.body || '').trim();
    if (!text) {
      if (!firstMessage) await sendMenu(from);
      return;
    }

    leads.addMessage(from, 'user', text);

    if (flow.hasActiveFlow(from)) {
      const action = K.matchKeyword(text);
      if (action === 'menu' || action === 'contact' || action === 'human') flow.cancelFlow(from);
      else if (/^(cancel|stop)$/i.test(text)) {
        await handleFlowText(from, text);
        return;
      } else {
        if (await handleFlowText(from, text)) return;
      }
    }

    const nid = numberToId(text);
    if (nid) {
      if (SERVICE_IDS[nid]) {
        await startService(from, nid);
        return;
      }
      let interactionType = null;
      if (nid === 'human' || nid === 'contact') interactionType = 'human_request';
      leads.classifyLead(from, text, interactionType);

      if (nid === 'menu') await sendMenu(from);
      else if (nid === 'contact') await startLeadCapture(from);
      else await sendReply(from, nid);
      return;
    }

    // Enhanced natural language understanding
    const lowerText = text.toLowerCase();
    const requestedService = lowerText.includes('social media') || lowerText.includes('social management') ? 'service_social'
      : lowerText.includes('meta ad') || lowerText.includes('lead generation') || lowerText.includes('facebook ad') || lowerText.includes('instagram ad') ? 'service_ads'
      : lowerText.includes('photo') || lowerText.includes('video') || lowerText.includes('shoot') ? 'service_photo'
      : lowerText.includes('website') || lowerText.includes('web development') ? 'service_website'
      : lowerText.includes('talk to our team') || lowerText.includes('speak to your team') ? 'service_team'
      : null;
    if (requestedService) {
      await startService(from, requestedService);
      return;
    }
    const kw = K.matchKeyword(text);
    if (kw === 'contact') {
      leads.classifyLead(from, text, null);
      await startLeadCapture(from);
      return;
    }
    if (kw === 'menu') {
      leads.classifyLead(from, text, null);
      if (!firstMessage) await sendMenu(from);
      return;
    } else if (kw) {
      let interactionType = null;
      if (kw === 'human' || kw === 'contact') interactionType = 'human_request';
      leads.classifyLead(from, text, interactionType);
      await sendReply(from, kw);
      return;
    }

    // New conversations already received the welcome menu above.
    if (firstMessage) return;

    // Fallback - conversational, not template-like
    leads.classifyLead(from, text, null);
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

async function handleIncoming(message, from) {
  let firestoreEnabled = firestore.isConfigured();
  let storageUnavailable = false;
  const previous = phoneQueues.get(from) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    let releaseLease = null;
    if (firestoreEnabled) {
      try {
        releaseLease = await firestore.acquirePhoneLease(from);
      } catch (error) {
        // Fail closed: without durable history, a serverless instance cannot
        // know whether this is an existing contact that must remain silent.
        console.error('[firestore] unavailable; cannot verify contact history:', error.message);
        firestoreEnabled = false;
        storageUnavailable = true;
      }
    }
    try {
      // If durable storage is configured but unavailable, the bot cannot
      // safely distinguish a first-time sender from an existing contact.
      if (storageUnavailable) return { ignored: true, reason: 'contact-history-unavailable' };
      let record = null;
      if (firestoreEnabled) {
        // These independent point reads share a network round trip instead of
        // adding duplicate-check latency ahead of every WhatsApp reply.
        const [alreadyProcessed, storedRecord] = await Promise.all([
          message.id ? firestore.hasProcessedMessage(message.id) : false,
          firestore.getLeadByPhone(from),
        ]);
        if (alreadyProcessed) return;
        record = storedRecord;
      }
      if (releaseLease) await releaseLease.assertOwnership();
      const previouslyStored = Boolean(record || leads.snapshot(from).length);
      if (record) {
        leads.restoreOne(record);
        leads.updateLead(from, { assignedTeam: record.crm?.owner || '', crm: record.crm || {} });
        flow.restoreFlow(from, record.activeFlow);
      }
      const knownLead = leads.snapshot(from)[0]?.lead;
      if (knownLead?.status === 'Qualified') {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'qualified-lead' };
      }
      // Only contacts first seen after this policy was deployed are enrolled.
      // Older records stay silent for ordinary text, but a deliberate tap on a
      // bot option is a fresh opt-in to continue the requested flow.
      const explicitOption = message.type === 'interactive' && isBotOption(interactiveReplyId(message));
      if (previouslyStored && knownLead?.automationEligible !== true && !explicitOption) {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'existing-contact-not-enrolled' };
      }
      if (!previouslyStored || explicitOption) {
        leads.updateLead(from, { automationEligible: true, ...(explicitOption ? { welcomeSent: true } : {}) });
      }
      const result = await handleIncomingInMemory(message, from);
      if (releaseLease) await releaseLease.assertOwnership();
      if (firestoreEnabled) {
        const current = leads.snapshot(from)[0];
        if (current) {
          if (releaseLease) await releaseLease.assertOwnership();
           const serviceDetails = current.lead.serviceDetails || {};
           await firestore.saveLead({ ...current, activeFlow: flow.snapshotFlow(from), crm: {
             ...(current.lead.crm || {}),
             owner: current.lead.assignedTeam || '',
             tags: current.lead.service ? [current.lead.service] : [],
             notes: Object.keys(serviceDetails).length ? JSON.stringify(serviceDetails) : '',
           } });
        }
      }
      if (firestoreEnabled && message.id) {
        if (releaseLease) await releaseLease.assertOwnership();
        await firestore.markMessageProcessed(message.id, from);
      }
      return result;
    } finally {
      if (releaseLease) await releaseLease();
    }
  });
  phoneQueues.set(from, task);
  try {
    return await task;
  } finally {
    if (phoneQueues.get(from) === task) phoneQueues.delete(from);
  }
}

module.exports = { handleIncoming, sendMenu, sendReply };
