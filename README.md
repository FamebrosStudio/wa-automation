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

