import { test } from "node:test";
import assert from "node:assert/strict";
import { CallAudioOutput } from "../src/audio-output.js";

test("direct output selection keeps the existing Web Audio path", async () => {
  const context = {
    sinkId: "",
    async setSinkId(id) {
      this.sinkId = id;
    },
  };
  const output = new CallAudioOutput(context, null);
  assert.equal(output.supported, true);
  assert.equal(await output.select("headphones"), true);
  assert.equal(output.id, "headphones");
  output.dispose();
  assert.equal(await output.select("speaker"), false);
  assert.equal(output.id, "headphones");
});

test("Safari-style media output switches safely and restores direct playback", async (t) => {
  const saved = {
    document: globalThis.document,
    HTMLMediaElement: globalThis.HTMLMediaElement,
  };
  const elements = [];
  let waitForSink = null;
  class Element {
    sinkId = "";
    paused = true;
    setAttribute() {}
    async setSinkId(id) {
      if (id === "denied") throw Error("Permission denied");
      if (waitForSink) await waitForSink;
      this.sinkId = id;
    }
    async play() {
      if (this.sinkId === "autoplay-blocked") throw Error("Playback blocked");
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }
  globalThis.HTMLMediaElement = Element;
  globalThis.document = {
    createElement() {
      const element = new Element();
      elements.push(element);
      return element;
    },
  };
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete globalThis[key];
      else globalThis[key] = saved[key];
    }
  });
  const destinations = [];
  const context = {
    destination: {},
    createMediaStreamDestination() {
      const track = {
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      const destination = { track, stream: { getTracks: () => [track] } };
      destinations.push(destination);
      return destination;
    },
  };
  const connected = new Set([context.destination]);
  const gain = {
    connect: (node) => connected.add(node),
    disconnect: (node) => connected.delete(node),
  };
  const output = new CallAudioOutput(context, gain);
  assert.equal(output.supported, true);

  await assert.rejects(output.select("denied"));
  assert.deepEqual([...connected], [context.destination]);
  assert.equal(destinations[0].track.stopped, true);
  assert.equal(elements[0].srcObject, null);

  await output.select("earpiece");
  const first = output.current;
  assert.equal(output.id, "earpiece");
  assert.equal(first.element.muted, false);
  assert.equal(first.element.paused, false);
  assert.deepEqual([...connected], [first.destination]);

  await assert.rejects(output.select("autoplay-blocked"));
  assert.equal(output.current, first);
  assert.equal(output.id, "earpiece");
  assert.deepEqual([...connected], [first.destination]);
  assert.equal(first.element.paused, false);

  await output.select("speaker");
  assert.equal(first.element.srcObject, null);
  assert.equal(first.element.paused, true);
  assert.equal(first.destination.track.stopped, true);
  assert.equal(output.id, "speaker");
  assert.equal(connected.size, 1, "Only one audible route remains");

  const second = output.current;
  await output.select("");
  assert.deepEqual([...connected], [context.destination]);
  assert.equal(second.element.srcObject, null);
  assert.equal(output.id, "");

  let resume;
  waitForSink = new Promise((resolve) => {
    resume = resolve;
  });
  const pending = output.select("speaker");
  const candidate = output.pending;
  output.dispose();
  resume();
  assert.equal(await pending, false);
  assert.equal(candidate.element.srcObject, null);
  assert.equal(candidate.destination.track.stopped, true);
  assert.equal(
    output.current,
    null,
    "Ending a call prevents a late output switch",
  );
});
