import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const receipt = 'a'.repeat(43);

function worker({ show = async () => {}, request = async () => ({ ok: true }) } = {}) {
  const handlers = {}, shown = [], requests = [];
  const self = {
    location: { origin: 'https://relay.example' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: {
      showNotification: async (title, options) => {
        shown.push({ title, ...options });
        await show();
      },
    },
  };
  vm.runInNewContext(readFileSync('public/voice-sw.js', 'utf8'), {
    self, URL, encodeURIComponent, AbortSignal, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return request(url, options);
    },
  });
  function push(data) {
    let pending;
    handlers.push({ data: { json: () => data }, waitUntil: promise => { pending = promise; } });
    assert.ok(pending, 'the push lifetime must include display and its receipt');
    return pending;
  }
  return { push, shown, requests };
}

test('notification test acknowledges only after display completes, without session credentials', async () => {
  let display;
  const harness = worker({ show: () => new Promise(resolve => { display = resolve; }) });
  const pending = harness.push({ type: 'test', receipt, receiptUrl: 'https://other.example/collect' });
  assert.equal(harness.shown[0].title, 'Relay notification test');
  assert.equal(harness.shown[0].data.url, '/?view=settings');
  assert.equal(harness.requests.length, 0, 'receipt must not precede display resolution');
  display();
  await pending;
  assert.equal(harness.requests.length, 1);
  const request = harness.requests[0];
  assert.equal(request.url, '/api/voice/push/receipt', 'payload cannot redirect receipts');
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'omit');
  assert.deepEqual(JSON.parse(request.body), { receipt });
  assert.ok(request.signal, 'receipt network activity must have an abort signal');
});

test('an unavailable receipt endpoint does not fail an already displayed notification', async () => {
  const harness = worker({ request: async () => { throw new Error('Network unavailable'); } });
  await harness.push({ type: 'test', receipt });
  assert.equal(harness.shown.length, 1);
  assert.equal(harness.requests.length, 1);
});

test('a failed notification display does not report successful browser handling', async () => {
  const harness = worker({ show: async () => { throw new Error('Notification blocked'); } });
  await Promise.resolve(harness.push({ type: 'test', receipt })).catch(() => {});
  assert.equal(harness.requests.length, 0);
});

test('ordinary pushes and invalid diagnostic receipts never call the receipt endpoint', async () => {
  const harness = worker();
  for (const invalid of [undefined, null, {}, '', 'short', 'a'.repeat(500), 'https://other.example']) {
    await harness.push({ type: 'test', receipt: invalid });
  }
  await harness.push({ type: 'sms', receipt, title: 'Synthetic sender', body: 'Synthetic message' });
  await harness.push({ type: 'call', receipt, body: 'Synthetic call' });
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.shown.length, 9, 'malformed diagnostics must not suppress the visible notification');
});
