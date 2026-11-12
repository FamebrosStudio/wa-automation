const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const config = require('./config');
const { handleIncoming, handleHumanEcho } = require('./handlers/messageHandler');
const leads = require('./services/leads');
const firestore = require('./services/firestore');
const { isAlwaysAutomatedTestNumber } = require('./services/eligibility');
const localCrm = new Map();

const app = express();
app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = buffer; } }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-famebros-bot' });
});

// Webhook verification (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.verifyToken) {
    console.log('[webhook] verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver
app.post('/webhook', async (req, res) => {
  const secret = process.env.META_APP_SECRET;
  if (process.env.VERCEL && !secret) return res.status(503).send('Webhook verification is not configured');
  if (secret) {
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
    const actual = req.get('x-hub-signature-256') || '';
    if (actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.sendStatus(401);
  }
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return res.sendStatus(200);
    const phoneJobs = new Map();
    const enqueueForPhone = (phone, operation) => {
      const previous = phoneJobs.get(phone) || Promise.resolve();
      const task = previous.then(operation);
      phoneJobs.set(phone, task);
    };
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const msg of value.messages || []) {
          const from = msg.from;
          if (!from) continue;
          if (msg.type === 'unknown') continue;
          console.log(`[webhook] incoming from ${from} type=${msg.type}`);
          enqueueForPhone(from, () => handleIncoming(msg, from));
        }
        // Cloud API sends statuses for bot-authored messages; they have no
        // contents and are intentionally not treated as human replies. In
        // Coexistence, message_echoes contains content sent from the Business
        // App and is the authoritative signal for a human takeover.
        for (const echo of value.message_echoes || []) {
          const to = String(echo.to || '').replace(/\D/g, '');
          if (!to) continue;
          enqueueForPhone(to, () => handleHumanEcho(echo, to));
        }
      }
    }
    await Promise.all(phoneJobs.values());
    return res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] processing error:', err.message);
    return res.sendStatus(503);
  }
});

function dashboardAuth(req, res, next) {
  if (!config.dashboardPassword) return res.status(503).send('Dashboard disabled: set DASHBOARD_PASSWORD to enable it.');
  const expected = `Basic ${Buffer.from(`${config.dashboardUser}:${config.dashboardPassword}`).toString('base64')}`;
  if (req.headers.authorization !== expected) {
    res.set('WWW-Authenticate', 'Basic realm="Lead dashboard"');
    return res.sendStatus(401);
  }
  next();
}

const LEAD_STATUSES = ['Qualified', 'Non-confirmed', 'Non-qualified'];
function normalizeLeadStatus(lead) {
  if (lead && !LEAD_STATUSES.includes(lead.status)) lead.status = null;
  return lead;
}
function safeRecordId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

app.get('/leads/export', dashboardAuth, async (req, res) => {
  try {
    const requestedStatus = req.query.status;
    if (requestedStatus !== undefined && !LEAD_STATUSES.includes(requestedStatus)) {
      return res.status(400).json({ error: 'Invalid export status' });
    }
    const stored = await firestore.loadAll();
    const allRecords = stored || leads.snapshot();
    const records = requestedStatus
      ? allRecords.filter((record) => (record.lead || record).status === requestedStatus)
      : allRecords;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Famebros Studio';
    workbook.created = new Date();
    workbook.subject = 'Lead pipeline CRM export';

    const sheet = workbook.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Lead ID', key: 'id', width: 24 },
      { header: 'Client name', key: 'name', width: 24 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Business', key: 'business', width: 28 },
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Service', key: 'service', width: 28 },
      { header: 'Stage', key: 'status', width: 18 },
      { header: 'Lead source', key: 'source', width: 18 },
      { header: 'Budget', key: 'budget', width: 18 },
      { header: 'Timeline', key: 'timeline', width: 18 },
      { header: 'Instagram profile', key: 'instagram', width: 38 },
      { header: 'Owner / team', key: 'owner', width: 22 },
      { header: 'Contact type', key: 'contactType', width: 20 },
      { header: 'Bot paused', key: 'botPaused', width: 14 },
      { header: 'Human takeover', key: 'humanTakeover', width: 18 },
      { header: 'Opted out', key: 'optedOut', width: 14 },
      { header: 'First seen', key: 'firstSeen', width: 24 },
      { header: 'Last activity', key: 'lastSeen', width: 24 },
      { header: 'Internal notes', key: 'notes', width: 40 },
      { header: 'Tags', key: 'tags', width: 28 },
      { header: 'All service details (JSON)', key: 'serviceDetails', width: 60 },
    ];
    const activity = workbook.addWorksheet('Conversation history', { views: [{ state: 'frozen', ySplit: 1 }] });
    activity.columns = [
      { header: 'Lead ID', key: 'id', width: 24 },
      { header: 'Client name', key: 'name', width: 24 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Date and time', key: 'timestamp', width: 24 },
      { header: 'From', key: 'role', width: 16 },
      { header: 'Message', key: 'content', width: 90 },
    ];
    for (const worksheet of [sheet, activity]) {
      worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(worksheet.columnCount).letter}1` };
      worksheet.getRow(1).height = 26;
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14532D' } };
      worksheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    }
    for (const record of records) {
      const lead = record.lead || record;
      if (!lead?.phone) continue;
      const id = firestore.recordId(lead.phone);
      const crm = record.crm || {};
      const serviceDetails = lead.serviceDetails || {};
      sheet.addRow({
        id, name: lead.name || '', phone: lead.phone, business: lead.business || '',
        category: lead.category || serviceDetails.category || '', service: lead.service || '',
        status: lead.status || 'New', source: lead.leadSource || '', budget: lead.budget || '',
        timeline: lead.timeline || '', instagram: lead.instagram || serviceDetails.instagram || '',
        owner: crm.owner || lead.assignedTeam || '', contactType: crm.contactType || lead.contactType || '',
        botPaused: Boolean(crm.botPaused), humanTakeover: Boolean(crm.humanTakeover),
        optedOut: Boolean(crm.optedOut || lead.optedOut), firstSeen: lead.firstSeen || '',
        lastSeen: lead.lastSeen || '', notes: crm.notes || lead.notes || '',
        tags: (crm.tags || (lead.service ? [lead.service] : [])).join(', '),
        serviceDetails: JSON.stringify(serviceDetails),
      });
      for (const message of record.history || []) {
        activity.addRow({
          id, name: lead.name || '', phone: lead.phone,
          timestamp: message.ts ? new Date(message.ts).toISOString() : '',
          role: message.role || '', content: message.content || '',
        });
      }
    }
    sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true }; });
    activity.eachRow((row, rowNumber) => { if (rowNumber > 1) row.alignment = { vertical: 'top', wrapText: true }; });

    const buffer = await workbook.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    const statusSlug = requestedStatus ? requestedStatus.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'all';
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="famebros-crm-${statusSlug}-${date}.xlsx"`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('[export] CRM export failed:', error.message);
    return res.status(503).json({ error: 'CRM export unavailable' });
  }
});

app.get('/leads/:id', dashboardAuth, async (req, res) => {
  if (!safeRecordId(req.params.id)) return res.sendStatus(400);
  try {
    const record = firestore.isConfigured()
      ? await firestore.getLead(req.params.id)
      : leads.snapshot().find((item) => firestore.recordId(item.phone) === req.params.id);
    if (!record) return res.sendStatus(404);
    const lead = normalizeLeadStatus(record.lead);
    res.json({ id: req.params.id, phone: lead.phone, lead, history: record.history || [], crm: record.crm || localCrm.get(req.params.id) || { owner: lead.assignedTeam || '', tags: lead.service ? [lead.service] : [], notes: JSON.stringify(lead.serviceDetails || {}) } });
  } catch (error) {
    console.error('[firestore] lead detail failed:', error.message);
    res.status(503).json({ error: 'Lead storage unavailable' });
  }
});

app.patch('/leads/:id', dashboardAuth, async (req, res) => {
  if (!safeRecordId(req.params.id)) return res.sendStatus(400);
  const { status, notes, tags, owner, contactType, botPaused, humanTakeover } = req.body || {};
  if (status !== undefined && status !== null && !LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid lead status' });
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 5000)) return res.status(400).json({ error: 'Notes must be text up to 5000 characters' });
  if (owner !== undefined && (typeof owner !== 'string' || owner.length > 120)) return res.status(400).json({ error: 'Owner must be text up to 120 characters' });
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 30 || tags.some((tag) => typeof tag !== 'string' || tag.length > 40))) {
    return res.status(400).json({ error: 'Tags must be up to 30 text labels (40 characters each)' });
  }
  try {
    let record;
    if (firestore.isConfigured()) record = await firestore.getLead(req.params.id);
    else record = leads.snapshot().find((item) => firestore.recordId(item.phone) === req.params.id);
    if (!record) return res.sendStatus(404);
    const crm = { ...(record.crm || {}) };
    if (contactType !== undefined) crm.contactType = contactType;
    if (botPaused !== undefined) crm.botPaused = botPaused;
    if (humanTakeover !== undefined) crm.humanTakeover = humanTakeover;
    if (notes !== undefined) crm.notes = notes;
    if (owner !== undefined) crm.owner = owner.trim();
    if (tags !== undefined) crm.tags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    if (status !== undefined) record.lead.status = status || null;
    if (firestore.isConfigured()) await firestore.save([{ ...record, crm }]);
    else {
      record.crm = crm;
      localCrm.set(req.params.id, crm);
      leads.restore(leads.snapshot().map((item) => item.phone === record.phone ? record : item));
    }
    return res.json({ saved: true, status: record.lead.status, crm });
  } catch (error) {
    console.error('[firestore] lead update failed:', error.message);
    return res.status(503).json({ error: 'Lead storage unavailable' });
  }
});

// In-memory analytics are per process/instance, not durable or globally real-time.
app.get('/leads', dashboardAuth, async (req, res) => {
  let allLeads;
  let leadCrm = new Map();
  try {
    const records = await firestore.loadAll();
    allLeads = records ? records.map((record) => {
      const id = firestore.recordId(record.phone);
      leadCrm.set(id, record.crm || {});
      return normalizeLeadStatus(record.lead);
    }) : leads.getAllLeads();
  } catch (error) {
    console.error('[firestore] dashboard read failed:', error.message);
    return res.status(503).json({ error: 'Lead storage unavailable' });
  }
  res.json({
    total: allLeads.length,
    qualified: allLeads.filter(l => l.status === 'Qualified').length,
    nonConfirmed: allLeads.filter(l => l.status === 'Non-confirmed').length,
    nonQualified: allLeads.filter(l => l.status === 'Non-qualified').length,
    leads: allLeads.slice().reverse().map((lead) => {
      const id = firestore.recordId(lead.phone);
      const crm = leadCrm.get(id) || localCrm.get(id) || {};
      return {
        ...lead,
        id,
        tags: crm.tags || (lead.service ? [lead.service] : []),
        owner: crm.owner || lead.assignedTeam || '',
        // The authenticated dashboard can identify nameless enquiries by
        // phone; keep phone out of list payloads once a client name is known.
        phone: lead.name ? undefined : lead.phone,
      };
    }),
  });
});

// Clear dashboard/CRM data only. Inbox archives and processed-message records
// are safeguards against replying to old chats and duplicate webhook events;
// lock documents are also left alone because a handler may currently own one.
app.post('/reset', dashboardAuth, async (req, res) => {
  try {
    let deletedLeads = 0;
    const preservedTestPhones = new Set();
    const cachedTestLeads = leads.snapshot().filter((record) => isAlwaysAutomatedTestNumber(record.phone || record.lead?.phone));
    if (firestore.isConfigured()) {
      const db = await firestore.database();
      if (!db) throw new Error('Firestore unavailable while clearing dashboard data');
      const leadCollection = db.collection('waAutomationLeads');
      while (true) {
        const snapshot = await leadCollection.limit(400).get();
        if (!snapshot.docs.length) break;
        const tombstones = db.batch();
        const deletions = db.batch();
        const clearedAt = new Date().toISOString();
        const docsToDelete = snapshot.docs.filter((doc) => {
          const record = doc.data();
          if (isAlwaysAutomatedTestNumber(record?.phone || record?.lead?.phone)) {
            preservedTestPhones.add(record.phone || record.lead.phone);
            return false;
          }
          return true;
        });
        if (!docsToDelete.length) break;
        docsToDelete.forEach((doc) => {
          const record = doc.data();
          if (record?.phone) {
            tombstones.set(db.collection('waAutomationInbox').doc(`dashboard-cleared-${firestore.recordId(record.phone)}`), {
              phone: record.phone,
              status: 'dashboard-cleared-tombstone',
              clearedAt,
            }, { merge: true });
          }
          deletions.delete(doc.ref);
        });
        // Commit the minimal old-contact markers before deleting CRM documents.
        // This keeps the old-chat guard effective even for contacts whose
        // historical inbound messages were never archived.
        await tombstones.commit();
        await deletions.commit();
        deletedLeads += docsToDelete.length;
      }
    } else {
      deletedLeads = leads.snapshot().length - cachedTestLeads.length;
    }
    for (const phone of cachedTestLeads.map((record) => record.phone || record.lead?.phone)) preservedTestPhones.add(phone);
    leads.restore(cachedTestLeads);
    const preservedCrmIds = new Set([...preservedTestPhones].map((phone) => firestore.recordId(phone)));
    for (const id of localCrm.keys()) if (!preservedCrmIds.has(id)) localCrm.delete(id);
    return res.json({ reset: true, deletedLeads, preservedTestLeads: preservedTestPhones.size, safeguardsPreserved: true });
  } catch (error) {
    console.error('[reset] failed:', error.message);
    return res.status(503).json({ error: 'Reset failed' });
  }
});

app.get('/dashboard', dashboardAuth, (req, res) => {
  res.type('html').send(fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'));
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
    console.log(`[server] webhook URL: http://localhost:${config.port}/webhook`);
    console.log(`[server] dashboard URL: http://localhost:${config.port}/dashboard`);
  });
}

module.exports = app;
