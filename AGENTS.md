# Relay contributor instructions

Read README.md, docs/ANDROID.md, docs/API.md and docs/SETUP.md before changing behavior.
Use Node 24.15+ within 24.x and the lockfile. Run npm test and npm run build.
Use synthetic data for tests/screenshots. Never commit private data, keys, device
dumps, firmware, or local deployment configuration. Keep each deployment isolated.
Preserve explicit pairing and visible enabled state, account isolation, SMS
idempotency, and single-browser audio ownership. Do not add hidden recording or
remote shell execution. Device-specific audio changes require physical validation;
never equate passing synthetic tests with audible cellular audio.
