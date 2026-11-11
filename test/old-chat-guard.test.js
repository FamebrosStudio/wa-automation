const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('an earlier archived inbound blocks enrollment for ordinary contacts after CRM cleanup', async () => {
  process.env.BOT_ENABLED = 'true';
  const leads = require('../src/services/leads');
  const flow = require('../src/services/flow');
  const phone = '919900007777';
  leads.restore([]);
  flow.cancelFlow(phone);
  const sent = [];
  let markedProcessed = false;
  let released = false;
  const storedRecords = new Map();
  const release = async () => { released = true; };
  release.assertOwnership = async () => {};
  const firestore = {
    isConfigured: () => true,
    archiveIncoming: async () => {},
    acquirePhoneLease: async () => release,
    hasProcessedMessage: async () => false,
    getLeadByPhone: async (number) => storedRecords.get(number) || null,
    saveLead: async () => true,
    hasPriorInboxMessage: async (number, messageId) =>
      (number === phone && ['old-thread-message', 'legacy-record-message'].includes(messageId)) ||
      (number === '919892506314' && messageId === 'test-old-thread'),
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

    storedRecords.set(phone, { phone, lead: { phone, automationEligible: true }, history: [] });
    const legacy = await handleIncoming({ id: 'legacy-record-message', type: 'text', text: { body: 'hi' } }, phone);
    assert.equal(legacy.reason, 'existing-contact-not-enrolled', 'the test-number exception must not enroll legacy records');
    assert.equal(sent.length, 0, 'a stale test-number chat remains silent even when its lead record exists');

    const testPhone = '919892506314';
    const beforeTestNumber = sent.length;
    const testResult = await handleIncoming({ id: 'test-old-thread', type: 'text', text: { body: 'hi' } }, testPhone);
    assert.ok(!testResult?.reason, 'the designated test number bypasses archived old-chat suppression');
    assert.ok(sent.length > beforeTestNumber, 'the test number can still exercise the welcome/menu flow');

  } finally {
    Module._load = realLoad;
    delete require.cache[handlerPath];
  }
});
