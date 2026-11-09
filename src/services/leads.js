const config = require('../config');

const STATUS = {
  QUALIFIED: 'Qualified',
  NON_CONFIRMED: 'Non-confirmed',
  NON_QUALIFIED: 'Non-qualified',
};

const conversations = new Map();
const MAX_HISTORY = 12;
const leads = new Map();

function getLead(phone) {
  if (!leads.has(phone)) {
    leads.set(phone, {
      phone,
      status: null,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      messageCount: 0,
      interests: [],
      humanRequested: false,
      welcomeSent: false,
      name: null,
      business: null,
      budget: null,
      timeline: null,
      notes: '',
      service: null,
      assignedTeam: null,
      serviceDetails: {},
    });
  }
  return leads.get(phone);
}

function addMessage(phone, role, content) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  const history = conversations.get(phone);
  history.push({ role, content, ts: Date.now() });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

function getHistory(phone) {
  return conversations.get(phone) || [];
}

function classifyLead(phone, message, interactionType) {
  const lead = getLead(phone);
  const rawText = (message || '').toLowerCase();
  const text = /^flow_(budget|timeline)_\d+$/.test(rawText) ? '' : rawText;
  const now = new Date().toISOString();
  lead.lastSeen = now;
  lead.messageCount += 1;

  const interestKeywords = {
    services: ['service', 'what do you do', 'offer', 'reel', 'content', 'social media', 'ads', 'marketing'],
    packages: ['package', 'pricing', 'price', 'cost', 'plan', 'retainer', 'trial', 'budget'],
    process: ['process', 'how do you', 'steps', 'workflow', 'timeline', 'how long'],
    clients: ['client', 'case study', 'portfolio', 'work', 'brand', 'result', 'example'],
  };
  for (const [category, keys] of Object.entries(interestKeywords)) {
    if (keys.some((k) => text.includes(k))) {
      if (!lead.interests.includes(category)) lead.interests.push(category);
    }
  }

  const businessPatterns = [
    /\b(my (business|company|brand|store|salon|restaurant|shop))\b/i,
    /\b(i (run|own|manage|have) (a|an|my)?)\b/i,
    /\b(budget|spend|invest)\b/i,
    /\b(months?|weeks?|days?)\b/i,
  ];
  for (const p of businessPatterns) {
    if (p.test(text)) lead.business = lead.business || text.slice(0, 100);
  }

  const nameMatch = text.match(/(?:i'm|i am|my name is|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i);
  if (nameMatch) lead.name = lead.name || nameMatch[1].trim();

  let newStatus = [STATUS.QUALIFIED, STATUS.NON_CONFIRMED, STATUS.NON_QUALIFIED].includes(lead.status)
    ? lead.status
    : null;

  if (interactionType === 'human_request' || /\b(talk to (a )?human|speak (to|with) (a )?(person|agent|team|someone)|connect me|real person|live agent)\b/i.test(text)) {
    lead.humanRequested = true;
  }

  if (/\b(no thanks|not interested|just browsing|just looking|no need|don't need|stop|unsubscribe|leave me alone)\b/i.test(text)) {
    newStatus = STATUS.NON_QUALIFIED;
  }

  if (/\b(viagra|casino|crypto scam|lottery|winner|click here|free money)\b/i.test(text)) {
    newStatus = STATUS.NON_QUALIFIED;
  }

  if (lead.status === STATUS.QUALIFIED && newStatus !== STATUS.QUALIFIED) {
    newStatus = lead.status;
  }

  lead.status = newStatus;
  return { status: newStatus, lead };
}

function getLeadSummary(phone) {
  const lead = getLead(phone);
  const history = getHistory(phone);
  const lastMessages = history.slice(-5).map((h) => `${h.role}: ${h.content.slice(0, 120)}`).join(' | ');
  return {
    phone,
    status: lead.status,
    name: lead.name,
    business: lead.business,
    budget: lead.budget,
    timeline: lead.timeline,
    interests: lead.interests,
    messageCount: lead.messageCount,
    humanRequested: lead.humanRequested,
    service: lead.service,
    assignedTeam: lead.assignedTeam,
    serviceDetails: lead.serviceDetails,
    welcomeSent: lead.welcomeSent,
    firstSeen: lead.firstSeen,
    lastSeen: lead.lastSeen,
    conversationSummary: lastMessages,
  };
}

function getAllLeads() {
  return Array.from(leads.values());
}

function updateLead(phone, updates) {
  Object.assign(getLead(phone), updates);
  return getLead(phone);
}

// Replace the process cache with a durable-store snapshot at request start.
function restore(snapshot = []) {
  leads.clear();
  conversations.clear();
  for (const item of snapshot) {
    if (!item || !item.phone || !item.lead) continue;
    normalizeStatus(item.lead);
    leads.set(item.phone, item.lead);
    conversations.set(item.phone, Array.isArray(item.history) ? item.history.slice(-MAX_HISTORY) : []);
  }
}

function restoreOne(item) {
  if (!item || !item.phone || !item.lead) return;
  normalizeStatus(item.lead);
  leads.set(item.phone, item.lead);
  conversations.set(item.phone, Array.isArray(item.history) ? item.history.slice(-MAX_HISTORY) : []);
}

function normalizeStatus(lead) {
  if (![STATUS.QUALIFIED, STATUS.NON_CONFIRMED, STATUS.NON_QUALIFIED].includes(lead.status)) {
    lead.status = null;
  }
}

function snapshot(phone) {
  const selected = phone ? [phone] : Array.from(leads.keys());
  return selected.filter((key) => leads.has(key)).map((key) => ({
    phone: key,
    lead: leads.get(key),
    history: conversations.get(key) || [],
  }));
}

module.exports = {
  STATUS,
  getLead,
  addMessage,
  getHistory,
  classifyLead,
  updateLead,
  getLeadSummary,
  getAllLeads,
  restore,
  restoreOne,
  snapshot,
};
