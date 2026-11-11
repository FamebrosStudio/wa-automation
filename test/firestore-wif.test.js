const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('Firestore can initialize and fetch a lead using Vercel WIF without a JSON key', async () => {
  const names = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'GCP_PROJECT_NUMBER',
    'GCP_SERVICE_ACCOUNT_EMAIL',
    'GCP_WORKLOAD_IDENTITY_POOL_ID',
    'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    FIREBASE_PROJECT_ID: 'firebase-project-test',
    FIREBASE_SERVICE_ACCOUNT_JSON: '',
    GCP_PROJECT_NUMBER: '123456789',
    GCP_SERVICE_ACCOUNT_EMAIL: 'vercel@example.iam.gserviceaccount.com',
    GCP_WORKLOAD_IDENTITY_POOL_ID: 'pool',
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'provider',
  });

  let firestoreOptions;
  let wifConfig;
  const fakeDb = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
  class FakeFirestore {
    constructor(options) { firestoreOptions = options; return fakeDb; }
  }
  const fakeAuth = {
    credentials: { expiry_date: Date.now() + 60_000 },
    getAccessToken: async () => ({ token: 'ephemeral-test-token' }),
  };
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@google-cloud/firestore') return { Firestore: FakeFirestore };
    if (request === '@vercel/oidc') return { getVercelOidcToken: async () => 'vercel-oidc-token' };
    if (request === 'google-auth-library') {
      return { ExternalAccountClient: { fromJSON: (value) => { wifConfig = value; return fakeAuth; } } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const firestore = require('../src/services/firestore');
    assert.equal(firestore.isConfigured(), true);
    assert.equal(await firestore.getLead('lead-1'), null);
    assert.equal(firestoreOptions.projectId, 'firebase-project-test');
    assert.equal(firestoreOptions.auth, fakeAuth);
    assert.equal(firestoreOptions.preferRest, true);
    assert.equal(wifConfig.type, 'external_account');
    assert.match(wifConfig.audience, /workloadIdentityPools\/pool\/providers\/provider$/);
    assert.match(wifConfig.service_account_impersonation_url, /vercel%40example|vercel@example/);
    const token = await firestoreOptions.auth.getAccessToken();
    assert.equal(token.token, 'ephemeral-test-token');
    assert.equal(await wifConfig.subject_token_supplier.getSubjectToken(), 'vercel-oidc-token');
  } finally {
    Module._load = originalLoad;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('Firestore writes omit undefined nested lead fields while retaining valid values', () => {
  const { removeUndefined } = require('../src/services/firestore');
  assert.deepEqual(removeUndefined({
    lead: { instagram: 'https://www.instagram.com/famebroscollab/', location: undefined, name: 'Priya' },
    crm: { owner: undefined, tags: ['social', undefined] },
  }), {
    lead: { instagram: 'https://www.instagram.com/famebroscollab/', name: 'Priya' },
    crm: { tags: ['social', null] },
  });
});
