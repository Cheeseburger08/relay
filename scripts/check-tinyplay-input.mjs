// Device regression check: invalid header must reach WAV parsing, not audio setup.
// No call, mixer changes, recording, or valid audio payload.
import assert from 'node:assert/strict';
import { RawAdbShell } from './audio-lab/raw-adb.mjs';
const child=new RawAdbShell(`su -c 'timeout -k 1 5 sh -c "cat | tinyplay /proc/self/fd/0"'`);
let output='';
child.stdout.on('data',data=>{output+=data.toString();});
child.stderr.on('data',data=>{output+=data.toString();});
child.stdin.on('error',()=>{});
child.on('error',()=>{process.exitCode=1;console.error('Parser transport failed');});
const timeout=setTimeout(()=>child.socket.destroy(),7000);
child.on('close',code=>{
  clearTimeout(timeout);
  try {
    assert.equal(code,1);
    assert.match(output,/not a riff\/wave file/);
    assert.doesNotMatch(output,/Unable to open/);
    console.log('PASS: Sony player opened the adapted pipe and rejected the invalid WAV before audio setup.');
  } catch { process.exitCode=1;console.error('FAIL: Sony player pipe/parser check. No valid audio supplied.'); }
});
child.stdin.end(Buffer.alloc(44));
