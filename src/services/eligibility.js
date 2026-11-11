const BLOCKED_TYPES = new Set(['Existing Client', 'Past Client', 'Employee', 'Vendor', 'Partner']);
function normalizePhone(phone) { return String(phone || '').replace(/\D/g, ''); }
const TEST_NUMBERS = new Set(['919833066222', ...(process.env.AUTOMATION_TEST_NUMBERS || '').split(',')].map(normalizePhone).filter(Boolean));
const ALWAYS_AUTOMATED_TEST_NUMBERS = new Set(['919892506314']);
function isTestNumber(phone) { return TEST_NUMBERS.has(normalizePhone(phone)); }
function isAlwaysAutomatedTestNumber(phone) { return ALWAYS_AUTOMATED_TEST_NUMBERS.has(normalizePhone(phone)); }
function hasFirstContactEnrollment(record) {
  const timestamp = record?.lead?.automationEnrolledAt;
  return typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp));
}
function eligibility(record) {
  const lead = record?.lead;
  const crm = record?.crm || {};
  if (!lead) return { allowed: false, reason: 'unverified-contact' };
  if (crm.optedOut || lead.optedOut) return { allowed: false, reason: 'paused-or-opted-out' };
  // This one explicitly approved test recipient bypasses normal CRM restrictions.
  if (isAlwaysAutomatedTestNumber(record?.phone || lead.phone)) return { allowed: true, reason: 'always-automated-test-number' };
  // Permanent suppression checks apply to all other recipients, including the
  // separately configured ordinary test-number list.
  if (BLOCKED_TYPES.has(crm.contactType || lead.contactType)) return { allowed: false, reason: 'excluded-contact-type' };
  if (['Qualified', 'Won', 'Lost', 'Existing Client', 'Non-qualified'].includes(lead.status)) return { allowed: false, reason: 'suppressed-status' };
  if (crm.botPaused || crm.humanTakeover || crm.optedOut || lead.optedOut || lead.humanRequested) return { allowed: false, reason: 'paused-or-opted-out' };
  if (lead.conversationStatus === 'COMPLETED' || lead.completionMessageSent === true) return { allowed: false, reason: 'completed-flow' };
  // Only records created by this bot's verified first-contact enrollment may
  // receive automation. Legacy records (even ones with stale eligibility flags)
  // and manually whitelisted test numbers without this marker fail closed.
  if (!hasFirstContactEnrollment(record)) {
    return { allowed: false, reason: 'not-enrolled-on-first-contact' };
  }
  if (isTestNumber(record?.phone || lead.phone)) return { allowed: true, reason: 'test-number' };
  if (lead.automationEligible !== true) return { allowed: false, reason: 'existing-contact-review' };
  return { allowed: true };
}
module.exports = { eligibility, hasFirstContactEnrollment, isTestNumber, isAlwaysAutomatedTestNumber, normalizePhone, BLOCKED_TYPES, TEST_NUMBERS };
