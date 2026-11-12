const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('human Business App echo pauses automation and duplicate echoes are idempotent', async () => {
  const handlerPath = require.resolve('../src/handlers/messageHandler');
  const originalLoad = Module._load;
  const previousBotEnabled = process.env.BOT_ENABLED;
  const previousVercel = process.env.VERCEL;
  process.env.BOT_ENABLED = 'true';
  delete process.env.VERCEL;
  const sends = [];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/handlers/messageHandler.js')) {
      if (request === '../services/firestore') return { isConfigured: () => false };
      if (request === '../services/whatsapp') return {
        text: async (...args) => sends.push(args),
        list: async (...args) => sends.push(args),
        buttons: async (...args) => sends.push(args),
        forceText: async (...args) => sends.push(args),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[handlerPath];
  const phone = '919900009987';
  try {
    const leads = require('../src/services/leads');
    const flow = require('../src/services/flow');
    const { handleHumanEcho, handleIncoming } = require('../src/handlers/messageHandler');
    leads.restore([]);
    leads.updateLead(phone, { automationEligible: true, automationEnrolledAt: new Date().toISOString() });
    flow.startServiceFlow(phone, 'website');

    const echo = { id: 'human-echo-1', type: 'text', text: { body: 'Hi, this is Alex from our team.' } };
    assert.deepEqual(await handleHumanEcho(echo, phone), { humanTakeover: true });
    assert.equal(flow.hasActiveFlow(phone), false);
    const saved = leads.snapshot(phone)[0];
    assert.equal(saved.lead.crm.humanTakeover, true);
    assert.equal(saved.lead.crm.botPaused, true);
    assert.equal(leads.getHistory(phone)[0].role, 'human');
    assert.equal(leads.getHistory(phone)[0].id, echo.id);

    assert.deepEqual(await handleHumanEcho(echo, phone), { ignored: true, reason: 'duplicate-human-echo' });
    await handleIncoming({ id: 'customer-after-human', type: 'text', text: { body: 'Thanks, can you share pricing?' } }, phone);
    assert.equal(sends.length, 0, 'do not send bot replies after a human response');
    assert.equal(leads.getHistory(phone).filter(message => message.id === echo.id).length, 1);
  } finally {
    Module._load = originalLoad;
    delete require.cache[handlerPath];
    require('../src/services/leads').restore([]);
    require('../src/services/flow').cancelFlow(phone);
    for (const [key, value] of [['BOT_ENABLED', previousBotEnabled], ['VERCEL', previousVercel]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
