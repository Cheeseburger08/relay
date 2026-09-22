import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import vm from 'node:vm';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createLab } from '../scripts/audio-lab/server.mjs';
import { waveHeader } from '../scripts/audio-lab/adb-bridge.mjs';
import { shellPacket, RawAdbShell } from '../scripts/audio-lab/raw-adb.mjs';
import net from 'node:net';

async function unlock(lab) {
  const response=await fetch(`${lab.origin}/unlock`,{method:'POST',headers:{Origin:lab.origin},body:new URL(lab.launchUrl).hash.slice(1)});
  assert.equal(response.status,204);
  return response.headers.get('set-cookie').split(';')[0];
}
function connect(lab,cookie,origin=lab.origin){return new WebSocket(`${lab.origin.replace('http:','ws:')}/audio`,{headers:{Origin:origin,Cookie:cookie}});}
async function rejected(ws){return new Promise(resolve=>{ws.on('unexpected-response',(_req,res)=>{assert.equal(res.statusCode,403);res.resume();ws.terminate();resolve();});ws.on('error',()=>{});});}

test('local audio requires one-time access, exact origin and valid host',async()=>{
  let starts=0;const lab=await createLab({bridgeFactory:()=>{starts++;}});
  try{
    assert.equal((await fetch(`${lab.origin}/status`)).status,401);
    assert.equal(await new Promise(resolve=>{http.get(lab.origin,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});}),403);
    assert.equal((await fetch(`${lab.origin}/unlock`,{method:'POST',headers:{Origin:'https://evil.example'},body:new URL(lab.launchUrl).hash.slice(1)})).status,403);
    const cookie=await unlock(lab);
    assert.equal((await fetch(`${lab.origin}/unlock`,{method:'POST',headers:{Origin:lab.origin},body:new URL(lab.launchUrl).hash.slice(1)})).status,401);
    await rejected(connect(lab,'')); await rejected(connect(lab,cookie,'https://evil.example'));
    assert.equal(starts,0);
  }finally{await lab.close();}
});

test('PCM traverses both directions; duplicate clients rejected; disconnect releases bridge',async()=>{
  let callbacks,stops=0,received,onStopped;
  const stopped=new Promise(resolve=>{onStopped=resolve;});
  const lab=await createLab({bridgeFactory:(route,cb)=>{
    assert.equal(route,'second');callbacks=cb;queueMicrotask(cb.onReady);
    return {closed:Promise.resolve(),stop(){stops++;onStopped();},feed(pcm){received=Buffer.from(pcm);}};
  }});
  try{
    const cookie=await unlock(lab), ws=connect(lab,cookie);await once(ws,'open');
    const ready=once(ws,'message');ws.send(JSON.stringify({type:'start',route:'second'}));
    assert.equal(JSON.parse((await ready)[0]).type,'ready');
    await rejected(connect(lab,cookie));
    const pcm=Buffer.alloc(640,19);ws.send(pcm);
    const down=once(ws,'message');callbacks.onPcm(pcm);
    const [payload,binary]=await down;assert.equal(binary,true);assert.deepEqual(payload,pcm);
    await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(received,pcm);
    const closed=once(ws,'close');ws.close();await closed;await stopped;assert.equal(stops,1);
  }finally{await lab.close();}
});

test('invalid routes never open phone; malformed frames stop an active bridge',async()=>{
  let starts=0,stops=0;
  const lab=await createLab({bridgeFactory:(_route,cb)=>{starts++;queueMicrotask(cb.onReady);return{closed:Promise.resolve(),stop(){stops++;},feed(){}};}});
  try{
    const cookie=await unlock(lab);let ws=connect(lab,cookie);await once(ws,'open');
    let closed=once(ws,'close');ws.send(JSON.stringify({type:'start',route:'second; arbitrary'}));await closed;assert.equal(starts,0);
    ws=connect(lab,cookie);await once(ws,'open');const ready=once(ws,'message');ws.send(JSON.stringify({type:'start',route:'first'}));await ready;
    closed=once(ws,'close');ws.send(Buffer.alloc(3));await closed;assert.equal(stops,1);
  }finally{await lab.close();}
});

test('WAV format is mono signed PCM16 at 16 kHz with bounded duration',()=>{
  const wav=waveHeader();assert.equal(wav.length,44);assert.equal(wav.toString('ascii',0,4),'RIFF');
  assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(24),16000);
  assert.equal(wav.readUInt16LE(34),16);assert.equal(wav.readUInt32LE(40),3840000);
});

test('raw ADB preserves binary bytes, handles fragmented replies and explicitly closes stdin',async()=>{
  let eof=false;
  const server=net.createServer(socket=>{
    let phase=0,tail=Buffer.alloc(0);
    socket.on('data',data=>{
      tail=Buffer.concat([tail,data]);
      while(true){
        if(phase<2){
          if(tail.length<4)return;const n=parseInt(tail.subarray(0,4).toString(),16);if(tail.length<4+n)return;
          const request=tail.subarray(4,4+n).toString();tail=tail.subarray(4+n);
          assert.equal(request,phase===0?'host:transport-usb':'shell,v2,raw:synthetic-test');
          phase++;socket.write('OK');socket.write('AY');continue;
        }
        if(tail.length<5)return;const n=tail.readUInt32LE(1);if(tail.length<n+5)return;
        const id=tail[0],payload=Buffer.from(tail.subarray(5,5+n));tail=tail.subarray(5+n);
        if(id===0){const packet=shellPacket(1,payload);socket.write(packet.subarray(0,3));socket.write(packet.subarray(3));}
        if(id===4){eof=true;socket.end(shellPacket(3,Buffer.from([0])));return;}
      }
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const child=new RawAdbShell('synthetic-test',{port:server.address().port}),chunks=[];
    child.stdout.on('data',data=>chunks.push(data));child.stderr.resume();child.stdin.on('error',()=>{});
    const closed=once(child,'close');const input=Buffer.from(Array.from({length:4096},(_,i)=>i%256));
    child.stdin.end(input);assert.equal((await closed)[0],0);assert.deepEqual(Buffer.concat(chunks),input);assert.equal(eof,true);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('worklet packets microphone separately from caller playback, mutes and bounds queue',()=>{
  let Processor;const messages=[];
  const context=vm.createContext({AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},
    registerProcessor:(_name,cls)=>{Processor=cls;},Float32Array,Int16Array,Math});
  vm.runInContext(readFileSync(new URL('../scripts/audio-lab/worklet.js',import.meta.url),'utf8'),context);
  const p=new Processor(), output=new Float32Array(128);
  for(let n=0;n<5;n++)p.process([[new Float32Array(128).fill(.25)]],[[output]]);
  assert.ok(output.every(v=>v===0),'local microphone must never play through caller output');
  const packets=messages.filter(m=>m.type==='mic');assert.equal(packets.length,2);
  assert.equal(new Int16Array(packets[0].buffer)[0],8192);
  p.port.onmessage({data:{type:'mute',value:true}});
  p.port.onmessage({data:{type:'pcm',buffer:new Int16Array(640).fill(16384).buffer}});
  for(let n=0;n<5;n++)p.process([[new Float32Array(128).fill(.25)]],[[output]]);
  assert.equal(output[0],.5);assert.ok(new Int16Array(messages.filter(m=>m.type==='mic').at(-1).buffer).every(v=>v===0));
  p.port.onmessage({data:{type:'pcm',buffer:new Int16Array(3520).buffer}});
  assert.ok(messages.some(m=>m.type==='error'));assert.equal(p.count,0);
});

test('production call worklet catches up after bursts without disconnecting or unmuting',()=>{
 let Processor;const messages=[];
 const context=vm.createContext({AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(_n,c)=>Processor=c,Float32Array,Int16Array,Math});
 vm.runInContext(readFileSync(new URL('../public/voice-worklet.js',import.meta.url),'utf8'),context);
 const p=new Processor();p.port.onmessage({data:{type:'mute',value:true}});
 for(let i=0;i<50;i++)p.port.onmessage({data:{type:'pcm',buffer:new Int16Array(320).fill(i*100).buffer}});
 assert.ok(p.count<=1600);assert.equal(messages.some(m=>m.type==='error'),false);
 p.port.onmessage({data:{type:'reset'}});assert.equal(p.count,0);assert.equal(p.used,0);assert.equal(p.muted,true);
 const out=new Float32Array(128);for(let i=0;i<5;i++)p.process([[new Float32Array(128).fill(.8)]],[[out]]);
 assert.ok(new Int16Array(messages.find(m=>m.type==='mic').buffer).every(v=>v===0));
});
