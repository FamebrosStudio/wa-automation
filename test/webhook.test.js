const { test } = require('node:test');
const assert = require('node:assert/strict');
const handlerPath = require.resolve('../src/handlers/messageHandler');
require.cache[handlerPath] = { id: handlerPath, filename: handlerPath, loaded: true, exports: {
  handleIncoming: async () => { throw new Error('simulated persistence failure'); },
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
