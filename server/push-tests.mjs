import { randomBytes } from 'node:crypto';
import { hash } from './store.mjs';

// Short-lived diagnostic state only: no message contents or browser fingerprints.
export function registerPushTests(app, store, { auth, origin, send, onStatus = () => {}, delayMs = 10000 }) {
  const tests = new Map(), receipts = new Map();
  function forget(id, record) {
    clearTimeout(record.timer);
    receipts.delete(record.receipt);
    tests.delete(id);
  }
  const cleanup = setInterval(() => {
    for (const [id, record] of tests) if (record.expires <= Date.now()) forget(id, record);
  }, 60000);
  cleanup.unref();
  function status(user, id) {
    const record = tests.get(id);
    if (!record || record.user !== user || record.expires <= Date.now()) return null;
    const { state, scheduledAt, sentAt, acceptedAt, displayedAt, error } = record;
    return { state, scheduledAt, sentAt, acceptedAt, displayedAt, error };
  }
  function cancel(user, id) {
    const record = tests.get(id);
    if (!record || record.user !== user) return;
    clearTimeout(record.timer);
    receipts.delete(record.receipt);
    record.state = 'cancelled';
  }
  app.post('/api/voice/push/test', auth, (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 4096) return res.sendStatus(400);
    const id = hash(endpoint), row = store.get('SELECT * FROM push_subscriptions WHERE id=? AND user_id=?', id, req.user);
    if (!row) return res.status(409).json({ error: { message: 'Enable notifications on this browser first.' } });
    const old = tests.get(id), now = Date.now();
    if (old && now - old.created < 30000) return res.status(429).json({ error: { message: 'Wait 30 seconds before another test.' } });
    if (old) forget(id, old);
    if (tests.size >= 1000) return res.sendStatus(429);
    const receipt = randomBytes(32).toString('base64url');
    const record = { id, user: req.user, created: now, expires: now + 600000, receipt, state: 'scheduled', scheduledAt: now + delayMs };
    tests.set(id, record);
    onStatus(record.user,'push_test_scheduled',{subscription:id.slice(0,12)});
    receipts.set(receipt, record);
    record.timer = setTimeout(async () => {
      if (!store.get('SELECT id FROM push_subscriptions WHERE id=? AND user_id=?', id, record.user)) { cancel(record.user, id); return; }
      record.sentAt = Date.now(); record.state = 'sending';
      try {
        await send(row, { type: 'test', title: 'Relay notification test', body: 'This is a background notification test. No SMS was sent.', receipt });
        record.acceptedAt = Date.now();
        onStatus(record.user,'push_test_accepted',{subscription:id.slice(0,12)});
        if (record.state === 'sending') record.state = 'accepted';
      } catch (error) {
        if (record.state !== 'sending') return;
        record.state = 'failed';
        onStatus(record.user,'push_test_failed',{subscription:id.slice(0,12),status:error.statusCode||null});
        record.error = [404, 410].includes(error.statusCode) ? 'Subscription expired. Disable and enable notifications, then retry.' : 'The push service did not accept the test. Please retry.';
      }
    }, delayMs);
    record.timer.unref();
    res.status(202).json({ test: status(req.user, id) });
  });
  // Capability-based receipt works while the browser session is asleep/expired.
  app.post('/api/voice/push/receipt', (req, res) => {
    if (req.get('Origin') !== origin) return res.sendStatus(403);
    const receipt = req.body?.receipt;
    if (typeof receipt !== 'string' || !/^[\w-]{43}$/.test(receipt)) return res.sendStatus(400);
    const record = receipts.get(receipt);
    if (!record || record.expires <= Date.now() || !record.sentAt) return res.sendStatus(404);
    if(!record.displayedAt)onStatus(record.user,'push_test_handled',{subscription:record.id.slice(0,12),delayMs:Date.now()-record.sentAt});
    record.displayedAt ??= Date.now();
    record.state = 'displayed';
    res.sendStatus(204);
  });
  return { status, cancel, close() { clearInterval(cleanup); for (const [id, record] of tests) forget(id, record); } };
}
