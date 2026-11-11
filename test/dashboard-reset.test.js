const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('dashboard cleanup removes CRM records but preserves inbox and reply safeguards', async () => {
  const oldUser = process.env.DASHBOARD_USER;
  const oldPassword = process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_USER = 'reset-test';
  process.env.DASHBOARD_PASSWORD = 'reset-password';

  const leads = require('../src/services/leads');
  leads.restore([
    { phone: '919900000001', lead: { phone: '919900000001', name: 'Test One' }, history: [{ role: 'user', content: 'test', ts: 1 }] },
    { phone: '919900000002', lead: { phone: '919900000002', name: 'Test Two' }, history: [] },
  ]);

  const collectionsQueried = [];
  const documentsDeleted = [];
  const tombstonesCreated = [];
  let leadDocs = ['crm-doc-1', 'crm-doc-2'];
  const phonesByDoc = { 'crm-doc-1': '919900000001', 'crm-doc-2': '919900000002' };
  const db = {
    collection(name) {
      collectionsQueried.push(name);
      if (name === 'waAutomationInbox') {
        return { doc: (id) => ({ collection: name, id }) };
      }
      return {
        limit() {
          return { get: async () => ({ docs: leadDocs.map((id) => ({
            ref: { collection: name, id },
            data: () => ({ phone: phonesByDoc[id] }),
          })) }) };
        },
      };
    },
    batch() {
      const pending = [];
      return {
        delete(ref) { pending.push(ref); },
        set(ref, data) { tombstonesCreated.push({ ref, data }); },
        async commit() {
          documentsDeleted.push(...pending);
          leadDocs = leadDocs.filter((id) => !pending.some((ref) => ref.id === id));
        },
      };
    },
  };

  const fakeFirestore = {
    isConfigured: () => true,
    database: async () => db,
    recordId: (phone) => Buffer.from(phone).toString('base64url'),
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/index.js')) {
      if (request === './services/firestore') return fakeFirestore;
      if (request === './handlers/messageHandler') return { handleIncoming: async () => ({ ignored: true }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let server;
  try {
    delete require.cache[require.resolve('../src/index')];
    const app = require('../src/index');
    server = app.listen(0);
    const root = `http://127.0.0.1:${server.address().port}`;
    const authorization = `Basic ${Buffer.from('reset-test:reset-password').toString('base64')}`;
    const response = await fetch(`${root}/reset`, { method: 'POST', headers: { authorization } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reset: true, deletedLeads: 2, safeguardsPreserved: true });
    assert.deepEqual(collectionsQueried, ['waAutomationLeads', 'waAutomationInbox', 'waAutomationInbox']);
    assert.equal(documentsDeleted.length, 2);
    assert.ok(documentsDeleted.every((doc) => doc.collection === 'waAutomationLeads'));
    assert.equal(tombstonesCreated.length, 2);
    assert.ok(tombstonesCreated.every(({ ref, data }) => ref.collection === 'waAutomationInbox' && data.status === 'dashboard-cleared-tombstone'));
    assert.ok(tombstonesCreated.every(({ data }) => data.phone && !('message' in data)), 'safeguard tombstones keep only the contact number and timestamp');
    assert.equal(leads.snapshot().length, 0);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Module._load = originalLoad;
    delete require.cache[require.resolve('../src/index')];
    leads.restore([]);
    if (oldUser === undefined) delete process.env.DASHBOARD_USER;
    else process.env.DASHBOARD_USER = oldUser;
    if (oldPassword === undefined) delete process.env.DASHBOARD_PASSWORD;
    else process.env.DASHBOARD_PASSWORD = oldPassword;
  }
});
