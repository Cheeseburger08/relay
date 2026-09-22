import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VoiceClient} from '../src/voice-client.js';

test('browser retains microphone and call on disconnect, retries audio and queues explicit end',async t=>{
 const originals={window:globalThis.window,location:globalThis.location,WebSocket:globalThis.WebSocket,fetch:globalThis.fetch};
 class Socket {static OPEN=1;readyState=1;sent=[];send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.();}message(m){this.onmessage({data:JSON.stringify(m)});}}
 globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.location={origin:'https://relay.test'};globalThis.WebSocket=Socket;globalThis.fetch=async()=>({ok:false});
 const client=new VoiceClient('test',()=>{});t.after(()=>{client.dispose();Object.assign(globalThis,originals);});
 let stopped=0,resets=0;
 client.audio={attached:true,requested:true,stream:{getTracks:()=>[{stop:()=>stopped++}]},node:{port:{postMessage:m=>{if(m.type==='reset')resets++;}},disconnect(){}},ctx:{close:async()=>{}}};client.wantAudio=true;
 const call={id:'synthetic-call',state:'active'};
 client.ws.message({type:'state',online:true,claimed:true,call,reconnectMs:0});
 client.ws.close();
 assert.equal(client.state.call.id,call.id);assert.equal(stopped,0);assert.equal(client.audio.attached,false);assert.ok(resets>0);assert.ok(client.state.reconnectSeconds>0);
 const deadline=client.recoveryDeadline;client.recovering(60000);assert.equal(client.recoveryDeadline,deadline);
 clearTimeout(client.reconnect);client.connect();client.ws.message({type:'state',online:true,claimed:false,call,reconnectMs:50000});
 await new Promise(r=>setTimeout(r,2100));assert.ok(client.ws.sent.some(m=>m.type==='attach'&&m.callId===call.id));
 client.ws.message({type:'media_ready'});client.ws.message({type:'state',online:true,claimed:true,call,reconnectMs:0});assert.equal(client.state.reconnectSeconds,0);
 // Repeated phone/media interruptions must retain the authorized microphone.
 const authorizedAudio=client.audio;const beforeRetries=client.ws.sent.filter(m=>m.type==='attach').length;
 for(let i=0;i<3;i++){
  client.ws.message({type:'state',online:true,claimed:false,call,reconnectMs:50000});
  client.ws.message({type:'recovering',remainingMs:50000,message:'Synthetic interruption'});
  await new Promise(r=>setTimeout(r,650));
  assert.equal(client.audio,authorizedAudio);assert.equal(stopped,0);assert.notEqual(client.state.needsAudioGesture,true);
  client.ws.message({type:'media_ready'});client.ws.message({type:'state',online:true,claimed:true,call,reconnectMs:0});
 }
 assert.equal(client.ws.sent.filter(m=>m.type==='attach').length,beforeRetries+3);
 // Unsupported browsers must not claim to have changed the hardware route.
 await client.openOutput();assert.equal(client.state.outputSupported,false);assert.equal(client.audio.attached,true);
 // Output changes are confirmed only after the browser accepts the sink.
 const sinks=[];client.audio.ctx.setSinkId=async id=>{if(id==='denied')throw Error('Denied');sinks.push(id);};
 await client.selectOutput('speaker','Built-in speaker');assert.deepEqual(sinks,['speaker']);assert.equal(client.state.outputLabel,'Built-in speaker');
 await client.selectOutput('denied','Unavailable');assert.equal(client.state.outputLabel,'Built-in speaker');assert.ok(client.state.outputError);assert.equal(client.audio.attached,true);
 client.mute();assert.equal(client.state.muted,true);
 const originalAudio=client.audio;
 client.prepareAudio=async()=>{client.audio={...originalAudio,attached:false,requested:false};return true;};
 client.rebuildAudio('Synthetic processor failure');assert.equal(client.wantAudio,true);assert.equal(client.state.muted,true);
 client.ws.message({type:'state',online:true,claimed:false,call,reconnectMs:50000});
 await new Promise(r=>setTimeout(r,650));assert.equal(client.audio.requested,true,'graph rebuilt and attached automatically');
 client.ws.close();client.end();assert.equal(client.pendingEnd,call.id);assert.equal(stopped,2);
 clearTimeout(client.reconnect);client.connect();client.ws.message({type:'state',online:true,claimed:false,call,reconnectMs:50000});assert.ok(client.ws.sent.some(m=>m.type==='hangup'));assert.equal(client.pendingEnd,null);
 assert.equal(client.wantAudio,false,'explicit end must not reconnect to the ending call');
});
