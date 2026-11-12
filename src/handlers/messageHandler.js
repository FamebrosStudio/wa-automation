const whatsapp = require('../services/whatsapp');
const K = require('../data/knowledge');
const leads = require('../services/leads');
const flow = require('../services/flow');
const firestore = require('../services/firestore');
const { eligibility, hasFirstContactEnrollment, isAlwaysAutomatedTestNumber, isSuppressedNumber } = require('../services/eligibility');

const processed = new Set();
const sessions = new Map();
const phoneQueues = new Map();

const MENU_ORDER = ['service_social', 'service_ads', 'service_photo', 'service_website', 'service_team'];
const SERVICE_IDS = {
  service_social: 'social', service_ads: 'ads', service_photo: 'photo',
  service_website: 'website', service_other: 'other', service_team: 'team',
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
  if (firstStep.options?.length) await sendFlowChoices(to, firstStep.step, firstStep.options, firstStep.intro);
  else await whatsapp.text(to, firstStep.intro);
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

async function startLeadCapture(from) {
  await whatsapp.text(from, `${flow.startFlow(from)} Type cancel at any time to stop.`);
}

const HUMAN_REQUEST_RE = /\b(call|plz\s+call|please\s+call|call\s+me|can\s+you\s+call|talk\s+to\s+(someone|our\s+team|a\s+human|human|team)|need\s+(a\s+)?human|human\s+support|real\s+person|speak\s+to\s+(someone|our\s+team|a\s+human)|connect\s+me|live\s+agent)\b/i;

function leadResetForNewEnquiry(from) {
  leads.updateLead(from, {
    conversationStatus: null,
    completionMessageSent: false,
    welcomeSent: false,
    humanRequested: false,
    automationEligible: true,
  });
  flow.cancelFlow(from);
}

async function handleFlowText(from, text) {
  // Interactive option IDs are transport values, not customer message content.
  if (!/^flow_[a-z0-9]+_\d+$/i.test(text)) leads.classifyLead(from, text, null);
  const result = flow.processFlowResponse(from, text);
  if (!result) return false;
  const persistProgress = async () => {
    if (!firestore.isConfigured()) return;
    const current = leads.snapshot(from)[0];
    if (current) await firestore.saveLead({ ...current, activeFlow: flow.snapshotFlow(from) });
  };
  // Completion: send thank-you exactly once, then lock the conversation.
  if (result.done) {
    const lead = leads.getLead(from);
    if (lead.completionMessageSent) return true; // already sent — never resend
    leads.addMessage(from, 'assistant', result.reply);
    await persistProgress();
    await whatsapp.text(from, result.reply);
    leads.updateLead(from, { conversationStatus: 'COMPLETED', completionMessageSent: true });
    return true;
  }
  leads.addMessage(from, 'assistant', result.reply);
  await persistProgress();
  if (result.options?.length) await sendFlowChoices(from, result.step, result.options, result.reply);
  else await whatsapp.text(from, result.reply);
  if (result.cancelled) {
    await whatsapp.buttons(from, { body: 'What would you like to do next?', buttons: [
      { id: 'menu', title: 'Main Menu' }, { id: 'contact', title: 'Book a Call' }, { id: 'human', title: 'Talk to Human' },
    ] });
  }
  return true;
}

async function sendFlowChoices(to, step, options, prompt = 'Tap an option to continue') {
  const shortLabels = {
    "I'm a creator/influencer": 'Creator / influencer',
    "I'm starting a new business": 'Starting a business',
    'WhatsApp Enquiries': 'WhatsApp enquiries',
    'Lead Form Enquiries': 'Lead form enquiries',
    'Brand Awareness': 'Brand awareness',
    'Restaurant/Food Shoot': 'Restaurant/Food shoot',
    'Fashion/Model Shoot': 'Fashion/Model shoot',
    'Brand Promotional Reel': 'Brand promo reel',
  };
  await whatsapp.list(to, {
    body: prompt, button: 'Choose',
    sections: [{ title: 'Options', rows: options.map((text, index) => ({
        id: `flow_${step}_${index}`,
        title: `${options.length > 1 ? `${index + 1} ` : ''}${shortLabels[text] || text}`.slice(0, 24),
    })) }],
  });
}

async function handleIncomingInMemory(message, from) {
  if (processed.has(message.id)) return;
  processed.add(message.id);
  cleanupProcessed();

  const lead = leads.getLead(from);
  const conversationHistory = leads.getHistory ? leads.getHistory(from) : [];
  // A contact is only "first message" if they have never been welcomed AND
  // have no prior conversation history, service, or activity. This prevents
  // welcome messages from being re-sent to existing or handled contacts.
  const hasPriorActivity = Boolean(
    lead.welcomeSent ||
    lead.messageCount > 0 ||
    lead.service ||
    lead.name ||
    lead.business ||
    (conversationHistory || []).length > 0
  );
  const firstMessage = !hasPriorActivity;
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
  const durableHistoryEnabled = firestore.isConfigured();
  if (durableHistoryEnabled) await firestore.archiveIncoming(message, from);
  const testRecipient = isAlwaysAutomatedTestNumber(from);
  if (isSuppressedNumber(from)) return { ignored: true, reason: 'suppressed-number' };
  // In production an unknown contact cannot safely be treated as new unless
  // durable history is available. The designated test recipient is exempt.
  if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && !durableHistoryEnabled && !testRecipient) {
    return { ignored: true, reason: 'contact-history-unavailable' };
  }
  const messageTimestamp = Number(message.timestamp);
  const messageAgeMs = Date.now() - messageTimestamp * 1000;
  if (!testRecipient && Number.isFinite(messageTimestamp) && messageTimestamp > 0 && messageAgeMs > 24 * 60 * 60 * 1000) {
    return { ignored: true, reason: 'stale-inbound-message' };
  }
  if (process.env.BOT_ENABLED !== 'true' && !testRecipient) {
    if (!firestore.isConfigured()) throw new Error('Cannot archive incoming enquiry while automation is disabled');
    return { ignored: true, reason: 'automation-disabled-archived' };
  }
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
      if (storageUnavailable && !testRecipient) return { ignored: true, reason: 'contact-history-unavailable' };
      let record = null;
      let priorInboxMessage = false;
      if (firestoreEnabled) {
        // These independent point reads share a network round trip instead of
        // adding duplicate-check latency ahead of every WhatsApp reply.
        const [alreadyProcessed, storedRecord, hasPriorInboxMessage] = await Promise.all([
          message.id ? firestore.hasProcessedMessage(message.id) : false,
          firestore.getLeadByPhone(from),
          message.id ? firestore.hasPriorInboxMessage(from, message.id) : false,
        ]);
        if (alreadyProcessed) return;
        record = storedRecord;
        priorInboxMessage = hasPriorInboxMessage;
      }
      if (releaseLease) await releaseLease.assertOwnership();
      // A recordless contact with any earlier archived inbound is an old chat.
      // The designated test recipient is intentionally allowed to bypass this.
      if (priorInboxMessage && !testRecipient && !record && !leads.snapshot(from).length) {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'existing-contact-not-enrolled' };
      }
      const previouslyStored = Boolean(record || leads.snapshot(from).length || priorInboxMessage);
      if (record) {
        leads.restoreOne(record);
        leads.updateLead(from, { assignedTeam: record.crm?.owner || '', crm: record.crm || {} });
        flow.restoreFlow(from, record.activeFlow);
      }
      if (priorInboxMessage) leads.updateLead(from, { welcomeSent: true });
      const knownLead = leads.snapshot(from)[0]?.lead;
      // Enforce the existing-contact policy before any trigger paths, including
      // human handover, which otherwise could send an acknowledgement to an
      // old contact that is not explicitly enrolled for automation.
      if (previouslyStored && !testRecipient && !hasFirstContactEnrollment(record || leads.snapshot(from)[0])) {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'existing-contact-not-enrolled' };
      }
      if (!previouslyStored) {
        // Enrollment is only created when no prior lead record exists. This
        // timestamp is required at every outbound send boundary, so legacy
        // contacts cannot become eligible merely from stale flags or a menu tap.
        leads.updateLead(from, {
          automationEligible: true,
          automationEnrolledAt: new Date().toISOString(),
          contactType: 'New Lead',
          leadSource: message.referral ? 'Meta referral' : 'WhatsApp',
          referral: message.referral || null,
        });
        if (firestoreEnabled) await firestore.saveLead(leads.snapshot(from)[0]);
      }
      const body = message.type === 'text' ? (message.text?.body || '').trim() : '';
      const option = interactiveReplyId(message);
      const optedOutAlready = Boolean(
        knownLead?.optedOut || knownLead?.crm?.optedOut || record?.lead?.optedOut || record?.crm?.optedOut
      );
      if (optedOutAlready) {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'opted-out' };
      }
      const isNewServiceSelection = message.type === 'interactive' && SERVICE_IDS[option] && option !== 'service_team';
      // Human / call request detection runs before every other check — even for
      // completed or previously-stored contacts — so it can never be masked.
      const human = ['human', 'service_team', 'contact'].includes(option) || HUMAN_REQUEST_RE.test(body);
      const optedOut = /^(stop|unsubscribe|not interested|no thanks)$/i.test(body);
      if (human) {
        flow.cancelFlow(from);
        const current = leads.snapshot(from)[0];
        const alreadyAcked = current?.lead?.humanAckSent || record?.lead?.humanAckSent;
        const crm = { ...(record?.crm || {}), botPaused: true, humanTakeover: true };
        leads.updateLead(from, { humanRequested: true, conversationStatus: 'HANDOVER', humanAckSent: true }, );
        // preserve crm
        const snap = leads.snapshot(from)[0];
        if (snap) snap.lead.crm = crm;
        const handover = { status: 'Unassigned', requestedAt: new Date().toISOString(), callback: true };
        if (firestoreEnabled && snap) await firestore.saveLead({ ...snap, activeFlow: null, crm, handover });
        if (!alreadyAcked) {
          try { await whatsapp.forceText(from, "Thanks for reaching out. I've passed this to our sales team — they'll call you back shortly."); } catch (_) {}
          leads.addMessage(from, 'assistant', 'Thanks for reaching out. I\'ve passed this to our sales team — they\'ll call you back shortly.');
        }
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'human-handover' };
      }
      if (optedOut) {
        flow.cancelFlow(from);
        const current = leads.snapshot(from)[0];
        const crm = { ...(record?.crm || {}), botPaused: true, optedOut: true };
        leads.updateLead(from, { status: 'Non-qualified', optedOut: true, conversationStatus: 'OPTED_OUT' });
        const snap = leads.snapshot(from)[0]; if (snap) snap.lead.crm = crm;
        if (firestoreEnabled && snap) await firestore.saveLead({ ...snap, activeFlow: null, crm });
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'opted-out' };
      }
      const humanHasTakenOver = Boolean(
        knownLead?.humanRequested || knownLead?.crm?.humanTakeover || knownLead?.crm?.botPaused ||
        record?.crm?.humanTakeover || record?.crm?.botPaused
      );
      if (humanHasTakenOver) {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'human-takeover' };
      }
      if (!testRecipient && knownLead?.status === 'Qualified') {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'qualified-lead' };
      }
      // Completed conversations stay locked. Only an explicit new-service tap
      // may start a controlled new enquiry; everything else is silent.
      if (!testRecipient && (knownLead?.conversationStatus === 'COMPLETED' || knownLead?.completionMessageSent === true)) {
        if (!isNewServiceSelection) {
          // Notify salesperson for genuinely important post-completion requests,
          // but never send an automated customer reply.
          const isImportant = /\b(price|pricing|cost|proposal|budget|call|quote|demo|sample)\b/i.test(body);
          if (isImportant && firestoreEnabled) {
            const snap = leads.snapshot(from)[0];
            if (snap) await firestore.saveLead({ ...snap, notification: { type: 'post-completion-request', at: new Date().toISOString(), body: body.slice(0, 500) } });
          }
          if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
          return { ignored: true, reason: 'completed-flow' };
        }
        leadResetForNewEnquiry(from);
      }
      if (previouslyStored && !testRecipient && !eligibility(record || leads.snapshot(from)[0]).allowed) {
        if (firestoreEnabled && message.id) await firestore.markMessageProcessed(message.id, from);
        return { ignored: true, reason: 'existing-contact-not-enrolled' };
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

// WhatsApp Business App echoes are human-authored outbound messages. They are
// not customer messages and must never be sent through the auto-reply flow.
async function handleHumanEcho(message, to) {
  if (!to || !message?.id) return { ignored: true, reason: 'echo-recipient-unavailable' };
  const previous = phoneQueues.get(to) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    if (processed.has(message.id)) return { ignored: true, reason: 'duplicate-human-echo' };
    let releaseLease = null;
    const durable = firestore.isConfigured();
    try {
      if (durable) {
        releaseLease = await firestore.acquirePhoneLease(to);
        if (await firestore.hasProcessedMessage(message.id)) {
          processed.add(message.id);
          return { ignored: true, reason: 'duplicate-human-echo' };
        }
      }
      const record = durable ? await firestore.getLeadByPhone(to) : null;
      if (record) {
        leads.restoreOne(record);
        flow.restoreFlow(to, record.activeFlow);
      }
      const existing = leads.snapshot(to)[0];
      const crm = { ...(record?.crm || existing?.lead?.crm || {}), botPaused: true, humanTakeover: true };
      flow.cancelFlow(to);
      leads.updateLead(to, { humanRequested: true, conversationStatus: 'HANDOVER', humanAckSent: true, crm });

      const type = message.type || 'message';
      const content = message.text?.body || message.image?.caption || message.video?.caption || message.document?.caption || `[Human sent ${type}]`;
      const history = leads.getHistory(to);
      if (!history.some(item => item.id === message.id)) leads.addMessage(to, 'human', content, message.id);
      const current = leads.snapshot(to)[0];
      if (durable && current) {
        await firestore.saveLead({ ...current, activeFlow: null, crm });
        await firestore.markMessageProcessed(message.id, to);
      }
      processed.add(message.id);
      cleanupProcessed();
      return { humanTakeover: true };
    } finally {
      if (releaseLease) await releaseLease();
    }
  });
  phoneQueues.set(to, task);
  try {
    return await task;
  } finally {
    if (phoneQueues.get(to) === task) phoneQueues.delete(to);
  }
}

module.exports = { handleIncoming, handleHumanEcho, sendMenu, sendReply };
