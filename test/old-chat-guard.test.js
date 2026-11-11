const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('an earlier archived inbound blocks enrollment even for the test recipient after CRM cleanup', async () => {
  process.env.BOT_ENABLED = 'true';
  const leads = require('../src/services/leads');
  const flow = require('../src/services/flow');
  const phone = '919892506314';
  leads.restore([]);
  flow.cancelFlow(phone);
  const sent = [];
  let markedProcessed = false;
  let released = false;
  let storedRecord = null;
  const release = async () => { released = true; };
  release.assertOwnership = async () => {};
  const firestore = {
    isConfigured: () => true,
    archiveIncoming: async () => {},
    acquirePhoneLease: async () => release,
    hasProcessedMessage: async () => false,
    getLeadByPhone: async () => storedRecord,
    saveLead: async () => true,
    hasPriorInboxMessage: async (number, messageId) => number === phone && ['old-thread-message', 'marked-test-chat-message', 'new-test-service'].includes(messageId),
    markMessageProcessed: async () => { markedProcessed = true; },
  };
  const whatsapp = {
    text: async (...args) => sent.push(args),
    list: async (...args) => sent.push(args),
    buttons: async (...args) => sent.push(args),
    forceText: async (...args) => sent.push(args),
  };
  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/handlers/messageHandler.js')) {
      if (request === '../services/firestore') return firestore;
      if (request === '../services/whatsapp') return whatsapp;
    }
    return realLoad.call(this, request, parent, isMain);
  };
  const handlerPath = require.resolve('../src/handlers/messageHandler');
  delete require.cache[handlerPath];
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const result = await handleIncoming({ id: 'old-thread-message', type: 'text', text: { body: 'hello' } }, phone);
    assert.equal(result.reason, 'existing-contact-not-enrolled');
    assert.equal(sent.length, 0, 'no reply is sent to a chat known only from prior inbox history');
    assert.equal(markedProcessed, true);
    assert.equal(released, true);
    assert.equal(leads.getLead(phone).automationEnrolledAt, undefined);

    storedRecord = { phone, lead: { phone, automationEligible: true }, history: [] };
    const legacy = await handleIncoming({ id: 'legacy-record-message', type: 'text', text: { body: 'hi' } }, phone);
    assert.equal(legacy.reason, 'existing-contact-not-enrolled', 'the test-number exception must not enroll legacy records');
    assert.equal(sent.length, 0, 'a stale test-number chat remains silent even when its lead record exists');

    storedRecord = { phone, lead: { phone, automationEligible: true, automationEnrolledAt: new Date().toISOString() }, history: [], activeFlow: null };
    const repeatedGreeting = await handleIncoming({ id: 'marked-test-chat-message', type: 'text', text: { body: 'hi' } }, phone);
    assert.equal(repeatedGreeting.reason, 'test-chat-requires-active-flow-or-service-selection');
    assert.equal(sent.length, 0, 'an old greeting cannot restart a test chat after cleanup');

    const deliberateSelection = await handleIncoming({
      id: 'new-test-service', type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'service_website' } },
    }, phone);
    assert.ok(!deliberateSelection?.reason, 'an explicit service tap is allowed to begin a fresh test flow');
    assert.equal(flow.hasActiveFlow(phone), true);
    assert.equal(sent.some(([, body]) => typeof body === 'string' && /welcome to famebros/i.test(body)), false, 'historic contacts do not receive a duplicate welcome');
  } finally {
    Module._load = realLoad;
    delete require.cache[handlerPath];
  }
});
