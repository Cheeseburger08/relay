// Local operator only: arm during a consenting call, then use the visible probe.
// Watches metadata only and sends a fixed synthetic tone; no recorded media.
import { spawn, execFileSync, execFile } from 'node:child_process';

const [adb, route] = process.argv.slice(2);
if (!adb || !['first', 'second'].includes(route)) {
  throw new Error('Usage: node scripts/watch-duplex-trial.mjs <adb.exe> first|second');
}
const filter = ['-v', 'epoch', '-s', 'RelayAudioProbe:I', '*:S'];
const old = new Set(execFileSync(adb, ['-d', 'shell', 'logcat', '-d', ...filter],
  { encoding: 'utf8', timeout: 10000 }).split(/\r?\n/));
const watcher = spawn(adb, ['-d', 'shell', 'logcat', '-T', '1', ...filter],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
let pending = '', triggered = false;
const timer = setTimeout(() => {
  console.log('No new visible duplex test within 60 seconds; no tone sent.');
  watcher.kill();
}, 60000);
watcher.on('error', () => {
  clearTimeout(timer); process.exitCode = 1;
  console.error('ADB metadata watcher failed; no tone sent.');
});
watcher.on('exit', () => clearTimeout(timer));
watcher.stdout.on('data', chunk => {
  pending += chunk.toString();
  const lines = pending.split(/\r?\n/); pending = lines.pop();
  for (const line of lines) {
    if (triggered || old.has(line) || !line.includes('duplex: Capture started; duration 10000 ms.')) continue;
    triggered = true; clearTimeout(timer); watcher.kill();
    console.log('Fresh visible duplex capture started; sending three quiet pulses.');
    // Route is allowlisted above. No user text enters the root command.
    execFile(adb, ['-d', 'shell', `su -c 'sh /data/local/tmp/relay-uplink-trial.sh ${route}'`],
      { encoding: 'utf8', timeout: 10000, windowsHide: true }, (error, stdout) => {
        for (const result of stdout.split(/\r?\n/)) {
          if (/^(Testing dedicated|Playing sample|Playback process exit|Injection mixer restored|Incall_Music)/.test(result)) console.log(result);
        }
        if (error) { console.error('Trial did not complete cleanly; inspect mixer cleanup.'); process.exitCode = 1; }
        console.log('Read final probe metadata and ask the caller about beeps and normal conversation.');
      });
  }
});
console.log('Armed for 60 seconds. Tap 3. Duplex, then Run test on the Xperia.');
