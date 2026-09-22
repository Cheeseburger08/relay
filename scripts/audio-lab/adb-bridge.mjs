import net from 'node:net';
import { RawAdbShell } from './raw-adb.mjs';

export function waveHeader(seconds = 120) {
  const b = Buffer.alloc(44), bytes = seconds * 16000 * 2;
  b.write('RIFF'); b.writeUInt32LE(bytes + 36, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}

export function adbBridge(adb, port, route, callbacks) {
  if (!['first', 'second'].includes(route)) throw new Error('Invalid route');
  let stopped = false, player, tail = Buffer.alloc(0), header = false, cleanResolve;
  let output = '', readBytes = 0;
  const closed = new Promise(resolve => { cleanResolve = resolve; });
  const phone = net.createConnection({ host: '127.0.0.1', port });
  phone.setNoDelay(true);
  const fail = reason => { stop(); callbacks.onEnd(reason); };
  const startup = setTimeout(() => fail('Enable the live browser test on the Xperia during a call.'), 8000);
  const stop = () => {
    if (stopped) return; stopped = true; clearTimeout(startup); phone.destroy();
    if (player) {
      player.stdin.end();
      // EOF normally releases tinyplay immediately; its phone-side timeout remains
      // authoritative if a driver blocks. Never launch another session meanwhile.
    } else cleanResolve();
    tail.fill(0); tail = Buffer.alloc(0);
  };
  phone.on('connect', () => phone.write('GO16'));
  phone.on('error', () => fail('Phone stream unavailable. Enable the visible live test first.'));
  phone.on('close', () => { if (!stopped) fail('Phone stopped the stream or the call ended.'); });
  phone.on('data', data => {
    if (stopped) return;
    tail = Buffer.concat([tail, data]);
    if (!header) {
      if (tail.length < 4) return;
      if (tail.subarray(0, 4).toString() !== 'RLY1') return fail('Unexpected phone stream.');
      header = true; tail = tail.subarray(4); clearTimeout(startup);
      player = new RawAdbShell(`su -c 'sh /data/local/tmp/relay-live-uplink.sh ${route}'`);
      player.stdin.on('error', () => fail('Phone playback pipe closed.'));
      const inspect = chunk => {
        output = (output + chunk.toString()).slice(-2048);
        if (/Error playing|Unable to|No active call|Playback busy|Mixer busy/i.test(output)) fail('Phone rejected or stopped live playback.');
      };
      player.stdout.on('data', inspect); player.stderr.on('data', inspect);
      player.on('error', () => { cleanResolve(); fail('Could not start local phone playback.'); });
      player.on('close', code => {
        cleanResolve();
        if (!stopped) fail(code === 0 ? 'Phone playback ended.' : 'Phone playback failed.');
        console.log('Live playback process closed; mixer cleanup must be verified on the device.');
      });
      player.stdin.write(waveHeader());
      callbacks.onReady();
    }
    while (tail.length >= 640 && !stopped) {
      readBytes += 640;
      if (readBytes > 120 * 32000 + 640) return fail('Phone stream exceeded the test limit.');
      callbacks.onPcm(Buffer.from(tail.subarray(0, 640))); tail = tail.subarray(640);
    }
  });
  return { closed, stop, feed(pcm) {
    if (stopped || !player) return;
    if (player.stdin.writableLength > 6400) return fail('Phone playback fell behind.');
    player.stdin.write(pcm);
  } };
}
