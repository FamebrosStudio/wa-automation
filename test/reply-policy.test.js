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
    leads.updateLead(oldPhone, { automationEligible: true }); // stale legacy flag must not enroll it
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
    assert.equal(leads.getLead(oldPhone).automationEnrolledAt, undefined, 'old contacts never receive the first-contact enrollment marker');
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

    const socialPhone = '919900001235';
    await handleIncoming({ id: 'social-hello', type: 'text', text: { body: 'hi' } }, socialPhone);
    await handleIncoming({ id: 'social-select', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_social' } } }, socialPhone);
    const businessOptionMenu = sent.filter((item) => item.type === 'list').at(-1).body;
    assert.equal(businessOptionMenu.sections[0].rows.length, 1);
    assert.equal(businessOptionMenu.sections[0].rows[0].title, 'I own a business');
    assert.equal(businessOptionMenu.sections[0].rows[0].description, undefined);

    const websitePhone = '919900001236';
    await handleIncoming({ id: 'website-hello', type: 'text', text: { body: 'hi' } }, websitePhone);
    await handleIncoming({ id: 'website-service', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'service_website' } } }, websitePhone);
    const websiteChoices = sent.filter((item) => item.type === 'list').at(-1).body.sections[0].rows;
    assert.ok(websiteChoices.some((item) => item.title === '3 Portfolio Website'));
    assert.ok(websiteChoices.every((item) => item.description === undefined), 'example helper text is not sent to customers');
    await handleIncoming({ id: 'website-choice', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'flow_websiteType_2' } } }, websitePhone);
    assert.equal(leads.getLead(websitePhone).serviceDetails.websiteType, 'Portfolio Website', 'the selected option is recorded without its example helper text');
    assert.equal(sent.at(-1).body, 'What is your Business Name?');

    leads.getLead(newPhone).status = 'Qualified';
    const beforeQualifiedMessage = sent.length;
    const qualifiedResult = await handleIncoming({ id: 'qualified-1', type: 'text', text: { body: 'hi' } }, newPhone);
    assert.ok(['qualified-lead', 'existing-contact-not-enrolled'].includes(qualifiedResult.reason));
    assert.equal(sent.length, beforeQualifiedMessage, 'qualified contacts must never receive bot replies');

    const testPhone = '+91 98925 06314';
    leads.updateLead(testPhone, { status: 'Qualified', humanRequested: true, automationEligible: true, automationEnrolledAt: new Date().toISOString() });
    process.env.BOT_ENABLED = 'false';
    const beforeTestPhone = sent.length;
    await handleIncoming({ id: 'test-recipient-1', type: 'text', text: { body: 'hi' } }, testPhone);
    assert.ok(sent.length > beforeTestPhone, 'the enrolled designated test recipient can test replies while global automation is off');
    process.env.BOT_ENABLED = 'true';

    const beforeBlocked = sent.length;
    const blocked = await handleIncoming({ id: 'blocked-number', type: 'text', text: { body: 'hello' } }, '+91 98923 28946');
    assert.equal(blocked.reason, 'suppressed-number');
    const stale = await handleIncoming({
      id: 'stale-message', type: 'text', timestamp: String(Math.floor(Date.now() / 1000) - 25 * 60 * 60),
      text: { body: 'hello' },
    }, '919900007654');
    assert.equal(stale.reason, 'stale-inbound-message');
    assert.equal(sent.length, beforeBlocked, 'blocked contacts and stale webhooks must never trigger sends');
  } finally {
    Module._load = originalLoad;
  }
});
