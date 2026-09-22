# Relay API v1 - phone integration contract

2026-09-22 browser handoff: an authenticated browser may send
`{type:"takeover",callId,clientId}` for the current active call after preparing
microphone access. `clientId` is a random per-client ID (8-80 word/hyphen chars),
also sent on automatic `attach` for socket reconnection. Successful takeover
reserves automatic reattachment to this client until the call changes or another
explicit takeover occurs. It sends `audio_taken` with `callId` to other browsers;
they must stop local media and automatic retry. WebSocket state adds per-browser
`audioHere` and `audioElsewhere` (global `claimed` remains compatible). The active
phone stream is reused during handoff. Identity remains the authenticated session;
clientId is a reconnect preference, not an authorization credential.

## Live calling addition (2026-09-22; experimental device-specific implementation)

`GET /api/voice` returns account-specific phone connectivity, current call and
public VAPID key. `POST /api/voice/push` registers encrypted push subscriptions
with browser authentication/CSRF and an HTTPS provider allowlist.
Browser WSS `/api/voice/browser` requires session cookie and exact Origin.
Phone WSS `/api/voice/device` requires the paired device bearer token.
Calls use JSON state/commands plus 640-byte PCM frames (16 kHz, mono, signed
16-bit little endian, 20 ms). Audio is relayed live, never stored. HTTPS/WSS
protect transport; this is not end-to-end encryption against the Relay server.
Commands have unique IDs and expiry; unknown-SIM audio fails closed.
Phone receives `hello.serverTime` on connection and periodically, anchors it to
monotonic elapsed time, and checks `issuedAt`/`expires` without handset wall time.
`command_result` includes command ID, accepted boolean and a bounded reason
code. Acceptance means Android accepted the operation; actual call state is
still authoritative. `check` validates call control readiness without dialing.
Answer/dial requires user interaction and browser microphone permission.
Media ownership is exclusive per account. Disconnect or stalled media starts a
60-second recovery deadline; only restored duplex audio cancels it. Explicit End
remains immediate when connected. Browser automatically retries audio attachment;
permission/autoplay restrictions can still require a user gesture.
`dtmf` accepts one digit from `0-9*#` for the owner's active matching call only.
Tones have a one-second command expiry and a 150ms minimum interval; Android
stops each accepted tone after 130ms. Digits are not retained in history.
The old REST `/api/calls` remains unavailable; call control uses WSS.

Verified against local automated tests again on 2026-09-21. A first Android
companion is implemented and installed, with physical integration still pending.
All routes are relative to the Relay origin and use JSON.
`GET /api/health` returns `{ "ok": true, "product": "relay", "version": 1 }`.

## Browser authentication

`POST /api/login` with `{ "username": "owner", "password": "..." }` returns
`{ "user": { "name": "owner", "username": "owner" }, "csrf": "..." }`.
It sets an HttpOnly, SameSite=Strict session cookie, valid for 12 hours. In
HTTPS mode its name is `__Host-relay` and it has Secure set. Local development
uses `relay_session`. Tokens are hashed in the database.

- Browser login and mutations must include `Origin` equal to `PUBLIC_ORIGIN`.
- Authenticated mutations also require `X-CSRF-Token` from login/session.
- `GET /api/session` returns the same user and CSRF shape.
- `POST /api/logout` removes the current session.
- `POST /api/password`: `currentPassword`, `newPassword` (12-256 characters).
  Changes the password and revokes every browser session, not the paired phone.
- `GET /api/state` returns account-scoped `conversations`, `messages`, `contacts`,
  `calls`, `device`, `capabilities`, `limitedHistory`.
- All API responses have `Cache-Control: no-store, private`.

State currently includes the newest 1,000 messages and 500 calls, not unlimited
history. `limitedHistory` is true. Pagination is a future extension. Phone online
means a heartbeat was received less than 60 seconds ago; not carrier reachability.

## Pair the phone

1. Authenticated browser: `POST /api/pairings` (empty body). Returns
   `{ "token": "ONE_TIME_CODE", "expiresAt": 0, "server": "ORIGIN" }`.
   The actual expiry is Unix epoch milliseconds, five minutes ahead. Creating a
   new code invalidates previous codes. One phone per account for this version.
2. Phone: `POST /api/device/pair` with `{ "token": "ONE_TIME_CODE", "name": "Xperia XZ" }`.
3. Returns HTTP 201 `{ "deviceId": "UUID", "token": "DEVICE_BEARER_TOKEN" }`.
   The pairing code is consumed. Store this bearer token using Android Keystore
   backed storage; never print it or put it in a URL or ordinary log.
4. All subsequent `/api/device/*` requests use `Authorization: Bearer TOKEN`.
   They do not use browser cookies, Origin or CSRF headers.
5. Use trusted HTTPS and normal certificate validation outside loopback testing.
   Never add a trust-all certificate handler to the Android app.

Lost pairing responses need operator recovery: remove the paired phone in the
web UI and generate a new code. Device tokens cannot be retrieved afterward.

`DELETE /api/device` is a browser-authenticated operation. It revokes the phone,
cancels unclaimed commands, marks claimed commands unknown, removes its command
queue and event deduplication ledger, and retains message/call history. A command
already on the phone might still send; revocation cannot undo a sent SMS.
Request idempotency records survive revocation.

## Heartbeat

`POST /api/device/heartbeat`:

```json
{
  "model": "F8332",
  "battery": 82,
  "smsReady": true,
  "sims": [
    { "slot": 1, "label": "Personal", "available": true },
    { "slot": 2, "label": "Second line", "available": true }
  ]
}
```

Send approximately every 20 seconds while connected. Battery can be null.
Never claim SMS ready until permissions, SIM mapping and send capability have
been checked. API slots 1/2 are **not** Android subscription IDs. Resolve each
slot to its current Android subscription ID on every SIM/configuration change.

## Upload events

`POST /api/device/events` accepts a maximum of 50 events, within a 96 KiB JSON
request limit. Persist a stable local event ID before upload. A duplicate ID
with identical parsed fields is ignored; a changed payload returns 409 and rolls
back the entire batch. Retry an identical batch after network failure.

```json
{
  "events": [
    {
      "id": "sms-local-000001",
      "type": "sms",
      "number": "+12025550101",
      "sim": 1,
      "timestamp": 1790000000000,
      "direction": "incoming",
      "text": "Example message"
    },
    {
      "id": "call-local-000001",
      "type": "call",
      "number": "+12025550101",
      "sim": 1,
      "timestamp": 1790000000000,
      "direction": "missed",
      "duration": 0
    }
  ]
}
```

Response: `{ "accepted": 2, "duplicates": 0 }`.

- Timestamp: Unix epoch milliseconds, at most five minutes in the future.
- IDs: 8-128 ASCII word characters/hyphens; stable for that device/event.
- SMS direction: incoming/outgoing. Text max 10,000 characters. Sender may be
  an alphanumeric sender ID; do not turn it into an arbitrary reply destination.
- Call direction: incoming/outgoing/missed. Duration seconds 0-86,400.
- Normalize numeric phone addresses to E.164 on the phone where possible;
  preserve short/alphanumeric senders when they cannot be normalized.
- Do not upload a command-generated SMS again as an unrelated outgoing event.
  Link local provider entries to command IDs and use command results instead.
- On re-pairing, send only events not already synchronized, unless the user
  explicitly chooses a history reimport. Device-event dedup is per pairing.
- No attachments, MMS/RCS or recordings in this version. Contact sync uses the separate routes below.

## Send SMS through the phone

Browser `POST /api/messages`, with `Idempotency-Key: RANDOM_UNIQUE_REQUEST_ID`:

```json
{ "number": "+12025550101", "sim": 1, "text": "Example reply" }
```

Returns HTTP 201 `{ "id": "MESSAGE_ID", "commandId": "COMMAND_ID", "replayed": false }`.
Identical retries return 200/replayed true, even after phone removal. Reusing the
same key with different content returns 409. Destination must be E.164, text
1-1,600 characters after trimming, SIM 1 or 2. GSM/UCS-2 segment calculation and
carrier charges are not estimated yet; long messages can incur multiple charges.

Queue expires after ten minutes if not claimed. A paired but offline phone can
have queued messages if its last capabilities indicated that SIM was ready.
The website does not claim a queued SMS was sent.

Phone `POST /api/device/commands/claim` returns:

```json
{
  "command": {
    "id": "COMMAND_ID",
    "type": "send_sms",
    "messageId": "MESSAGE_ID",
    "number": "+12025550101",
    "sim": 1,
    "text": "Example reply",
    "direction": "outgoing",
    "status": "sending",
    "expiresAt": 1790000600000
  }
}
```

Or `{ "command": null }`. Poll conservatively (e.g. 2-5 seconds), with bounded
backoff on network failures. Claim is atomic and **at most once**: it is never
automatically returned again, even if its HTTP response is lost. Persist command
IDs on the phone **before** sending; never send a persisted command twice.
Do not send a command after its expiry. Report failure instead.

Phone `POST /api/device/commands/COMMAND_ID/result`:

```json
{ "status": "sent" }
```

Statuses are `sent`, `delivered`, `failed` based on Android callbacks, not guesses.
Same-result retries are idempotent. Sent can later become delivered. Claimed
commands without a result after two minutes become `unknown`, never requeued.
A late result can resolve unknown. Delivery callbacks may not be supported by
the carrier. Do not label `sent` as delivered. After server removal, a result can
receive 401/404; the phone must stop polling and request re-pairing.

This favors avoiding duplicate paid texts over guaranteed delivery after crashes.
Browser `POST /api/messages/MESSAGE_ID/cancel` cancels only unclaimed queued SMS.

## Contacts and conversations

- `POST /api/contacts`: `{ "name": "Example", "number": "+12025550101" }`.
  Upserts by account/number; number changes require a new contact. UI can edit name.
- `DELETE /api/contacts/CONTACT_ID`: delete owned contact.
- `PATCH /api/conversations/ID`: optional booleans `read`, `pinned`, `archived`.
  `read: true` clears unread; `read: false` currently does not mark unread.
- Conversations are keyed by account, sender/recipient number and SIM.
- `POST /api/calls`: intentionally returns 501 `calls_not_ready`.

## Errors and limits

Error shape: `{ "error": { "code": "...", "message": "..." } }`.

| HTTP | Codes                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| 400  | invalid_request, invalid_json                                                                                                 |
| 401  | unauthorized, invalid_credentials, device_unauthorized, invalid_pairing                                                       |
| 403  | origin_rejected, csrf_rejected                                                                                                |
| 404  | not_found                                                                                                                     |
| 409  | already_paired, device_not_paired, sim_unavailable, idempotency_conflict, event_conflict, not_cancellable, invalid_transition |
| 413  | too_large                                                                                                                     |
| 429  | rate_limited                                                                                                                  |
| 500  | internal_error                                                                                                                |
| 501  | calls_not_ready                                                                                                               |

Single-process in-memory 15-minute limits: login 8/IP, phone pairing claims 15/IP,
pairing creation 10/account, new SMS 30/account, password changes 8/account.
Successful login attempts count too. Process restart resets these limits.
Reverse-proxy limits and a durable abuse policy remain deployment work.

## Contact synchronization (2026-09-21)

Contact saves have a monotonically increasing version. Browser deletion creates
an encrypted tombstone so an offline phone will remove the number on reconnect.
`GET /api/state` contacts include `phoneSynced`: true only when the current paired
device has acknowledged the current version. Unsynced saves show pending.

Device POST `/api/device/contacts/import` accepts `contacts` (up to 50) with
`source` (decimal provider row ID), `name` (1-80), `number` (E.164). It links by
account/number without overwriting an existing panel value; response gives
`namespace` and `linked` source/id pairs. Up to 1,000 distinct numbers including
tombstones. Existing deleted entries are not silently resurrected by import.

Device POST `/api/device/contacts/sync` accepts `changes` (up to 50; id, version,
name, number, deleted) and `acknowledgments` (up to 1,000; id, version).
Changes require the current version and account ownership. Stale edits and
number collisions are returned as conflict IDs; the panel version prevails.
Acknowledgments cannot confirm stale versions or another account's contacts.
Response includes namespace, conflicts, and contacts including tombstones.
Contact names/numbers remain encrypted at rest, with keyed number indexes.

## Phone history import (2026-09-21)

Device POST `/api/device/history` takes `records` (1-25 per request). Companion
sends one per request and scans up to 50 SMS and 50 call rows per ~20-second cycle.
Fields: id (`smsdb-ROW-TIMESTAMP` or `call-ROW-TIMESTAMP`; legacy SMS `-0` accepted), type sms/call, number,
originalNumber, sim (0=unknown, 1/2=resolved physical slot), timestamp,
sentTimestamp, direction. SMS also includes text, status and read; calls include
duration. Received/sent/failed/draft/pending SMS are represented without queuing
any send operation. Rejected/blocked/voicemail/unknown calls stay visible in All.

Per-device provider-row links persist before the client records acknowledgment.
Identical retries are ignored; changed snapshots update the linked history row.
Legacy live copies are reconciled one-to-one using number, SIM, direction,
content/duration and timestamp (outgoing SMS allows five minutes of clock/send
latency). Two distinct identical provider rows remain distinct messages. Existing
Relay command results remain authoritative for command-linked outgoing SMS.
Deletion now synchronizes as described below. Panel history still exposes the
newest 1,000 messages and 500 calls; pagination is outstanding.

## Deletion, blocking and voice diagnostics (2026-09-22)

Authenticated, CSRF-protected DELETE `/api/messages/:id`, `/api/calls/:id`,
`/api/conversations/:id`, `/api/messages`, `/api/calls` return 204. Bulk operations
are atomic snapshots of the account's current rows. Tombstones hide records and
clear their encrypted content; pending device actions retain only guarded row
identity. Device offline is allowed. Missing guards/links or an unresolved claimed
SMS return 409 rather than deleting an uncertain phone row. State exposes
`historySync.pending` and `historySync.failed` counts.

Device POST `/api/device/history/sync` accepts missing acknowledged provider IDs
and action results `{id,ok,error?}`; each list has maximum 100. Errors are
permission/changed/unavailable. Response returns up to 50 pending/failed actions.
Delete actions use timestamp, original number and SMS SHA256 hash guards. Only
the paired device/account may acknowledge them. The guarded `set_sim` action is
reserved for the explicitly requested one-time backup correction, not a browser
endpoint or a blanket unknown-SIM default.

POST `/api/blocks` accepts `{number,blocked}`. Phone POST `/api/device/blocks/sync`
accepts imported numbers (100), versioned changes (100) and acknowledgments (2000).
Response returns versioned blocks including unblock tombstones. Stale phone edits
cannot overwrite a newer panel version. State blocks include `phoneSynced`.
Blocking uses Android's default-dialer blocked-number provider for both calls and
SMS. Formatting is canonicalized; Iranian mobile numbers may use 09 or +98 form.

GET `/api/voice/diagnostics` returns `{events}` with at most 100 metadata-only
events for the signed-in account. No phone numbers, audio or message content.
Events distinguish recovery, socket close, rate limit, backpressure, media attach
and phone audio failures. In-memory records are reset when the service restarts.

History deletion without a provider link now creates a durable pending deletion. The row disappears from browser state immediately; encrypted matching fields are retained until history import provides the exact provider identity. Import then queues the guarded phone deletion and erases the retained payload. Pending links count toward historySync.pending. Claimed/unknown outgoing SMS still require a send result before deletion.

Incoming SMS events now trigger Web Push to the owner's existing notification subscriptions after commit. Replayed events, outgoing SMS and history imports do not notify. Payloads contain SIM and conversation ID, without sender or message contents. SMS notification clicks open the conversation; call notifications retain their call destination.
