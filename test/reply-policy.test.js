const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('only newly enrolled contacts and their active flows receive automation', async () => {
  process.env.BOT_ENABLED = 'true';
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
    const leads = require('../src/services/leads');
    const flow = require('../src/services/flow');
    const oldPhone = '919900001111';
    leads.getLead(oldPhone); // Represents a lead already stored before rollout.
    flow.startServiceFlow(oldPhone, 'website');
    const beforeOld = sent.length;
    const oldResult = await handleIncoming({ id: 'old-1', type: 'text', text: { body: 'bot: hi' } }, oldPhone);
    assert.equal(oldResult.reason, 'existing-contact-not-enrolled');
    assert.equal(sent.length, beforeOld, 'old contacts must remain silent, even with bot: or an active flow');
    const oldHumanRequest = await handleIncoming({ id: 'old-human', type: 'text', text: { body: 'please call me' } }, oldPhone);
    assert.equal(oldHumanRequest.reason, 'existing-contact-not-enrolled');
    assert.equal(sent.length, beforeOld, 'old contacts must not receive even a human-handover acknowledgement');
    leads.getLead(oldPhone).welcomeSent = true;
    const beforeOldOption = sent.length;
    await handleIncoming({ id: 'old-option', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_website' } } }, oldPhone);
    assert.equal(sent.length, beforeOldOption, 'menu selections must not bypass old-contact exclusions');
    assert.notEqual(leads.getLead(oldPhone).automationEligible, true);
    const beforeOldFlowReply = sent.length;
    await handleIncoming({ id: 'old-flow-reply', type: 'text', text: { body: 'Business Website' } }, oldPhone);
    assert.equal(sent.length, beforeOldFlowReply, 'old unfinished flows stay silent');

    const newPhone = '919900001234';
    await handleIncoming({ id: 'new-1', type: 'text', text: { body: 'hello' } }, newPhone);
    const firstContactReplies = sent.length;
    assert.ok(firstContactReplies > beforeOld, 'first-time sender should receive the welcome menu');
    assert.equal(leads.getLead(newPhone).automationEligible, true);

    flow.startServiceFlow(newPhone, 'website');
    const beforeFlowReply = sent.length;
    await handleIncoming({ id: 'flow-1', type: 'text', text: { body: 'Business Website' } }, newPhone);
    assert.ok(sent.length > beforeFlowReply, 'newly enrolled contacts should receive replies while continuing an active flow');

    leads.getLead(newPhone).status = 'Qualified';
    const beforeQualifiedMessage = sent.length;
    const qualifiedResult = await handleIncoming({ id: 'qualified-1', type: 'text', text: { body: 'hi' } }, newPhone);
    assert.ok(['qualified-lead', 'existing-contact-not-enrolled'].includes(qualifiedResult.reason));
    assert.equal(sent.length, beforeQualifiedMessage, 'qualified contacts must never receive bot replies');
  } finally {
    Module._load = originalLoad;
  }
});
