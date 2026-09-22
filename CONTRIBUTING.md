# Contributing

This started as a vibe-coded solution to a personal need. Small, understandable fixes and reproducible reports are especially useful.

Use Node 24.15+ within 24.x. Run `npm ci`, `npm test`, and `npm run build`. For Android changes, also run the companion's Gradle tests/lint and state which physical device and firmware were tested.

Keep SMS command IDs/idempotency, account isolation, explicit pairing, and audio ownership intact. Do not automatically resend claimed SMS, record calls, add hidden phone operation, or relax device/firmware audio checks without a verified replacement path.

For audio reports, separate browser-to-caller from caller-to-browser behavior. State the phone model/build, SIM, browser/version, network, and what both people heard. Synthetic counters or route selection alone do not demonstrate audible audio.

Use synthetic data in tests and screenshots. Do not commit databases, backups, local deployment notes, `.env` files, firmware, private libraries, generated APKs, or keys. Describe what changed and how you verified it in your pull request.
