import { spawn } from 'node:child_process';
import { createWriteStream, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

const [adb, destination] = process.argv.slice(2);
if (!adb || !destination) throw new Error('Usage: node scripts/pull-phone-backup.mjs <adb.exe> <private-destination>');
const directory = resolve(destination);
const sha = (value) => createHash('sha256').update(value).digest('hex');
async function pull(name) {
  const child = spawn(resolve(adb), ['-d', 'exec-out', 'run-as', 'app.relay.localbackup', 'cat', 'files/' + name], { windowsHide: true });
  // Never print child output: stdout is private backup data, stderr is untrusted.
  child.stderr.resume();
  const done = new Promise((accept, reject) => {
    child.once('error', () => reject(new Error('ADB could not start')));
    child.once('close', (code) => code === 0 ? accept() : reject(new Error('ADB transfer failed')));
  });
  await Promise.all([pipeline(child.stdout, createWriteStream(join(directory, name), { flags: 'wx', mode: 0o600 })), done]);
}
for (const name of ['manifest.json', 'sms.json', 'calls.json']) await pull(name);
const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const verification = { verifiedAt: new Date().toISOString(), transferHashesMatch: true, providerIdsMatch: true, sets: {} };
for (const name of ['sms', 'calls']) {
  const bytes = readFileSync(join(directory, name + '.json'));
  if (sha(bytes) !== manifest[name].sha256 || bytes.length !== manifest[name].bytes) throw new Error('Backup transfer hash/length mismatch');
  const data = JSON.parse(bytes);
  if (data.rows.length !== manifest[name].count || data.rows.length !== manifest[name].sourceCountAfter) throw new Error('Provider count changed during backup; take another snapshot');
  const ids = data.rows.map((row) => {
    if (!Number.isSafeInteger(row._id)) throw new Error('Provider ID cannot be verified safely');
    return row._id + '\n';
  }).join('');
  if (new Set(data.rows.map((row) => row._id)).size !== data.rows.length || sha(ids) !== manifest[name].sourceIdsSha256) throw new Error('Provider ID verification failed');
  for (const row of data.rows) if (Object.keys(row).length !== data.columns.length || !data.columns.every((key) => Object.hasOwn(row,key))) throw new Error('Missing provider fields');
  verification.sets[name] = { count: data.rows.length, bytes: bytes.length, sha256: sha(bytes), columnCount: data.columns.length };
}
writeFileSync(join(directory,'verification.json'),JSON.stringify(verification,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({smsCount:verification.sets.sms.count,callCount:verification.sets.calls.count,transferHashesMatch:true,providerIdsMatch:true}));
