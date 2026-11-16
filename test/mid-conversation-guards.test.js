const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function setup(firestoreOverrides = {}) {
  process.env.BOT_ENABLED = 'true';
  const sent = [];
  const savedLeads = [];
  const leads = require('../src/services/leads');
  const flow = require('../src/services/flow');
  leads.restore([]);
  const whatsapp = {
    text: async (to, body) => sent.push({ type: 'text', to, body }),
    forceText: async (to, body) => sent.push({ type: 'forceText', to, body }),
    list: async (to, body) => sent.push({ type: 'list', to, body }),
    buttons: async (to, body) => sent.push({ type: 'buttons', to, body }),
  };
  const firestore = {
    isConfigured: () => false,
    archiveIncoming: async () => {},
    saveLead: async (item) => { savedLeads.push(item); return true; },
    ...firestoreOverrides,
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('src/handlers/messageHandler.js')) {
      if (request === '../services/whatsapp') return whatsapp;
      if (request === '../services/firestore') return firestore;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/handlers/messageHandler')];
  return {
    sent,
    savedLeads,
    leads,
    flow,
    restore: () => {
      Module._load = originalLoad;
      delete require.cache[require.resolve('../src/handlers/messageHandler')];
    },
  };
}

let seq = 0;
const mid = () => `mid-conv-${++seq}`;

test('reactions, stickers, and casual acknowledgements do not interrupt conversations', async () => {
  const { sent, flow, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const phone = '919900010001';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, phone);
    assert.equal(sent.length, 1);

    const beforeReaction = sent.length;
    const reactionRes = await handleIncoming({ id: mid(), type: 'reaction', reaction: { emoji: '👍' } }, phone);
    assert.equal(reactionRes.reason, 'ignored-reaction');
    const stickerRes = await handleIncoming({ id: mid(), type: 'sticker', sticker: { id: 's1' } }, phone);
    assert.equal(stickerRes.reason, 'ignored-sticker');
    assert.equal(sent.length, beforeReaction);

    for (const ack of ['ok', 'Thanks!', 'sure', 'got it', '👍']) {
      const res = await handleIncoming({ id: mid(), type: 'text', text: { body: ack } }, phone);
      assert.equal(res.reason, 'conversational-acknowledgement');
    }
    assert.equal(sent.length, beforeReaction, 'acknowledgements never trigger fallback menu');

    // Unknown text triggers fallback at most once, then stays silent
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'what is the weather today' } }, phone);
    const afterFirstFallback = sent.length;
    assert.ok(afterFirstFallback > beforeReaction);
    const secondUnknown = await handleIncoming({ id: mid(), type: 'text', text: { body: 'still chatting here' } }, phone);
    assert.equal(secondUnknown.reason, 'fallback-already-sent');
    assert.equal(sent.length, afterFirstFallback);
    flow.cancelFlow(phone);
  } finally { restore(); }
});

test('active flow answers with greetings or keywords do not cancel the flow', async () => {
  const { sent, leads, flow, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const phone = '919900010002';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, phone);
    await handleIncoming({ id: mid(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_ads' } } }, phone);
    assert.equal(flow.getCurrentStep(phone).step, 'clientName');

    await handleIncoming({ id: mid(), type: 'text', text: { body: "Hi I'm Priya" } }, phone);
    assert.equal(flow.getCurrentStep(phone).step, 'businessName', 'greeting inside name answer must not restart menu');
    assert.equal(leads.getLead(phone).name, "Hi I'm Priya");

    await handleIncoming({ id: mid(), type: 'text', text: { body: 'Human Hair Studio' } }, phone);
    assert.equal(flow.getCurrentStep(phone).step, 'location', 'business name containing "human" must not cancel flow');
    assert.equal(leads.getLead(phone).business, 'Human Hair Studio');

    await handleIncoming({ id: mid(), type: 'text', text: { body: 'Mumbai' } }, phone);
    assert.equal(flow.getCurrentStep(phone).step, 'product');

    // Media during flow notifies at most once and never dumps Main Menu
    const beforeMedia = sent.length;
    await handleIncoming({ id: mid(), type: 'image', image: { id: 'img1' } }, phone);
    assert.equal(sent.length, beforeMedia + 1);
    assert.equal(sent.at(-1).type, 'text');
    await handleIncoming({ id: mid(), type: 'image', image: { id: 'img2' } }, phone);
    assert.equal(sent.length, beforeMedia + 1, 'second image does not repeat text-only notice');
    flow.cancelFlow(phone);
  } finally { restore(); }
});

test('casual mentions of call do not trigger handover, while normalized human echo pauses across phone formats', async () => {
  const { sent, leads, restore } = setup();
  try {
    const { handleIncoming, handleHumanEcho } = require('../src/handlers/messageHandler');
    const phone = '919900010003';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, phone);
    const beforeCallMention = sent.length;
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'We had a call yesterday' } }, phone);
    assert.equal(leads.getLead(phone).humanRequested, false);
    assert.equal(sent.filter(m => m.type === 'forceText').length, 0);

    // Human echo using formatted number pauses canonicalized phone
    await handleHumanEcho({ id: 'echo-formatted-1', type: 'text', text: { body: 'Hey, continuing from earlier' } }, '+91 99000 10003');
    const afterEcho = sent.length;
    const next = await handleIncoming({ id: mid(), type: 'text', text: { body: 'Hello?' } }, '919900010003');
    assert.equal(next.reason, 'human-takeover');
    assert.equal(sent.length, afterEcho);
    assert.ok(afterEcho >= beforeCallMention);
  } finally { restore(); }
});

test('webhook ignores messages from the business display phone number itself', async () => {
  const handlerPath = require.resolve('../src/handlers/messageHandler');
  const incomingCalls = [];
  const originalCache = require.cache[handlerPath];
  require.cache[handlerPath] = {
    id: handlerPath,
    filename: handlerPath,
    loaded: true,
    exports: {
      handleIncoming: async (msg, from) => incomingCalls.push({ msg, from }),
      handleHumanEcho: async () => {},
    },
  };
  delete require.cache[require.resolve('../src/index')];
  const app = require('../src/index');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [{
          changes: [{
            value: {
              metadata: { display_phone_number: '+91 98923 84424' },
              messages: [{ id: 'self-1', from: '919892384424', type: 'text', text: { body: 'hi' } }],
            },
          }],
        }],
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(incomingCalls.length, 0);
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    if (originalCache) require.cache[handlerPath] = originalCache;
    else delete require.cache[handlerPath];
    delete require.cache[require.resolve('../src/index')];
  }
});
