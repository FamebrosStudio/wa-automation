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
      assert.ok(['conversational-acknowledgement', 'human-takeover'].includes(res.reason));
    }
    assert.equal(sent.length, beforeReaction, 'acknowledgements never trigger fallback menu');

    // Once auto-paused after 2+ unmatched messages, all further messages stay silent
    const unknown1 = await handleIncoming({ id: mid(), type: 'text', text: { body: 'what is the weather today' } }, phone);
    assert.ok(['unmatched-mid-conversation', 'human-takeover'].includes(unknown1.reason));
    const unknown2 = await handleIncoming({ id: mid(), type: 'text', text: { body: 'I am sending you the photo' } }, phone);
    assert.ok(['unmatched-mid-conversation', 'human-takeover'].includes(unknown2.reason));
    const hiLater = await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, phone);
    assert.equal(hiLater?.reason, 'human-takeover');
    assert.equal(sent.length, beforeReaction, 'mid-conversation messages never re-dump menu or fallback');

    // Quoted reply on an unseen contact is treated as an existing chat and stays silent
    const quotedRes = await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' }, context: { id: 'wamid.old123' } }, '919900010099');
    assert.equal(quotedRes.reason, 'existing-contact-not-enrolled');
    assert.equal(sent.length, beforeReaction);
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

    // Media during flow is recorded silently without interrupting
    const beforeMedia = sent.length;
    const imgRes = await handleIncoming({ id: mid(), type: 'image', image: { id: 'img1' } }, phone);
    assert.equal(imgRes.reason, 'non-text-silent');
    assert.equal(sent.length, beforeMedia);
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

test('unseen existing-chat signals stay silent and repeated invalid flow inputs auto-pause to manual', async () => {
  const { sent, leads, flow, restore } = setup();
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');

    // Unseen contact sending mid-thread phrase, media, or forwarded message stays silent
    const r1 = await handleIncoming({ id: mid(), type: 'text', text: { body: 'Hey any update on the invoice?' } }, '919900010101');
    const r2 = await handleIncoming({ id: mid(), type: 'image', image: { id: 'img-unseen' } }, '919900010102');
    const r3 = await handleIncoming({ id: mid(), type: 'text', text: { body: 'check this' }, context: { forwarded: true } }, '919900010103');
    assert.equal(r1.reason, 'existing-contact-not-enrolled');
    assert.equal(r2.reason, 'existing-contact-not-enrolled');
    assert.equal(r3.reason, 'existing-contact-not-enrolled');
    assert.equal(sent.length, 0);

    // 2 consecutive invalid answers in an active flow abandon the flow and pause the bot
    const p = '919900010104';
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'hi' } }, p);
    await handleIncoming({ id: mid(), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_social' } } }, p);
    assert.equal(flow.getCurrentStep(p).step, 'businessOwner');
    const beforeInvalid = sent.length;
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'wait let me check' } }, p);
    assert.equal(sent.length, beforeInvalid + 1);
    await handleIncoming({ id: mid(), type: 'text', text: { body: 'actually call later' } }, p);
    assert.equal(sent.length, beforeInvalid + 1, 'second invalid answer abandons flow silently');
    assert.equal(flow.hasActiveFlow(p), false);
    assert.equal(leads.getLead(p).conversationStatus, 'MANUAL');
    assert.equal(leads.getLead(p).crm.botPaused, true);

    // Subsequent message stays silent due to manual pause
    const afterPause = await handleIncoming({ id: mid(), type: 'text', text: { body: 'menu' } }, p);
    assert.equal(afterPause.reason, 'human-takeover');
    assert.equal(sent.length, beforeInvalid + 1);
  } finally { restore(); }
});
