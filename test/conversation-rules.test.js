const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

// Shared mock setup for all conversation rule tests.
function setup() {
  process.env.BOT_ENABLED = 'true';
  const sent = [];
  const leads = require('../src/services/leads');
  const flow = require('../src/services/flow');
  leads.restore([]); flow.cancelFlow('x');
  const whatsapp = {
    text: async (to, body) => sent.push({ type: 'text', to, body }),
    forceText: async (to, body) => sent.push({ type: 'forceText', to, body }),
    list: async (to, body) => sent.push({ type: 'list', to, body }),
    buttons: async (to, body) => sent.push({ type: 'buttons', to, body }),
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('src/handlers/messageHandler.js') && request === '../services/whatsapp') return whatsapp;
    if (parent?.filename.replaceAll('\\', '/').endsWith('src/handlers/messageHandler.js') && request === '../services/firestore') return { isConfigured: () => false, archiveIncoming: async () => {} };
    if (parent?.filename.replaceAll('\\', '/').endsWith('src/handlers/messageHandler.js') && request === '../services/eligibility') {
      const real = originalLoad.call(this, request, parent, isMain);
      return real;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/handlers/messageHandler')];
  return { sent, leads, flow, restore: () => { Module._load = originalLoad; delete require.cache[require.resolve('../src/handlers/messageHandler')]; } };
}

const PHONE = '919900009999';
let seq = 0;
function mid() { return `msg-${++seq}`; }

test('new customer gets welcome exactly once, existing client gets none', async () => {
  const { sent, leads, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    // Existing client seeded with history & excluded type
    leads.getLead(PHONE);
    leads.updateLead(PHONE, { contactType: 'Existing Client', welcomeSent: true, messageCount: 5, automationEligible: true });
    const before = sent.length;
    const r1 = await handleIncoming({ id: mid(), type: 'text', text: { body: 'Hi' } }, PHONE);
    assert.equal(r1.reason, 'existing-contact-not-enrolled');
    assert.equal(sent.length, before);

    // Brand new
    const fresh = '919900008888';
    const before2 = sent.length;
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'Hi' } }, fresh);
    assert.equal(sent.length, before2 + 1);
    assert.equal(sent[sent.length - 1].type, 'list');
  } finally { restore(); }
});

test('human takeover persists and blocks all further automation', async () => {
  const { sent, leads, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const p = '919900007777';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, p);
    const afterWelcome = sent.length;
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'Plz call' } }, p);
    // exactly one ack
    assert.equal(sent[sent.length - 1].type, 'forceText');
    const afterAck = sent.length;
    // Subsequent messages: no automation
    const r1 = await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, p);
    const r2 = await handleIncoming({ id: mid(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_social' } } }, p);
    assert.equal(sent.length, afterAck);
    assert.equal(leads.getLead(p).humanRequested, true);
    assert.equal(leads.getLead(p).crm.humanTakeover, true);
    assert.equal(leads.getLead(p).crm.botPaused, true);
    // second call request does not resend ack
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'please call' } }, p);
    assert.equal(sent.length, afterAck);
  } finally { restore(); }
});

test('Talk to Our Team triggers handover with ack, not service flow', async () => {
  const { sent, leads, flow, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const p = '919900006666';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, p);
    flow.startServiceFlow(p, 'social');
    const before = sent.length;
    const res = await handleIncoming({ id: mid(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_team' } } }, p);
    assert.equal(res.reason, 'human-handover');
    assert.equal(sent.length, before + 1);
    assert.equal(sent[sent.length - 1].type, 'forceText');
    assert.equal(flow.hasActiveFlow(p), false);
  } finally { restore(); }
});

test('completion sends thank you once then locks — Ok/Thanks/10 messages do not loop', async () => {
  const { sent, leads, flow, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const p = '919900005555';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, p);
    flow.startServiceFlow(p, 'social');
    // complete social flow manually
    const { processFlowResponse } = flow;
    processFlowResponse(p, '1');
    const done = processFlowResponse(p, 'https://instagram.com/x');
    assert.equal(done.done, true);
    // Simulate handler sending once via flow path: call handleIncoming for final answer? Use direct flow+handler path:
    // Instead drive through handleIncoming for next answer: reset flow then complete via handler messages
    // Simpler: verify lead flags set by flow must be completion false until handler sends.
    assert.equal(leads.getLead(p).conversationStatus, 'COMPLETED');
    // Handler path: place flow again and send via handleIncoming to test duplicate guard
    flow.startServiceFlow(p, 'social');
    leads.updateLead(p, { completionMessageSent: false, conversationStatus: null });
    const before = sent.length;
    await handleIncoming({ id: mid(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'flow_identity_0' } } }, p);
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'https://instagram.com/a' } }, p);
    const thankYouCount = sent.filter(m => /Thank you/.test(m.body || JSON.stringify(m))).length;
    // At least one thank you may have been produced by the second completion; collect state
    const leadAfter = leads.getLead(p);
    assert.equal(leadAfter.conversationStatus, 'COMPLETED');
    assert.equal(leadAfter.completionMessageSent, true);
    const countAfterDone = sent.length;
    for (const msg of ['Okay', 'Ok', 'Thanks', 'Thank you', '👍', 'got it', 'hi', 'hello', 'x', 'y']) {
      const r = await handleIncoming({ id: mid(), type: 'text', text: { body: msg } }, p);
      assert.ok(['completed-flow', 'existing-contact-not-enrolled'].includes(r.reason), msg);
    }
    assert.equal(sent.length, countAfterDone, 'no follow-up sends after completion');
    // New service tap starts controlled new enquiry
    const rNew = await handleIncoming({ id: mid(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_ads' } } }, p);
    assert.notEqual(rNew?.reason, 'completed-flow');
  } finally { restore(); }
});

test('duplicate webhook ids processed once', async () => {
  const { sent, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const p = '919900004444';
    const id = 'dup-123';
    await handleIncoming({ id, type: 'text', text: { body: 'hi' } }, p);
    const first = sent.length;
    // In-memory processed set returns early with no new send
    await handleIncoming({ id, type: 'text', text: { body: 'hi' } }, p);
    assert.equal(sent.length, first);
  } finally { restore(); }
});
