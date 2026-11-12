const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const ExcelJS = require('exceljs');

test('CRM export is an authenticated Excel workbook with lead and conversation sheets', async () => {
  process.env.DASHBOARD_USER = 'export-test';
  process.env.DASHBOARD_PASSWORD = 'export-password';
  const leads = require('../src/services/leads');
  leads.restore([]);
  const phone = '919876543210';
  leads.updateLead(phone, {
    name: 'Priya Sharma', business: 'Priya Kitchen', category: 'Food & Beverage',
    service: 'Social Media Management', status: 'Non-confirmed',
    instagram: 'https://www.instagram.com/priyakitchen/',
    serviceDetails: { customerType: 'I own a business', category: 'Food & Beverage' },
  });
  leads.addMessage(phone, 'user', 'Hi, I need social media help');
  leads.updateLead('919876543211', { name: 'Qualified Lead', status: 'Qualified' });
  leads.updateLead('919876543212', { name: 'Non-qualified Lead', status: 'Non-qualified' });
  leads.updateLead('919876543213', { business: 'Unnamed business' });

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/index.js') && request === './services/firestore') {
      return { isConfigured: () => false, loadAll: async () => null, recordId: (value) => Buffer.from(value).toString('base64url') };
    }
    if (parent?.filename.replaceAll('\\', '/').endsWith('/src/index.js') && request === './handlers/messageHandler') {
      return { handleIncoming: async () => ({ ignored: true }) };
    }
    return realLoad.call(this, request, parent, isMain);
  };

  let server;
  try {
    delete require.cache[require.resolve('../src/index')];
    const app = require('../src/index');
    server = app.listen(0);
    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const auth = `Basic ${Buffer.from('export-test:export-password').toString('base64')}`;
    const list = await fetch(`${root}/leads`, { headers: { authorization: auth } });
    assert.equal(list.status, 200);
    const listedLeads = (await list.json()).leads;
    assert.equal(listedLeads.find((lead) => lead.id === Buffer.from('919876543213').toString('base64url')).phone, '919876543213', 'nameless leads expose their number to the authenticated dashboard');
    assert.equal(listedLeads.find((lead) => lead.id === Buffer.from(phone).toString('base64url')).phone, undefined, 'named leads keep their number hidden from the list');
    const denied = await fetch(`${root}/leads/export`);
    assert.equal(denied.status, 401);
    const response = await fetch(`${root}/leads/export`, { headers: { authorization: auth } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /spreadsheetml\.sheet/);
    assert.match(response.headers.get('content-disposition'), /famebros-crm-all-\d{4}-\d{2}-\d{2}\.xlsx/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    assert.equal(workbook.worksheets.length, 2);
    const leadsSheet = workbook.getWorksheet('Leads');
    assert.equal(leadsSheet.rowCount, 5, 'full CRM export includes all three statuses and the nameless lead');
    assert.equal(leadsSheet.getCell('B2').value, 'Priya Sharma');
    assert.equal(leadsSheet.getCell('E2').value, 'Food & Beverage');
    assert.equal(leadsSheet.getCell('K2').value, 'https://www.instagram.com/priyakitchen/');
    assert.equal(workbook.getWorksheet('Conversation history').getCell('F2').value, 'Hi, I need social media help');

    for (const [status, name] of [
      ['Qualified', 'Qualified Lead'],
      ['Non-confirmed', 'Priya Sharma'],
      ['Non-qualified', 'Non-qualified Lead'],
    ]) {
      const filtered = await fetch(`${root}/leads/export?status=${encodeURIComponent(status)}`, { headers: { authorization: auth } });
      assert.equal(filtered.status, 200);
      assert.match(filtered.headers.get('content-disposition'), new RegExp(`famebros-crm-${status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`));
      const filteredBook = new ExcelJS.Workbook();
      await filteredBook.xlsx.load(Buffer.from(await filtered.arrayBuffer()));
      const filteredLeads = filteredBook.getWorksheet('Leads');
      assert.equal(filteredLeads.rowCount, 2, `${status} export should contain only its header and one lead`);
      assert.equal(filteredLeads.getCell('B2').value, name);
    }
    const invalidStatus = await fetch(`${root}/leads/export?status=Unknown`, { headers: { authorization: auth } });
    assert.equal(invalidStatus.status, 400);

    const qualifiedId = Buffer.from('919876543211').toString('base64url');
    const clearStatus = await fetch(`${root}/leads/${qualifiedId}`, {
      method: 'PATCH',
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ status: null }),
    });
    assert.equal(clearStatus.status, 200, 'choosing New (unassigned) clears the existing stage');
    assert.equal((await clearStatus.json()).status, null);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    Module._load = realLoad;
    delete require.cache[require.resolve('../src/index')];
    delete process.env.DASHBOARD_USER;
    delete process.env.DASHBOARD_PASSWORD;
  }
});
