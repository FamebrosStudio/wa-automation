const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibility, BLOCKED_TYPES } = require('../src/services/eligibility');
test('contact exclusions override enrollment and all bot triggers', () => {
  for (const contactType of BLOCKED_TYPES) assert.equal(eligibility({ lead: { automationEligible: true }, crm: { contactType } }).allowed, false);
  for (const status of ['Qualified', 'Won', 'Lost', 'Existing Client']) assert.equal(eligibility({ lead: { automationEligible: true, status } }).allowed, false);
  for (const flag of ['botPaused', 'humanTakeover', 'optedOut']) assert.equal(eligibility({ lead: { automationEligible: true }, crm: { [flag]: true } }).allowed, false);
  assert.equal(eligibility({ lead: { welcomeSent: true } }).allowed, false);
  assert.equal(eligibility(null).allowed, false);
  assert.equal(eligibility({ lead: { automationEligible: true, contactType: 'New Lead' } }).allowed, true);
});
