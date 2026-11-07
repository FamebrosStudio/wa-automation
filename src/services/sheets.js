const config = require('../config');

// Google Sheets integration via Vercel OIDC Workload Identity Federation
// No service-account private key needed.
// Requires (set in Vercel env vars):
//   GOOGLE_SHEETS_ID
//   GCP_PROJECT_ID
//   GCP_PROJECT_NUMBER
//   GCP_SERVICE_ACCOUNT_EMAIL
//   GCP_WORKLOAD_IDENTITY_POOL_ID
//   GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID

let sheetsClient = null;
let sheetsAvailable = false;

async function initSheets() {
  if (sheetsAvailable) return true;
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  const projectId = process.env.GCP_PROJECT_ID;
  const projectNumber = process.env.GCP_PROJECT_NUMBER;
  const serviceAccountEmail = process.env.GCP_SERVICE_ACCOUNT_EMAIL;
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID;
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID;

  if (!sheetId || !projectId || !projectNumber || !serviceAccountEmail || !poolId || !providerId) {
    console.warn('[sheets] Google Sheets / WIF not configured; leads stored in memory only');
    return false;
  }

  try {
    const { getVercelOidcToken } = require('@vercel/oidc');
    const { ExternalAccountClient } = require('google-auth-library');
    const { google } = require('googleapis');

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

    sheetsClient = google.sheets({ version: 'v4', auth: authClient });
    sheetsAvailable = true;
    console.log('[sheets] Google Sheets connected via WIF');
    await ensureHeaders();
    return true;
  } catch (err) {
    console.error('[sheets] init error:', err.message);
    return false;
  }
}

const SHEET_NAME = 'Leads';
const HEADERS = [
  'Timestamp', 'Phone', 'Name', 'Status', 'Interests',
  'Message Count', 'Human Requested', 'Last Message',
  'Conversation Summary', 'First Seen', 'Last Seen', 'Notes',
];

async function ensureHeaders() {
  if (!sheetsAvailable) return;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEETS_ID,
      range: `${SHEET_NAME}!A1:L1`,
    });
    const existing = res.data.values?.[0];
    if (!existing || existing.length === 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        range: `${SHEET_NAME}!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }
  } catch (err) {
    try {
      await sheetsClient.spreadsheets.batchUpdate({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      });
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEETS_ID,
        range: `${SHEET_NAME}!A1:L1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    } catch (e) {
      console.error('[sheets] ensureHeaders error:', e.message);
    }
  }
}

async function upsertLead(leadSummary) {
  if (!sheetsAvailable) {
    if (!(await initSheets())) return { skipped: true };
    await ensureHeaders();
  }
  try {
    const sheetId = process.env.GOOGLE_SHEETS_ID;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:L`,
    });
    const rows = res.data.values || [];
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === leadSummary.phone) {
        rowIndex = i + 1;
        break;
      }
    }
    const row = [
      new Date().toISOString(),
      leadSummary.phone,
      leadSummary.name || '',
      leadSummary.status,
      (leadSummary.interests || []).join(', '),
      leadSummary.messageCount,
      leadSummary.humanRequested ? 'Yes' : 'No',
      (leadSummary.conversationSummary || '').slice(0, 500),
      leadSummary.conversationSummary || '',
      leadSummary.firstSeen,
      leadSummary.lastSeen,
      '',
    ];
    if (rowIndex > 0) {
      await sheetsClient.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${SHEET_NAME}!A${rowIndex}:L${rowIndex}`,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
      });
    } else {
      await sheetsClient.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${SHEET_NAME}!A:L`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
    }
    console.log(`[sheets] Lead saved: ${leadSummary.phone} | ${leadSummary.status}`);
    return { ok: true };
  } catch (err) {
    console.error(`[sheets] Failed to save lead ${leadSummary.phone}: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { initSheets, upsertLead, sheetsAvailable: () => sheetsAvailable };
