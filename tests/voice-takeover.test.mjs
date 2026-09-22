import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createStore, hash, secret } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
const until = async (fn) => {
  const end = Date.now() + 2500;
  while (!fn()) {
    if (Date.now() > end) throw Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

test("explicit browser takeover moves duplex audio and prevents automatic steal-back", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-handoff-")),
    store = createStore(dir);
  const user = store.createUser("owner", "Owner", "synthetic-test-password"),
    other = store.createUser("other", "Other", "synthetic-test-password");
  const token = secret(),
    session = secret(),
    otherSession = secret(),
    origin = "http://localhost:49761";
  store.run(
    "INSERT INTO devices(id,user_id,token,data) VALUES(?,?,?,?)",
    "test-device",
    user,
    hash(token),
    store.seal({}),
  );
  for (const [s, u] of [
    [session, user],
    [otherSession, other],
  ])
    store.run(
      "INSERT INTO sessions(token,user_id,csrf,expires) VALUES(?,?,?,?)",
      hash(s),
      u,
      secret(),
      Date.now() + 60000,
    );
  const app = createApp(store, { origin }),
    server = app.listen(0, "127.0.0.1");
  app.locals.voice.attach(server);
  await new Promise((r) => server.once("listening", r));
  const url = `ws://127.0.0.1:${server.address().port}`,
    sockets = [];
  t.after(async () => {
    sockets.forEach((s) => s.terminate());
    app.locals.voice.close();
    await new Promise((r) => server.close(r));
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function open(path, headers) {
    const s = new WebSocket(url + path, { headers });
    s.messages = [];
    s.on("message", (d, b) =>
      s.messages.push(b ? Buffer.from(d) : JSON.parse(d)),
    );
    sockets.push(s);
    await new Promise((r, j) => {
      s.once("open", r);
      s.once("error", j);
    });
    return s;
  }
  const phone = await open("/api/voice/device", {
    Authorization: "Bearer " + token,
  });
  const openBrowser = (cookie = session) =>
    open("/api/voice/browser", {
      Origin: origin,
      Cookie: "relay_session=" + cookie,
    });
  const home = await openBrowser(),
    work = await openBrowser(),
    stranger = await openBrowser(otherSession);
  const call = {
    id: "handoff-call-1",
    state: "active",
    sim: 1,
    number: "+12025550123",
  };
  const command = (ws, type, clientId, callId = call.id) =>
    ws.send(JSON.stringify({ type, clientId, callId }));
  phone.send(JSON.stringify({ type: "state", call }));
  await until(() => home.messages.some((m) => m.call?.id === call.id));
  command(home, "attach", "home-browser");
  await until(() => home.messages.some((m) => m.type === "media_ready"));
  command(work, "attach", "work-browser");
  await until(() => work.messages.some((m) => m.type === "error"));
  const starts = phone.messages.filter(
    (m) => m.type === "media" && m.enabled,
  ).length;
  command(stranger, "takeover", "stranger-browser");
  command(work, "takeover", "work-browser", "stale-call");
  command(work, "takeover", "work-browser");
  await until(() => work.messages.some((m) => m.type === "media_ready"));
  await until(() => home.messages.some((m) => m.type === "audio_taken"));
  assert.equal(work.messages.filter((m) => m.type === "media_ready").length, 1);
  assert.equal(
    stranger.messages.some((m) => m.type === "media_ready"),
    false,
  );
  assert.equal(
    phone.messages.filter((m) => m.type === "media" && m.enabled).length,
    starts,
    "phone stream is reused",
  );
  await until(() => home.messages.some((m) => m.audioElsewhere));
  assert.equal(
    work.messages.filter((m) => m.type === "state").at(-1).audioHere,
    true,
  );

  const stale = Buffer.alloc(640, 1),
    fresh = Buffer.alloc(640, 2),
    down = Buffer.alloc(640, 3);
  command(home, "pause", "home-browser");
  command(home, "attach", "home-browser");
  home.send(stale);
  work.send(fresh);
  phone.send(down);
  await until(
    () =>
      phone.messages.some((m) => Buffer.isBuffer(m) && m.equals(fresh)) &&
      work.messages.some(Buffer.isBuffer),
  );
  assert.equal(
    phone.messages.some((m) => Buffer.isBuffer(m) && m.equals(stale)),
    false,
  );
  assert.equal(home.messages.some(Buffer.isBuffer), false);
  assert.equal(
    phone.messages.some((m) => m.action === "hangup"),
    false,
  );
  assert.equal(
    phone.messages.some((m) => m.type === "media" && m.recover),
    false,
    "old pause does not interrupt new owner",
  );

  work.close();
  await until(() =>
    phone.messages.some((m) => m.type === "media" && m.recover),
  );
  const oldNotices = home.messages.filter(
    (m) => m.type === "audio_taken",
  ).length;
  command(home, "attach", "home-browser");
  await until(
    () =>
      home.messages.filter((m) => m.type === "audio_taken").length > oldNotices,
  );
  const reload = await openBrowser();
  command(reload, "attach", "unrelated-browser");
  await until(() => reload.messages.some((m) => m.type === "audio_taken"));
  const reconnected = await openBrowser();
  command(reconnected, "attach", "work-browser");
  await until(() => reconnected.messages.some((m) => m.type === "media_ready"));
  reconnected.send(fresh);
  phone.send(down);
  await until(() => reconnected.messages.some(Buffer.isBuffer));

  // The former browser can explicitly take back ownership, but cannot do so automatically.
  command(home, "takeover", "home-browser");
  await until(
    () => home.messages.filter((m) => m.type === "media_ready").length === 2,
  );
  await until(() => reconnected.messages.some((m) => m.type === "audio_taken"));
  reconnected.close();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(
    home.messages.filter((m) => m.type === "state").at(-1).audioHere,
    true,
  );
  assert.equal(
    phone.messages.some((m) => m.action === "hangup"),
    false,
  );
});
