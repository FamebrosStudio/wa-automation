const config = require('../config');

let dbPromise;
const LEASE_MS = 10 * 60 * 1000;

function isConfigured() {
  const hasServiceAccountKey = Boolean(config.firebaseServiceAccountJson);
  const hasWorkloadIdentity = Boolean(
    process.env.GCP_PROJECT_NUMBER &&
    process.env.GCP_SERVICE_ACCOUNT_EMAIL &&
    process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
    process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID
  );
  return Boolean(config.firebaseProjectId && (hasServiceAccountKey || hasWorkloadIdentity));
}

async function database() {
  if (!isConfigured()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const { Firestore } = require('@google-cloud/firestore');
      if (config.firebaseServiceAccountJson) {
        let credentials;
        try {
          credentials = JSON.parse(config.firebaseServiceAccountJson);
        } catch (_) {
          throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON');
        }
        return new Firestore({
          projectId: config.firebaseProjectId,
          credentials: { client_email: credentials.client_email, private_key: credentials.private_key },
          preferRest: true,
        });
      } else {
        const { getVercelOidcToken } = require('@vercel/oidc');
        const { ExternalAccountClient } = require('google-auth-library');
        const projectNumber = process.env.GCP_PROJECT_NUMBER;
        const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
        const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
        const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;
        const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
        const authClient = ExternalAccountClient.fromJSON({
          type: 'external_account',
          audience,
          subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
          token_url: 'https://sts.googleapis.com/v1/token',
          service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`,
          subject_token_supplier: {
            getSubjectToken: () => getVercelOidcToken(),
          },
        });
        if (!authClient) throw new Error('Unable to initialize Vercel Workload Identity Federation');

        // Firestore's direct client accepts google-auth-library's OAuth2Client.
        // Firebase Admin's app.firestore() rejects custom WIF credential providers.
        return new Firestore({ projectId: config.firebaseProjectId, auth: authClient, preferRest: true });
      }
    })().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

function collection(db) {
  return db.collection('waAutomationLeads');
}

async function loadAll() {
  const db = await database();
  if (!db) return null;
  const result = await collection(db).get();
  return result.docs.map((doc) => doc.data()).filter((item) => item && item.phone && item.lead);
}

async function getLeadByPhone(phone) {
  const db = await database();
  if (!db) return null;
  const doc = await collection(db).doc(recordId(phone)).get();
  return doc.exists ? doc.data() : null;
}

async function save(items) {
  const db = await database();
  if (!db) return false;
  const batch = db.batch();
  for (const item of items) {
    const id = Buffer.from(item.phone).toString('base64url');
    batch.set(collection(db).doc(id), { ...item, updatedAt: new Date().toISOString() }, { merge: true });
  }
  if (items.length) await batch.commit();
  return true;
}

// Atomic document replacement/merge. This prevents partial writes, but callers
// must not treat it as cross-instance read/modify/write serialization.
async function saveLead(item) {
  const db = await database();
  if (!db) return false;
  const ref = collection(db).doc(recordId(item.phone));
  await db.runTransaction(async (transaction) => {
    transaction.set(ref, { ...item, updatedAt: new Date().toISOString() }, { merge: true });
  });
  return true;
}

function recordId(phone) {
  return Buffer.from(phone).toString('base64url');
}

// A transactionally acquired lease coordinates serverless instances. The
// heartbeat keeps long-running handlers from outliving their lease.
async function acquirePhoneLease(phone, owner = `${process.pid}-${Date.now()}-${Math.random()}`) {
  const db = await database();
  if (!db) return null;
  const ref = db.collection('waAutomationLocks').doc(recordId(phone));
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    if (snap.exists && snap.data().expiresAt > now) return false;
    tx.set(ref, { owner, expiresAt: now + LEASE_MS });
    return true;
  });
  if (!acquired) throw new Error(`Firestore processing lease unavailable for ${phone}`);
  let renewing = false;
  let leaseError = null;
  const heartbeat = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data().owner !== owner) throw new Error('Firestore processing lease lost');
        tx.update(ref, { expiresAt: Date.now() + LEASE_MS });
      });
    } catch (error) {
      leaseError = new Error(`Firestore processing lease renewal failed: ${error.message}`, { cause: error });
      console.error('[firestore] lease renewal failed:', error.message);
    } finally { renewing = false; }
  }, Math.floor(LEASE_MS / 3));
  heartbeat.unref?.();
  const release = async () => {
    clearInterval(heartbeat);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().owner === owner) tx.delete(ref);
    });
  };
  // An assertion is also a transactional renewal. This surfaces heartbeat
  // failures at awaited task checkpoints and verifies that this owner still
  // controls the lock before the task proceeds.
  release.assertOwnership = async () => {
    if (leaseError) throw leaseError;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().owner !== owner || snap.data().expiresAt <= Date.now()) {
        throw new Error('Firestore processing lease lost');
      }
      tx.update(ref, { expiresAt: Date.now() + LEASE_MS });
    }).catch((error) => {
      leaseError = error;
      throw error;
    });
  };
  return release;
}

async function hasProcessedMessage(messageId) {
  const db = await database();
  if (!db) return false;
  const snap = await db.collection('waAutomationMessages').doc(recordId(messageId)).get();
  return snap.exists;
}

async function markMessageProcessed(messageId, phone) {
  const db = await database();
  if (!db) throw new Error('Firestore unavailable while recording processed message');
  await db.collection('waAutomationMessages').doc(recordId(messageId)).create({ messageId, phone, processedAt: new Date().toISOString() });
}

async function getLead(id) {
  const db = await database();
  if (!db) return null;
  const doc = await collection(db).doc(id).get();
  return doc.exists ? doc.data() : null;
}

async function updateCrm(id, changes) {
  const db = await database();
  if (!db) return false;
  await collection(db).doc(id).set({ crm: changes, crmUpdatedAt: new Date().toISOString() }, { merge: true });
  return true;
}

async function archiveIncoming(message, phone) {
  const db = await database();
  if (!db || !message.id) throw new Error('Durable inbound storage requires a message ID and database');
  try {
    await db.collection('waAutomationInbox').doc(recordId(message.id)).create({
      phone, message, receivedAt: new Date().toISOString(), status: 'received',
    });
  } catch (error) {
    if (error.code !== 6 && error.code !== 'already-exists') throw error;
  }
}

// Inbox-only contacts can predate lead creation. Since the current webhook is
// archived before policy checks, ignore its own document and detect earlier
// inbound history for the same phone.
async function hasPriorInboxMessage(phone, messageId) {
  if (!messageId) return false;
  const db = await database();
  if (!db) return false;
  const snapshot = await db.collection('waAutomationInbox')
    .where('phone', '==', phone)
    .limit(2)
    .get();
  const currentId = recordId(messageId);
  return snapshot.docs.some((doc) => doc.id !== currentId);
}

module.exports = { isConfigured, database, loadAll, getLeadByPhone, saveLead, save, recordId, getLead, updateCrm, archiveIncoming, hasPriorInboxMessage, acquirePhoneLease, hasProcessedMessage, markMessageProcessed };
