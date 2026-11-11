const BLOCKED_TYPES = new Set(['Existing Client', 'Past Client', 'Employee', 'Vendor', 'Partner']);
const TEST_NUMBERS = new Set((process.env.AUTOMATION_TEST_NUMBERS || '919833066222').split(',').map((n) => n.trim()).filter(Boolean));
function hasFirstContactEnrollment(record) {
  const timestamp = record?.lead?.automationEnrolledAt;
  return typeof timestamp === 'string' && Number.isFinite(Date.parse(timestamp));
}
function eligibility(record) {
  const lead = record?.lead;
  const crm = record?.crm || {};
  if (!lead) return { allowed: false, reason: 'unverified-contact' };
  // Permanent suppression checks first — even test numbers must respect these
  // (human takeover / completion / qualified / excluded types).
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
  // Test numbers may bypass the ordinary eligibility flag, never the enrollment marker.
  if (TEST_NUMBERS.has(record?.phone || lead.phone)) return { allowed: true, reason: 'test-number' };
  if (lead.automationEligible !== true) return { allowed: false, reason: 'existing-contact-review' };
  return { allowed: true };
}
module.exports = { eligibility, hasFirstContactEnrollment, BLOCKED_TYPES, TEST_NUMBERS };
