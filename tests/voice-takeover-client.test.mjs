import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceClient } from "../src/voice-client.js";

test("observer stays quiet, explicit takeover prepares microphone, displaced browser stays quiet", async (t) => {
  const saved = {
    window: globalThis.window,
    location: globalThis.location,
    WebSocket: globalThis.WebSocket,
    fetch: globalThis.fetch,
  };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    send(s) {
      this.sent.push(JSON.parse(s));
    }
    close() {
      this.readyState = 3;
    }
    message(m) {
      this.onmessage({ data: JSON.stringify(m) });
    }
  }
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.location = { origin: "https://relay.test" };
  globalThis.WebSocket = Socket;
  globalThis.fetch = async () => ({ ok: false });
  const client = new VoiceClient("test", () => {});
  t.after(() => {
    client.dispose();
    Object.assign(globalThis, saved);
  });
  const call = { id: "browser-handoff-1", state: "active" };
  client.ws.message({ type: "state", online: true, claimed: false, call });
  assert.equal(client.wantAudio, false);
  assert.equal(client.retryTimer, undefined);
  assert.equal(client.state.canStartAudio, true);
  let allow,
    stopped = 0,
    prepared = 0;
  client.prepareAudio = async () => {
    prepared++;
    await new Promise((r) => (allow = r));
    client.audio = {
      stream: { getTracks: () => [{ stop: () => stopped++ }] },
      node: { disconnect() {}, port: { postMessage() {} } },
      ctx: { close: async () => {} },
    };
    client.wantAudio = true;
    return true;
  };
  client.ws.message({
    type: "state",
    online: true,
    claimed: true,
    audioElsewhere: true,
    call,
  });
  const move = client.takeAudio();
  await client.takeAudio();
  assert.equal(prepared, 1);
  assert.equal(
    client.ws.sent.length,
    0,
    "permission/preparation precedes takeover",
  );
  allow();
  await move;
  assert.deepEqual(client.ws.sent[0], {
    type: "takeover",
    callId: call.id,
    clientId: client.clientId,
  });
  client.ws.message({ type: "media_ready" });
  assert.equal(client.audio.attached, true);
  client.ws.message({
    type: "audio_taken",
    callId: call.id,
    message: "Moved elsewhere",
  });
  assert.equal(stopped, 1);
  assert.equal(client.audio, null);
  assert.equal(client.wantAudio, false);
  assert.equal(client.state.canStartAudio, true);
  client.ws.message({ type: "state", online: true, claimed: false, call });
  assert.equal(client.wantAudio, false);
  assert.equal(client.retryTimer, null, "unclaimed state must not steal back");
  client.prepareAudio = async () => {
    throw Error("Microphone denied");
  };
  await client.takeAudio();
  assert.equal(client.ws.sent.length, 1);
  assert.equal(client.state.busy, false);
  assert.equal(client.state.canStartAudio, true);
  assert.match(client.state.message, /Microphone denied/);
});
