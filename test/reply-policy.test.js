const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('known contacts are ignored unless they explicitly prefix a message with bot:', async () => {
  const sent = [];
  const whatsapp = {
    text: async (to, body) => sent.push({ type: 'text', to, body }),
    list: async (to, body) => sent.push({ type: 'list', to, body }),
    buttons: async (to, body) => sent.push({ type: 'buttons', to, body }),
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.endsWith('src\\handlers\\messageHandler.js') && request === '../services/whatsapp') return whatsapp;
    if (parent?.filename.endsWith('src\\handlers\\messageHandler.js') && request === '../services/firestore') {
      return { isConfigured: () => false };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    const phone = '919900001234';
    await handleIncoming({ id: 'new-1', type: 'text', text: { body: 'hello' } }, phone);
    const firstContactReplies = sent.length;
    assert.ok(firstContactReplies > 0, 'first-time sender should receive the welcome menu');

    const ignored = await handleIncoming({ id: 'old-1', type: 'text', text: { body: 'hi' } }, phone);
    assert.equal(ignored.ignored, true);
    assert.equal(sent.length, firstContactReplies, 'ordinary messages from a known contact should be ignored');

    await handleIncoming({ id: 'old-2', type: 'text', text: { body: 'bot: hi' } }, phone);
    assert.ok(sent.length > firstContactReplies, 'bot: prefix should explicitly request a reply');

    const leads = require('../src/services/leads');
    const flow = require('../src/services/flow');
    flow.startServiceFlow(phone, 'website');
    const beforeFlowReply = sent.length;
    await handleIncoming({ id: 'flow-1', type: 'text', text: { body: 'Business Website' } }, phone);
    assert.ok(sent.length > beforeFlowReply, 'an existing contact should receive replies while continuing an active flow');

    leads.getLead(phone).status = 'Qualified';
    const beforeQualifiedMessage = sent.length;
    const qualifiedResult = await handleIncoming({ id: 'qualified-1', type: 'text', text: { body: 'bot: hi' } }, phone);
    assert.equal(qualifiedResult.reason, 'qualified-lead');
    assert.equal(sent.length, beforeQualifiedMessage, 'qualified contacts must never receive bot replies');
  } finally {
    Module._load = originalLoad;
  }
});
