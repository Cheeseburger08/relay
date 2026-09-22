import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLab } from './audio-lab/server.mjs';
import { adbBridge } from './audio-lab/adb-bridge.mjs';

const [adb, privateUrlFile] = process.argv.slice(2);
if (!adb || !privateUrlFile) throw new Error('Usage: node scripts/start-audio-lab.mjs <adb.exe> <private launch URL file>');
const run = args => execFileSync(adb, ['-d', ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true });
run(['push', fileURLToPath(new URL('./xperia-live-uplink.sh', import.meta.url)), '/data/local/tmp/relay-live-uplink.sh']);
run(['shell', 'sh', '-n', '/data/local/tmp/relay-live-uplink.sh']);
const forward = Number(run(['forward', 'tcp:0', 'localabstract:relay-audio-lab']).trim());
if (!Number.isInteger(forward) || forward < 1 || forward > 65535) throw new Error('USB forwarding failed');
const lab = await createLab({ bridgeFactory: (route, cb) => adbBridge(adb, forward, route, cb) });
writeFileSync(privateUrlFile, lab.launchUrl, { mode: 0o600 });
console.log(`Relay local audio lab ready at ${lab.origin}. Private launch link saved outside source. No audio starts automatically.`);
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await lab.close();
  try { run(['forward', '--remove', `tcp:${forward}`]); } catch {}
}
process.on('SIGINT', close); process.on('SIGTERM', close);
