const test = require('node:test');
const assert = require('node:assert/strict');
const { eligibility, BLOCKED_TYPES } = require('../src/services/eligibility');
test('contact exclusions override enrollment and all bot triggers', () => {
  const enrolled = { lead: { automationEligible: true, automationEnrolledAt: new Date().toISOString() } };
  for (const contactType of BLOCKED_TYPES) assert.equal(eligibility({ ...enrolled, crm: { contactType } }).allowed, false);
  for (const status of ['Qualified', 'Won', 'Lost', 'Existing Client']) assert.equal(eligibility({ ...enrolled, lead: { ...enrolled.lead, status } }).allowed, false);
  assert.equal(eligibility({ ...enrolled, lead: { ...enrolled.lead, conversationStatus: 'EXPIRED' } }).allowed, false, 'expired conversations cannot pass the outbound send gate');
  for (const flag of ['botPaused', 'humanTakeover', 'optedOut']) assert.equal(eligibility({ ...enrolled, crm: { [flag]: true } }).allowed, false);
  assert.equal(eligibility({ lead: { welcomeSent: true } }).allowed, false);
  assert.equal(eligibility(null).allowed, false);
  assert.equal(eligibility({ lead: { automationEligible: true, contactType: 'New Lead' } }).allowed, false, 'legacy eligibility flags do not enroll old contacts');
  assert.equal(eligibility({ lead: { optedOut: true }, phone: '919892506314' }).allowed, false, 'explicit test-number opt-outs still apply');
  assert.equal(eligibility({ lead: { humanRequested: true }, phone: '919892506314' }).allowed, false, 'a human takeover overrides the test-number bypass');
  assert.equal(eligibility({ lead: { contactType: 'Existing Client', status: 'Qualified' }, phone: '+91 98925 06314' }).allowed, true, 'the designated test phone bypasses normal CRM restrictions');
  assert.equal(eligibility({ lead: { automationEnrolledAt: new Date().toISOString() }, phone: '+91 98923 28946' }).allowed, false, 'explicitly blocked contacts never become eligible');
  assert.equal(eligibility({ lead: { automationEligible: true }, phone: '919833066222' }).allowed, false, 'the new bypass applies only to the designated phone');
  assert.equal(eligibility({ lead: { ...enrolled.lead, contactType: 'New Lead' } }).allowed, true);
});
