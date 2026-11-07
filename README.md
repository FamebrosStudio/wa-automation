\# WhatsApp Automation Bot — Famebros Studio



Node.js/Express bot using the \*\*Meta WhatsApp Cloud API\*\*. Auto-replies to incoming WhatsApp messages with info about Famebros Studio, services, packages, case studies, and contact options.



\## Features

\- Webhook verification + message receiver

\- Interactive list menu + button navigation

\- Keyword-based routing (services, packages, pricing, contact, etc.)

\- Number shortcuts (1-8)

\- Dedup of retried webhook deliveries

\- Stateless rule-based replies (no DB required)



\## Setup



1\. Install deps:

&#x20;  ```bash

&#x20;  cd whatsapp-famebros-bot

&#x20;  npm install

&#x20;  ```



2\. Create `.env` from `.env.example` and fill:

&#x20;  - `WHATSAPP\_TOKEN` — Meta system user / permanent token

&#x20;  - `PHONE\_NUMBER\_ID` — your WhatsApp Business phone number ID

&#x20;  - `VERIFY\_TOKEN` — any random string you choose



3\. Run:

&#x20;  ```bash

&#x20;  npm run dev

&#x20;  ```



4\. Expose locally with ngrok for Meta webhook:

&#x20;  ```bash

&#x20;  ngrok http 3000

&#x20;  ```



5\. In Meta Developer Console → WhatsApp → Configuration:

&#x20;  - Callback URL: `https://<ngrok>/webhook`

&#x20;  - Verify token: same as `VERIFY\_TOKEN`

&#x20;  - Subscribe to `messages`



\## Meta Cloud API setup (high level)

1\. Create a Meta (Facebook) Developer account \& app (type: Business).

2\. Add the WhatsApp product.

3\. Create/claim a WhatsApp Business Account (WABA) and a phone number.

4\. Generate a permanent access token (System User) with `whatsapp\_business\_messaging` + `whatsapp\_business\_management`.

5\. Note the Phone Number ID from the API Setup page.



\## Customising content

Edit `src/data/knowledge.js`:

\- Update phone/email/address in `.env` or knowledge file.

\- Adjust package prices/descriptions.

\- Add/remove menu rows in `MAIN\_MENU`.



\## Notes

\- Default business contact: `+91 98923 84424` and `growth@famebrosstudio.com`. Set `BUSINESS_PHONE`, `BUSINESS_EMAIL`, and `WHATSAPP_LINK` in the environment to override these defaults.

\- For production, deploy to Railway/Render/VM and set webhook URL accordingly.

\- To enable AI free-text answers, set `OPENAI\_API\_KEY` and wire `handlers/messageHandler.js` fallback (optional enhancement).



\## License

MIT

# Firestore

Lead and recent conversation records are stored server-side in Firestore when
`FIREBASE_SERVICE_ACCOUNT_JSON` is configured. Set `FIREBASE_PROJECT_ID` to
`wa-automation-famebros-phase-1` (the default). In Vercel, add both as server
environment variables; add the complete Firebase service-account JSON value
as a **secret**, for each environment that should use Firestore. Do not commit
or paste credentials into chat. Create/enable the Firestore database in that
project and grant the service account the minimum Firestore access needed.
The included `firestore.rules` denies client access; the app uses Firebase
Admin SDK on the server. Without the service-account variable, storage remains
in-memory and is not durable. The Basic-Auth-protected dashboard supports
search/status filtering, lead details and recent conversation history, internal
notes, tags, owner assignment, and explicit status saves. Phone numbers are not
included in the lead-list response; they appear only in authenticated details.

Webhook processing uses Firestore transactionally acquired per-phone leases and
durable message-ID records when Firestore is configured. Lease contention or
storage/processing errors return HTTP 503 so Meta can retry. This coordination
does not make external WhatsApp/Sheets side effects transactional: a process
crash after sending a reply but before recording the message can result in a
repeated side effect on retry. Configure Firestore indexes/permissions and
monitor lease/storage errors before enabling this path in production; this
change has not been validated against a live Firebase project.

Follow-up automation remains disabled: `/api/cron` returns 503 and no Vercel
cron is scheduled. It must not be enabled until an approved WhatsApp template,
template language/name, due-time/opt-out policy, and idempotent delivery
tracking are implemented and configured. Never send freeform follow-ups
outside WhatsApp's customer-service window.

Broadcast campaigns, a shared team inbox, and realtime websocket updates are
not included; treat them as later phases.
