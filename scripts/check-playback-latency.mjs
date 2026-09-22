// Read-only native playback timing. No audio samples, call IDs or numbers.
import { RawAdbShell } from './audio-lab/raw-adb.mjs';
const command = `su -c 'for pcm in 1 32; do
echo PCM:$pcm
cat /proc/asound/card0/pcm${'$'}{pcm}p/sub0/hw_params
cat /proc/asound/card0/pcm${'$'}{pcm}p/sub0/sw_params
i=0
while [ "$i" -lt 12 ]; do
cat /proc/asound/card0/pcm${'$'}{pcm}p/sub0/status
sleep 0.2
i=$((i+1))
done
done'`;
const child = new RawAdbShell(command);
let output='';
child.stdout.on('data',data=>{output+=data.toString();});
child.stderr.resume();child.stdin.on('error',()=>{});
child.on('error',()=>{process.exitCode=1;console.error('ADB timing inspection failed');});
const timeout=setTimeout(()=>child.socket.destroy(),15000);
child.on('close',code=>{
  clearTimeout(timeout);
  if(code!==0){process.exitCode=1;console.error('ADB timing inspection did not complete');return;}
  for(const block of output.split('PCM:').slice(1)){
    const pcm=Number(block.split('\n')[0]);
    const rate=Number(block.match(/^rate: (\d+)/m)?.[1]);
    const period=Number(block.match(/^period_size: (\d+)/m)?.[1]);
    const buffer=Number(block.match(/^buffer_size: (\d+)/m)?.[1]);
    const delays=[...block.matchAll(/^delay\s*:\s*(-?\d+)/gm)].map(m=>Number(m[1]));
    console.log(JSON.stringify({pcm,active:!!rate,...(rate?{rate,periodFrames:period,bufferFrames:buffer,bufferMs:buffer*1000/rate,observedDelayMs:delays.map(n=>Math.round(n*1000/rate))}:{})}));
  }
});
child.stdin.end();
