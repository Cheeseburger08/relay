# Hosting Relay

Relay needs a running Node.js server and persistent private storage. GitHub Pages can host static content, but cannot run this application.

## Local use

Follow the README with Node 24.15+ in the 24.x line. `npm ci` installs the locked dependencies. `npm run build` builds the interface; `npm start` serves it and the API together. `npm run dev` uses Vite middleware instead.

Copy `.env.example` to `.env` when changing configuration. Keep `PORT`, `PUBLIC_ORIGIN`, and the browser URL aligned. The account command creates a local account and prompts for its password. There is no public sign-up endpoint.

## HTTPS deployment

Use a dedicated OS account, service, and data directory. Run one Relay process, and provide persistent storage for its SQLite database and encryption key. Do not reuse another application's database or credentials.

Choose one TLS arrangement:

- **Loopback reverse proxy:** keep `HOST=127.0.0.1`, set `BEHIND_PROXY=1`, `REQUIRE_HTTPS=1`, and `PUBLIC_ORIGIN=https://relay.example.com`. Your local proxy must terminate TLS and forward WebSocket upgrades as well as HTTP. Relay trusts only a loopback proxy.
- **Direct TLS:** set `TLS_KEY` and `TLS_CERT` to readable certificate files, `REQUIRE_HTTPS=1`, and an exact HTTPS `PUBLIC_ORIGIN`. Set `HOST` and `PORT` for the intended listener. Do not set `BEHIND_PROXY` in this arrangement.

Include a nonstandard port in `PUBLIC_ORIGIN` if one is used. Configure certificate renewal yourself; Relay does not provision or renew certificates. Use a service manager to start the process and restart it after failure. Keep logs private.

`DATA_DIR` defaults to `.data` beside the source. Put production data outside the checkout and give only the service account access. Back up the database together with the matching encryption key; a database-only copy is insufficient for encrypted content. Use a consistent SQLite backup or stop the service before copying its files.

## Browser notifications

Set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` for Web Push. Generate your own pair, for example with the installed `web-push` CLI (`npx web-push generate-vapid-keys`). Keep the private key out of Git and logs. Notification delivery depends on browser support, permission, and OS background restrictions. On iPhone, test the Home Screen app flow. SMS alerts display the sender and message preview. Enable or disable notifications per browser in Settings.

## Updates

Back up runtime data before changing server code. Avoid restarting the service or reinstalling the phone app during a call. For frontend-only updates, keep old hashed assets available for browsers with an open page; replace the HTML only after uploading its new assets. Refresh outside an active call.

Check `/api/health`, sign-in, phone connectivity, both SIMs, and actual two-way audio after deployment. A healthy HTTP endpoint alone does not prove that cellular calling works.

For delayed background delivery, use Settings → Test background notifications, then leave Relay for 30 seconds. Compare the visible alert with the result on return. Test on every intended browser, including the iPhone Home Screen app; provider acceptance alone does not establish background delivery.
