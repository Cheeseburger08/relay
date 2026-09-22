// Synthetic byte/timing check only. Does not open an audio endpoint or record.
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RawAdbShell } from './audio-lab/raw-adb.mjs';
// Include the socket-to-pipe adapter required by Sony tinyplay.
const child=new RawAdbShell("su -c 'cat | cat'");
const frames=Array.from({length:51},()=>randomBytes(640));
const sent=[],latencies=[];let pending=Buffer.alloc(0),received=0,interval,exact=true,next=1;
const started=performance.now();
child.stdout.on('data',data=>{
  pending=Buffer.concat([pending,data]);
  while(pending.length>=640){
    exact=exact&&received<frames.length&&pending.subarray(0,640).equals(frames[received]);
    latencies.push(performance.now()-sent[received]);received++;pending=pending.subarray(640);
    if(received===1)interval=setInterval(()=>{
      sent[next]=performance.now();child.stdin.write(frames[next++]);
      if(next===frames.length){clearInterval(interval);child.stdin.end();}
    },20);
  }
});
child.stderr.resume();child.on('error',()=>{process.exitCode=1;console.error('USB transport check failed');});
child.stdin.on('error',()=>{});
const watchdog=setTimeout(()=>child.socket.destroy(),5000);
child.on('close',code=>{
  clearTimeout(watchdog);clearInterval(interval);const match=exact&&received===frames.length;
  const steady=latencies.slice(1).sort((a,b)=>a-b);
  console.log(JSON.stringify({exit:code,frames:received,exact:match,startupMs:Math.round(latencies[0]),medianRoundTripMs:Math.round(steady[Math.floor(steady.length/2)]),p95RoundTripMs:Math.round(steady[Math.floor(steady.length*.95)]),totalMs:Math.round(performance.now()-started)}));
  if(!match||code!==0)process.exitCode=1;
});
sent[0]=performance.now();child.stdin.write(frames[0]);
