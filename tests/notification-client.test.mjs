import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VoiceClient} from '../src/voice-client.js';

test('notification lifecycle refreshes the worker and permission without changing opt-in',async t=>{
 const names=['window','document','navigator','location','WebSocket','fetch'];
 const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const windowHandlers={},documentHandlers={},requests=[];
 const permission={permission:'granted'};
 let updates=0,unsubscribes=0,enabled=true,statusReply;
 const subscription={endpoint:'https://fcm.googleapis.com/synthetic-only',unsubscribe:async()=>{unsubscribes++;}};
 const registration={update:async()=>{updates++;},pushManager:{getSubscription:async()=>subscription}};
 const document={visibilityState:'visible',addEventListener:(name,fn)=>documentHandlers[name]=fn,removeEventListener:name=>delete documentHandlers[name]};
 class Socket {static OPEN=1;readyState=1;close(){this.readyState=3;}}
 const mocks={
  window:{Notification:permission,addEventListener:(name,fn)=>windowHandlers[name]=fn,removeEventListener:name=>delete windowHandlers[name]},
  document,navigator:{serviceWorker:{getRegistration:async()=>registration}},
  location:{origin:'https://relay.test'},WebSocket:Socket,
  fetch:async(url,options)=>{
   if(url==='/api/voice')return {ok:false};
   requests.push({url,method:options.method});
   if(options.method==='DELETE'){enabled=false;return {ok:true};}
   return statusReply?statusReply():{ok:true,json:async()=>({enabled})};
  },
 };
 for(const name of names)Object.defineProperty(globalThis,name,{value:mocks[name],configurable:true,writable:true});
 const client=new VoiceClient('synthetic-csrf',()=>{});
 t.after(()=>{client.dispose();for(const [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 await client.notificationStatus();
 assert.equal(updates,1);assert.equal(client.state.pushEnabled,true);
 permission.permission='denied';
 await client.notificationStatus();
 assert.equal(client.state.pushEnabled,true,'server opt-in retains the Disable control even when permission is blocked');
 assert.match(client.state.pushStatus,/blocked/);
 const before=updates;
 windowHandlers.pageshow();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(updates,before+1);
 document.visibilityState='hidden';documentHandlers.visibilitychange();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(updates,before+1);
 document.visibilityState='visible';documentHandlers.visibilitychange();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(updates,before+2);
 assert.ok(requests.every(request=>request.url==='/api/voice/push/status'),'status refresh never registers a subscription');
 // A status response already in flight must not undo an explicit Disable.
 let resolveStatus;
 statusReply=()=>new Promise(resolve=>resolveStatus=resolve);
 const pending=client.notificationStatus();await new Promise(resolve=>setImmediate(resolve));
 await client.disableNotifications();
 resolveStatus({ok:true,json:async()=>({enabled:true})});await pending;
 assert.equal(unsubscribes,1);assert.equal(client.state.pushEnabled,false);
 assert.match(client.state.pushStatus,/disabled/);
 statusReply=null;permission.permission='granted';
 await client.notificationStatus();assert.equal(client.state.pushEnabled,false);
 assert.equal(requests.filter(request=>request.url==='/api/voice/push').length,1,'refresh never re-enables a disabled browser');
 client.dispose();assert.equal(documentHandlers.visibilitychange,undefined);assert.equal(windowHandlers.pageshow,undefined);
});
