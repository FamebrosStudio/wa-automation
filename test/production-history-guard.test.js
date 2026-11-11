const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('production sends nothing when durable contact history is unavailable, including to test numbers', async () => {
  const previousVercel = process.env.VERCEL;
  const previousBotEnabled = process.env.BOT_ENABLED;
  process.env.VERCEL = '1';
  process.env.BOT_ENABLED = 'true';
  const leads = require('../src/services/leads');
  const flow = require('../src/services/flow');
  leads.restore([]);
  const sent = [];
  const firestore = { isConfigured: () => false };
  const whatsapp = {
    text: async (...args) => sent.push(args),
    list: async (...args) => sent.push(args),
    buttons: async (...args) => sent.push(args),
    forceText: async (...args) => sent.push(args),
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/handlers/messageHandler.js')) {
      if (request === '../services/firestore') return firestore;
      if (request === '../services/whatsapp') return whatsapp;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const handlerPath = require.resolve('../src/handlers/messageHandler');
  delete require.cache[handlerPath];
  try {
    const { handleIncoming } = require('../src/handlers/messageHandler');
    for (const [id, phone] of [['normal', '919900009991'], ['test', '919892506314']]) {
      const result = await handleIncoming({ id, type: 'text', text: { body: 'hi' } }, phone);
      assert.equal(result.reason, 'contact-history-unavailable');
    }
    assert.equal(sent.length, 0);
  } finally {
    Module._load = originalLoad;
    delete require.cache[handlerPath];
    leads.restore([]);
    for (const [name, previous] of [['VERCEL', previousVercel], ['BOT_ENABLED', previousBotEnabled]]) {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    flow.cancelFlow('919900009991');
    flow.cancelFlow('919892506314');
  }
});
