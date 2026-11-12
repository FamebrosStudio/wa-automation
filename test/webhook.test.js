const { test } = require('node:test');
const assert = require('node:assert/strict');
const handlerPath = require.resolve('../src/handlers/messageHandler');
const echoes = [];
require.cache[handlerPath] = { id: handlerPath, filename: handlerPath, loaded: true, exports: {
  handleIncoming: async () => { throw new Error('simulated persistence failure'); },
  handleHumanEcho: async (message, to) => echoes.push({ message, to }),
} };
const app = require('../src/index');

test('webhook returns retryable status when message processing fails', async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ id: 'm1', from: '123', type: 'text' }] } }] }] }),
    });
    assert.equal(response.status, 503);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('webhook routes Business App echoes as human messages, not customer inputs', async () => {
  const server = app.listen(0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{
        field: 'smb_message_echoes',
        value: { message_echoes: [{ id: 'echo-1', to: '+91 90000 99991', type: 'text', text: { body: 'A human reply' } }] },
      }] }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(echoes.length, 1);
    assert.equal(echoes[0].to, '919000099991');
    assert.equal(echoes[0].message.text.body, 'A human reply');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
