import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

test("private phone API contract", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-test-")),
    store = createStore(dir);
  const owner = store.createUser("alice", "Alice", "a-test-password-only"),
    other = store.createUser("bob", "Bob", "b-test-password-only");
  const origin = "http://localhost:49760",
    app = createApp(store, { origin }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let cookie = "",
    csrf = "",
    token = "",
    messageId = "",
    commandId = "";
  async function request(
    path,
    {
      body,
      method = body ? "POST" : "GET",
      device = false,
      headers = {},
      anonymous = false,
    } = {},
  ) {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          Origin: origin,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(!anonymous
            ? device
              ? { Authorization: "Bearer " + token }
              : { Cookie: cookie, "X-CSRF-Token": csrf }
            : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: res.status, data: await res.json(), headers: res.headers };
  }
  await t.test(
    "private endpoints reject anonymous requests and cross-origin login",
    async () => {
      assert.equal((await request("/state")).status, 401);
      assert.equal(
        (
          await request("/login", {
            body: { username: "alice", password: "a-test-password-only" },
            headers: { Origin: "https://evil.example" },
          })
        ).status,
        403,
      );
      const r = await request("/login", {
        body: { username: "alice", password: "a-test-password-only" },
      });
      assert.equal(r.status, 200);
      cookie = r.headers.get("set-cookie").split(";")[0];
      csrf = r.data.csrf;
      assert.match(r.headers.get("set-cookie"), /HttpOnly/);
      assert.match(r.headers.get("cache-control"), /no-store/);
      assert.equal(
        (
          await request("/pairings", {
            method: "POST",
            headers: { "X-CSRF-Token": "bad" },
          })
        ).status,
        403,
      );
    },
  );
  await t.test(
    "pairing is single-use and reports capabilities honestly",
    async () => {
      const p = await request("/pairings", { method: "POST" });
      assert.equal(p.status, 201);
      const r = await request("/device/pair", {
        body: { token: p.data.token, name: "Test Xperia" },
        anonymous: true,
      });
      assert.equal(r.status, 201);
      token = r.data.token;
      assert.equal(
        (
          await request("/device/pair", {
            body: { token: p.data.token, name: "Replay" },
            anonymous: true,
          })
        ).status,
        401,
      );
      const state = (await request("/state")).data;
      assert.equal(state.device.smsReady, false);
      assert.equal(state.capabilities.liveCalls, false);
      assert.equal((await request("/calls", { method: "POST" })).status, 501);
      assert.equal(
        (
          await request("/device/heartbeat", {
            body: {
              model: "F8332",
              battery: 81,
              smsReady: true,
              sims: [
                { slot: 1, label: "Personal", available: true },
                { slot: 2, label: "Other", available: false },
              ],
            },
            device: true,
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "SMS queued once, claim once, confirmation and delivery transitions",
    async () => {
      const options = {
        body: { number: "+12025550101", sim: 1, text: "Private test message" },
        headers: { "Idempotency-Key": "test-message-0001" },
      };
      const first = await request("/messages", options);
      assert.equal(first.status, 201);
      messageId = first.data.id;
      commandId = first.data.commandId;
      const retry = await request("/messages", options);
      assert.equal(retry.status, 200);
      assert.equal(retry.data.id, messageId);
      assert.equal(
        (
          await request("/messages", {
            ...options,
            body: { ...options.body, text: "Different" },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request("/messages", {
            body: { ...options.body, sim: 2 },
            headers: { "Idempotency-Key": "test-message-0002" },
          })
        ).data.error.code,
        "sim_unavailable",
      );
      const c = await request("/device/commands/claim", {
        method: "POST",
        device: true,
      });
      assert.equal(c.data.command.id, commandId);
      assert.equal(c.data.command.text, "Private test message");
      assert.equal(
        (
          await request("/device/commands/claim", {
            method: "POST",
            device: true,
          })
        ).data.command,
        null,
      );
      assert.equal(
        (
          await request("/messages/" + messageId + "/cancel", {
            method: "POST",
          })
        ).status,
        409,
      );
      for (const status of ["sent", "sent", "delivered"])
        assert.equal(
          (
            await request("/device/commands/" + commandId + "/result", {
              device: true,
              body: { status },
            })
          ).status,
          200,
        );
      assert.equal(
        (await request("/state")).data.messages[0].status,
        "delivered",
      );
      assert.equal(
        (
          await request("/device/commands/" + commandId + "/result", {
            device: true,
            body: { status: "failed" },
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    "incoming events deduplicate, conflicting retries roll back",
    async () => {
      const alerts=[];
      app.locals.voice.notifySms=async (user,sms)=>{alerts.push({user,...sms});};
      const sms = {
          id: "incoming-0001",
          type: "sms",
          number: "+12025550101",
          sim: 1,
          timestamp: Date.now(),
          direction: "incoming",
          text: "Incoming secret",
        },
        call = {
          id: "call-000001",
          type: "call",
          number: "+12025550101",
          sim: 1,
          timestamp: Date.now(),
          direction: "missed",
          duration: 0,
        };
      assert.equal(
        (
          await request("/device/events", {
            device: true,
            body: { events: [sms, call] },
          })
        ).data.accepted,
        2,
      );
      assert.equal(
        (
          await request("/device/events", {
            device: true,
            body: { events: [sms, call] },
          })
        ).data.duplicates,
        2,
      );
      assert.equal(
        (
          await request("/device/events", {
            device: true,
            body: {
              events: [
                { ...call, id: "call-000002" },
                { ...sms, text: "Conflict" },
              ],
            },
          })
        ).status,
        409,
      );
      const d = (await request("/state")).data;
      assert.equal(d.messages.length, 2);
      assert.equal(d.calls.length, 1);
      assert.equal(alerts.length,1,"only new incoming SMS alerts, not duplicates or calls");
      assert.equal(alerts[0].user,owner);
      assert.ok(alerts[0].conversationId);
      assert.equal(alerts[0].text,sms.text);
      assert.equal(alerts[0].number,sms.number);
      assert.equal(
        (
          await request("/conversations/" + d.conversations[0].id, {
            method: "PATCH",
            body: { read: true, pinned: true },
          })
        ).status,
        200,
      );
      assert.equal(
        (await request("/state")).data.messages.filter((m) => m.unread).length,
        0,
      );
    },
  );
  await t.test("account isolation and content-at-rest encryption", async () => {
    assert.equal(store.state(other).messages.length, 0);
    assert.equal(store.state(other).device, null);
    const r = await request("/login", {
        body: { username: "bob", password: "b-test-password-only" },
      }),
      bobCookie = r.headers.get("set-cookie").split(";")[0];
    const c = store.state(owner).conversations[0];
    assert.equal(
      (
        await request("/conversations/" + c.id, {
          method: "PATCH",
          body: { archived: true },
          headers: { Cookie: bobCookie, "X-CSRF-Token": r.data.csrf },
        })
      ).status,
      404,
    );
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const contents = readFileSync(join(dir, "relay.sqlite")).toString("utf8");
    assert.ok(!contents.includes("Private test message"));
    assert.ok(!contents.includes("Incoming secret"));
    assert.ok(!contents.includes("+12025550101"));
    assert.ok(!contents.includes(token));
  });
  await t.test(
    "queued expiration and uncertain claimed SMS never auto-retry",
    async () => {
      const r = await request("/messages", {
        body: { number: "+12025550101", sim: 1, text: "Expire me" },
        headers: { "Idempotency-Key": "test-expire-001" },
      });
      store.run(
        "UPDATE commands SET expires=? WHERE id=?",
        Date.now() - 100,
        r.data.commandId,
      );
      store.expire();
      assert.equal(
        store.state(owner).messages.find((m) => m.id === r.data.id).status,
        "expired",
      );
      const u = await request("/messages", {
        body: { number: "+12025550101", sim: 1, text: "Unknown result" },
        headers: { "Idempotency-Key": "test-unknown-001" },
      });
      await request("/device/commands/claim", { method: "POST", device: true });
      store.run(
        "UPDATE commands SET claimed=? WHERE id=?",
        Date.now() - 130000,
        u.data.commandId,
      );
      store.expire();
      assert.equal(
        store.state(owner).messages.find((m) => m.id === u.data.id).status,
        "unknown",
      );
      assert.equal(
        (
          await request("/device/commands/claim", {
            method: "POST",
            device: true,
          })
        ).data.command,
        null,
      );
    },
  );
  await t.test(
    "history imports old rows, reconciles live copies and keeps distinct identical SMS",
    async () => {
      const timestamp = Date.now() - 86400000;
      const row = {
        id: "smsdb-900-0",
        type: "sms",
        number: "+12025550188",
        originalNumber: "+12025550188",
        sim: 1,
        timestamp,
        sentTimestamp: timestamp,
        direction: "incoming",
        text: "Historical fixture",
        status: "received",
        read: true,
      };
      await request("/device/events", {
        device: true,
        body: {
          events: [
            {
              id: "history-live-fixture",
              type: "sms",
              number: row.number,
              sim: 1,
              timestamp,
              direction: "incoming",
              text: row.text,
            },
          ],
        },
      });
      const before = store.state(owner).messages.length;
      const history = (records) =>
        request("/device/history", { device: true, body: { records } });
      assert.deepEqual((await history([row])).data, {
        imported: 0,
        matched: 1,
        duplicates: 0,
      });
      assert.equal(store.state(owner).messages.length, before);
      assert.equal((await history([row])).data.duplicates, 1);
      assert.equal(
        (await history([{ ...row, id: "smsdb-901-0" }])).data.imported,
        1,
      );
      assert.equal(store.state(owner).messages.length, before + 1);
      await history([{ ...row, id: "smsdb-901-0", read: false }]);
      assert.equal(store.state(owner).messages.length, before + 1);
      const call = {
        id: "call-901-100",
        type: "call",
        number: "Unknown caller",
        originalNumber: "",
        sim: 0,
        timestamp: 100,
        sentTimestamp: 0,
        direction: "rejected",
        duration: 0,
      };
      assert.equal((await history([call])).data.imported, 1);
      assert.equal((await history([call])).data.duplicates, 1);
      assert.equal(
        store.state(other).calls.some((c) => c.createdAt === 100),
        false,
      );
    },
  );
  await t.test(
    "contact sync confirms versions, rejects stale edits and preserves deletion tombstones",
    async () => {
      const added = await request("/contacts", {
        body: { name: "Sync Fixture", number: "+12025550199" },
      });
      const id = added.data.id;
      const imported = await request("/device/contacts/import", {
        device: true,
        body: {
          contacts: [
            { source: "123", name: "Phone copy", number: "+12025550199" },
          ],
        },
      });
      assert.equal(imported.status, 200);
      assert.equal(imported.data.linked[0].id, id);
      assert.equal(
        store.state(owner).contacts.find((c) => c.id === id).name,
        "Sync Fixture",
      );
      const sync = (changes = [], acknowledgments = []) =>
        request("/device/contacts/sync", {
          device: true,
          body: { changes, acknowledgments },
        });
      let row = (await sync()).data.contacts.find((c) => c.id === id);
      assert.equal(
        store.state(owner).contacts.find((c) => c.id === id).phoneSynced,
        false,
      );
      await sync([], [{ id, version: row.version }]);
      assert.equal(
        store.state(owner).contacts.find((c) => c.id === id).phoneSynced,
        true,
      );
      await sync([{ ...row, name: "Edited on phone" }]);
      assert.equal(
        store.state(owner).contacts.find((c) => c.id === id).name,
        "Edited on phone",
      );
      const stale = await sync([{ ...row, name: "Stale edit" }]);
      assert.deepEqual(stale.data.conflicts, [id]);
      assert.equal(
        store.state(owner).contacts.find((c) => c.id === id).name,
        "Edited on phone",
      );
      await request("/contacts/" + id, { method: "DELETE" });
      row = (await sync()).data.contacts.find((c) => c.id === id);
      assert.equal(row.deleted, true);
      assert.equal(
        store.state(owner).contacts.some((c) => c.id === id),
        false,
      );
      assert.equal(
        store.state(other).contacts.some((c) => c.id === id),
        false,
      );
      await sync([], [{ id, version: row.version - 1 }]);
      assert.notEqual(
        store.get("SELECT * FROM contacts WHERE id=?", id).synced_version,
        row.version,
      );
    },
  );
  await t.test(
    "revocation removes device access and password change removes sessions",
    async () => {
      assert.equal(
        (await request("/device", { method: "DELETE" })).status,
        200,
      );
      assert.equal(
        (
          await request("/device/commands/claim", {
            method: "POST",
            device: true,
          })
        ).status,
        401,
      );
      const retry = await request("/messages", {
        body: { number: "+12025550101", sim: 1, text: "Private test message" },
        headers: { "Idempotency-Key": "test-message-0001" },
      });
      assert.equal(retry.status, 200);
      assert.equal(retry.data.id, messageId);
      assert.equal(
        (
          await request("/password", {
            body: {
              currentPassword: "a-test-password-only",
              newPassword: "a-new-test-password",
            },
          })
        ).status,
        200,
      );
      assert.equal((await request("/state")).status, 401);
    },
  );
});
