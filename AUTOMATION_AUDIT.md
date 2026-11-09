# Famebros automation audit — 9 November 2026

## Verified locally
- Existing client, past client, employee, vendor and partner exclusions.
- Qualified/Won/Lost/Existing Client suppression; menu taps cannot bypass exclusions.
- Per-message durable eligibility check at the WhatsApp send boundary.
- Human request and opt-out pause the flow; unassigned handover recorded.
- Contact type, bot pause and human-handling controls in lead details.
- Manual Won transition disables eligibility and marks Existing Client. No automatic sale inference.
- CRM lifecycle statuses supported alongside existing pipeline values; no destructive migration.
- Referral metadata captured for new leads when supplied in the inbound message.
- Global sending default OFF; production BOT_ENABLED=false configured.
- Webhook HMAC verification implemented using META_APP_SECRET. Production rejects delivery if secret is absent.
- WhatsApp API request timeout added.

## Important limitations and blockers
- A contact absent from this CRM cannot be distinguished from a historic WhatsApp contact. Import/reconcile existing contacts before enabling production. No full history integration verified.
- Previous automationEligible flags may exist on contacts incorrectly enrolled by earlier menu taps. Reconcile these against client records before reactivation.
- META_APP_SECRET must be configured securely for signature verification. Never paste secrets into chat.
- Production messaging tests have NOT been run; production must stay disabled until authorized.
- Firestore production read/write access, dashboard performance and end-to-end flow delivery still need authenticated verification. Unit mocks are not production proof.
- Current message deduplication does not guarantee exactly-once delivery across crashes between WhatsApp send and Firestore write. An outbox with uncertain-send reconciliation remains necessary.
- Concurrent CRM edits and webhook full-record writes can race. Field-scoped transactional updates remain necessary.
- Existing flows remain incomplete relative to the master specification: Other Services, navigation/back, CRM-aware question skipping, complete qualification and budget rules require further work.
- No approved template IDs, consent records, follow-up sending approval or scheduler configuration verified. Follow-up delivery remains disabled; no reminders are sent.
- Staff roster, assignment rules and employee notification destination are not configured. Handover records are created, but employee notifications/manual replies are not implemented.
- No Meta dataset ID/access-token permissions/event mapping verified. Conversions API and campaign revenue reporting are NOT implemented.
- Bulk exclusion import with preview/rollback, manager-wide runtime controls, editable message templates, full analytics and delivery status ingestion remain unfinished.
- There is no confirmed Pingmate integration or access.

## Deployment and rollback
No existing client records are bulk-modified or deleted. New controls use additive fields.
Keep BOT_ENABLED=false during rollback as previous code contains an old-contact menu bypass; a rollback alone is not a safe reactivation.
Current OFF handler returns a retryable error rather than pretending enquiries were processed. Meta retry retention is finite; durable inbound queueing remains necessary before an extended shutdown.

## Activation prerequisites
1. Verified client/contact exclusion export and reconciliation.
2. Secure webhook app-secret configuration and successful signed-webhook tests.
3. Live Firestore persistence verification using non-messaging fixtures.
4. Outbox, concurrent-update protection and historical-message policy tests.
5. Explicit authorization for a restricted production test, then rollout.
