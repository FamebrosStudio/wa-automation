const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('an earlier archived inbound blocks enrollment and all replies when no CRM lead exists', async () => {
  process.env.BOT_ENABLED = 'true';
  const leads = require('../src/services/leads');
  const flow = require('../src/services/flow');
  const phone = '919900007777';
  leads.restore([]);
  flow.cancelFlow(phone);
  const sent = [];
  let markedProcessed = false;
  let released = false;
  const release = async () => { released = true; };
  release.assertOwnership = async () => {};
  const firestore = {
    isConfigured: () => true,
    archiveIncoming: async () => {},
    acquirePhoneLease: async () => release,
    hasProcessedMessage: async () => false,
    getLeadByPhone: async () => null,
    hasPriorInboxMessage: async (number, messageId) => number === phone && messageId === 'old-thread-message',
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
  } finally {
    Module._load = realLoad;
    delete require.cache[handlerPath];
  }
});
