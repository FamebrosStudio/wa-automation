const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('send boundary checks fresh CRM permissions for every message and global OFF', async () => {
  let calls = 0;
  let record = { lead: { automationEligible: true, automationEnrolledAt: new Date().toISOString() }, crm: {} };
  const originalLoad = Module._load;
  const originalEnabled = process.env.BOT_ENABLED;
  Module._load = function (request, parent, main) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/services/whatsapp.js')) {
      if (request === 'axios') return { post: async () => { calls++; return { data: {} }; } };
      if (request === '../config') return { whatsappToken: 'test-only', phoneNumberId: 'test-only' };
      if (request === './firestore') return { isConfigured: () => true, getLeadByPhone: async () => record };
    }
    return originalLoad.call(this, request, parent, main);
  };
  try {
    const whatsapp = require('../src/services/whatsapp');
    process.env.BOT_ENABLED = 'false';
    await assert.rejects(whatsapp.text('test', 'one'), /disabled/);
    assert.equal(calls, 0);
    process.env.BOT_ENABLED = 'true';
    await whatsapp.text('test', 'one');
    record.crm.humanTakeover = true;
    await assert.rejects(whatsapp.text('test', 'two'), /suppressed/);
    assert.equal(calls, 1);
    record = null;
    await assert.rejects(whatsapp.text('test', 'three'), /unverified-contact/);
    assert.equal(calls, 1);
    process.env.BOT_ENABLED = 'false';
    await whatsapp.text('+91 98925 06314', 'test-only message');
    assert.equal(calls, 2, 'the configured test number bypasses CRM and global automation gates');
  } finally {
    Module._load = originalLoad;
    if (originalEnabled === undefined) delete process.env.BOT_ENABLED;
    else process.env.BOT_ENABLED = originalEnabled;
  }
});
