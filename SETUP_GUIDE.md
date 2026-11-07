\# Step-by-Step: Make the WhatsApp Bot Live (Click-by-Click)



Follow these in order. You need: a Facebook/Meta account, a business phone number not already on WhatsApp (or one you can migrate), and your server publicly reachable (ngrok for testing).



\## Part A — Create Meta app \& WhatsApp product



1\. Go to https://developers.facebook.com → \*\*My Apps\*\* → \*\*Create App\*\*.

2\. Choose app type \*\*Business\*\* → Next.

3\. Enter App name (e.g. "Famebros WhatsApp Bot"), contact email → Create App.

4\. In the app dashboard, find \*\*Add Products\*\* → \*\*WhatsApp\*\* → \*\*Set Up\*\*.

5\. You'll land on \*\*WhatsApp → API Setup\*\*.

&#x20;  - Note the \*\*Phone number ID\*\* (copy it).

&#x20;  - Note the \*\*WhatsApp Business Account ID\*\*.

&#x20;  - A test phone number is provided; you can send to your own number for testing.



\## Part B — Generate a permanent access token



1\. Go to https://business.facebook.com/settings/system-users (Business Settings → Users → System Users).

2\. \*\*Add\*\* a system user (role: Admin), name e.g. "whatsapp-bot".

3\. Click the system user → \*\*Generate New Token\*\*.

4\. Select your app → token expiration: \*\*Never\*\* (or 60 days).

5\. Permissions: check `whatsapp\_business\_messaging` and `whatsapp\_business\_management`.

6\. Generate → copy token (starts with EAA...). This is your `WHATSAPP\_TOKEN`.



\## Part C — Configure your .env



Open `C:\\Users\\VIVOBOOK\\whatsapp-famebros-bot\\.env` and set:



```

WHATSAPP\_TOKEN=EAA... (from Part B)

PHONE\_NUMBER\_ID=1234567890 (from Part A)

VERIFY\_TOKEN=dev\_verify\_token\_123 (keep or change; must match console)

PORT=3000

```



Save. Restart the server (kill node, run `npm run dev`).



\## Part D — Expose server \& register webhook



1\. Install ngrok (https://ngrok.com/download) and authenticate.

2\. Run: `ngrok http 3000`

3\. Copy the HTTPS URL (e.g. `https://abcd-12-34.ngrok-free.app`).

4\. In Meta console → WhatsApp → \*\*Configuration\*\* (left menu):

&#x20;  - \*\*Callback URL\*\*: `https://abcd-...ngrok-free.app/webhook`

&#x20;  - \*\*Verify token\*\*: same as `.env` VERIFY\_TOKEN

&#x20;  - Click \*\*Verify and Save\*\* (should show green check).

5\. Under \*\*Webhook fields\*\*, subscribe to \*\*messages\*\* (toggle on).



\## Part E — Test



1\. In Meta console → API Setup → \*\*To\*\* field: enter your personal WhatsApp number (with country code, no +).

2\. Click \*\*Send Message\*\* (sends a template "hello\_world") — confirms outbound works.

3\. Now message your business number from your phone: type "hi".

4\. You should receive the interactive menu. Tap options to navigate.



\## Part F — Add your real business number (production)



1\. WhatsApp → API Setup → \*\*Add phone number\*\*.

2\. Enter the client's number, verify via SMS/voice code.

3\. Update `.env` PHONE\_NUMBER\_ID with the new number's ID.

4\. Restart server.



\## Part G — Go live (hosting)



Deploy to Railway/Render/VPS:

\- Set environment variables from `.env`.

\- Start command: `npm start`.

\- Update Meta webhook Callback URL to your production HTTPS URL.

\- Keep HTTPS certificate valid.



\## Troubleshooting



\- \*\*Webhook verify fails\*\*: VERIFY\_TOKEN mismatch; check `.env` vs console.

\- \*\*No reply received\*\*: check server logs; ensure `messages` subscribed; phone number registered.

\- \*\*"message not delivered" / template errors\*\*: for free-form replies you must reply within 24h of user message (session window). Our bot only replies to incoming messages, so OK.

\- \*\*Interactive list not showing\*\*: ensure WhatsApp app updated; fallback text still sent.

\- \*\*Token expired\*\*: regenerate system user token (Part B).



\## Customising replies

Edit `src/data/knowledge.js` (packages, prices, FAQ). Restart not required for content? Restart server after edits.



\## Files

\- `src/index.js` — server + webhook

\- `src/handlers/messageHandler.js` — routing

\- `src/services/whatsapp.js` — send API

\- `src/data/knowledge.js` — content

\- `.env` — secrets

