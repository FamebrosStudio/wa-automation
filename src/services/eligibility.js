const BLOCKED_TYPES = new Set(['Existing Client', 'Past Client', 'Employee', 'Vendor', 'Partner']);
const TEST_NUMBERS = new Set((process.env.AUTOMATION_TEST_NUMBERS || '919833066222').split(',').map((n) => n.trim()).filter(Boolean));
function eligibility(record) {
  if (TEST_NUMBERS.has(record?.phone || record?.lead?.phone)) return { allowed: true, reason: 'test-number' };
  const lead = record?.lead;
  const crm = record?.crm || {};
  if (!lead) return { allowed: false, reason: 'unverified-contact' };
  if (BLOCKED_TYPES.has(crm.contactType || lead.contactType)) return { allowed: false, reason: 'excluded-contact-type' };
  if (['Qualified', 'Won', 'Lost', 'Existing Client', 'Non-qualified'].includes(lead.status)) return { allowed: false, reason: 'suppressed-status' };
  if (crm.botPaused || crm.humanTakeover || crm.optedOut || lead.optedOut) return { allowed: false, reason: 'paused-or-opted-out' };
  if (lead.automationEligible !== true) return { allowed: false, reason: 'existing-contact-review' };
  return { allowed: true };
}
module.exports = { eligibility, BLOCKED_TYPES, TEST_NUMBERS };
