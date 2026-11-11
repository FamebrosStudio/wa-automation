const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibility, BLOCKED_TYPES } = require('../src/services/eligibility');
test('contact exclusions override enrollment and all bot triggers', () => {
  const enrolled = { lead: { automationEligible: true, automationEnrolledAt: new Date().toISOString() } };
  for (const contactType of BLOCKED_TYPES) assert.equal(eligibility({ ...enrolled, crm: { contactType } }).allowed, false);
  for (const status of ['Qualified', 'Won', 'Lost', 'Existing Client']) assert.equal(eligibility({ ...enrolled, lead: { ...enrolled.lead, status } }).allowed, false);
  for (const flag of ['botPaused', 'humanTakeover', 'optedOut']) assert.equal(eligibility({ ...enrolled, crm: { [flag]: true } }).allowed, false);
  assert.equal(eligibility({ lead: { welcomeSent: true } }).allowed, false);
  assert.equal(eligibility(null).allowed, false);
  assert.equal(eligibility({ lead: { automationEligible: true, contactType: 'New Lead' } }).allowed, false, 'legacy eligibility flags do not enroll old contacts');
  assert.equal(eligibility({ lead: { automationEligible: true, automationEnrolledAt: 'invalid-date' }, phone: '919833066222' }).allowed, false, 'test numbers still need a valid enrollment marker');
  assert.equal(eligibility({ lead: { ...enrolled.lead, contactType: 'New Lead' } }).allowed, true);
});
