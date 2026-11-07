const config = require('../config');

// Lead statuses
const STATUS = {
  QUALIFIED: 'Qualified',
  NON_CONFIRMED: 'Non-confirmed',
  NON_QUALIFIED: 'Non-qualified',
};

// In-memory conversation history (short-lived, resets on cold start)
const conversations = new Map(); // phone -> [{role, content, ts}]
const MAX_HISTORY = 12;

// Lead state tracking
const leads = new Map(); // phone -> { status, firstSeen, lastSeen, messages, interests, humanRequested }

function getLead(phone) {
  if (!leads.has(phone)) {
    leads.set(phone, {
      phone,
      status: STATUS.NON_CONFIRMED,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      messageCount: 0,
      interests: [],
      humanRequested: false,
      name: null,
      business: null,
      budget: null,
      timeline: null,
      notes: '',
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

// Qualification rules (chosen by us)
function classifyLead(phone, message, interactionType) {
  const lead = getLead(phone);
  const text = (message || '').toLowerCase();
  const now = new Date().toISOString();
  lead.lastSeen = now;
  lead.messageCount += 1;

  // Track interests
  const interestKeywords = {
    services: ['service', 'what do you do', 'offer', 'reel', 'content', 'social media', 'ads', 'marketing', 'seo', 'website'],
    packages: ['package', 'pricing', 'price', 'cost', 'plan', 'retainer', 'trial', 'budget'],
    process: ['process', 'how do you', 'steps', 'workflow', 'timeline', 'how long'],
    clients: ['client', 'case study', 'portfolio', 'work', 'brand', 'result', 'example'],
  };
  for (const [category, keys] of Object.entries(interestKeywords)) {
    if (keys.some((k) => text.includes(k))) {
      if (!lead.interests.includes(category)) lead.interests.push(category);
    }
  }

  // Detect business details sharing
  const businessPatterns = [
    /\b(my (business|company|brand|store|salon|restaurant|shop))\b/i,
    /\b(i (run|own|manage|have) (a|an|my)?)\b/i,
    /\b(budget|spend|invest)\b/i,
    /\b(months?|weeks?|days?)\b/i,
  ];
  for (const p of businessPatterns) {
    if (p.test(text)) lead.business = lead.business || text.slice(0, 100);
  }

  // Detect name sharing
  const nameMatch = text.match(/(?:i'm|i am|my name is|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i);
  if (nameMatch) lead.name = lead.name || nameMatch[1].trim();

  // Qualification logic
  let newStatus = lead.status;

  // 1. Explicit human request â†’ Qualified (highest priority)
  if (interactionType === 'human_request' || /\b(talk to (a )?human|speak (to|with) (a )?(person|agent|team|someone)|connect me|real person|live agent)\b/i.test(text)) {
    newStatus = STATUS.QUALIFIED;
    lead.humanRequested = true;
  }

  // 2. Booking/call request â†’ Qualified
  if (/\b(book|schedule|call|meeting|appointment|consultation|demo|quote|proposal)\b/i.test(text) && /\b(free|discovery|call|meeting|appointment)\b/i.test(text)) {
    newStatus = STATUS.QUALIFIED;
  }

  // 3. Sharing business details + clear intent â†’ Qualified
  if (lead.business && lead.messageCount >= 3 && lead.interests.length >= 2) {
    newStatus = STATUS.QUALIFIED;
  }

  // 4. High engagement (4+ messages with interest) â†’ Qualified
  if (lead.messageCount >= 4 && lead.interests.length >= 2) {
    newStatus = STATUS.QUALIFIED;
  }

  // 5. Explicit decline â†’ Non-qualified
  if (/\b(no thanks|not interested|just browsing|just looking|no need|don't need|stop|unsubscribe|leave me alone)\b/i.test(text)) {
    newStatus = STATUS.NON_QUALIFIED;
  }

  // 6. Spam/irrelevant â†’ Non-qualified
  if (/\b(viagra|casino|crypto scam|lottery|winner|click here|free money)\b/i.test(text)) {
    newStatus = STATUS.NON_QUALIFIED;
  }

  // 7. Interest shown but no human request â†’ Non-confirmed (default for engaged users)
  if (newStatus === lead.status && lead.interests.length > 0 && lead.messageCount >= 2) {
    newStatus = STATUS.NON_CONFIRMED;
  }

  // Don't downgrade from Qualified
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
    interests: lead.interests,
    messageCount: lead.messageCount,
    humanRequested: lead.humanRequested,
    firstSeen: lead.firstSeen,
    lastSeen: lead.lastSeen,
    conversationSummary: lastMessages,
  };
}

module.exports = {
  STATUS,
  getLead,
  addMessage,
  getHistory,
  classifyLead,
  getLeadSummary,
};
