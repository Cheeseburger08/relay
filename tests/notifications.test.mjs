import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {smsNotification} from '../server/notification-content.mjs';
test('SMS and call push notifications route safely to their destination',async()=>{
 const handlers={},shown=[];let navigation,focused=false,pending;
 const self={location:{origin:'https://relay.example'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{matchAll:async()=>[{url:'https://relay.example/',navigate:async url=>navigation=url,focus:()=>focused=true}]}};
 vm.runInNewContext(readFileSync('public/voice-sw.js','utf8'),{self,URL,encodeURIComponent});
 const dispatch=async(name,event)=>{handlers[name]({...event,waitUntil:p=>pending=p});await pending;};
 await dispatch('push',{data:{json:()=>({type:'sms',title:'Test Sender · SIM 1',body:'The actual test SMS',conversationId:'synthetic-conversation'})}});
 assert.equal(shown[0].title,'Test Sender · SIM 1');
 assert.equal(shown[0].body,'The actual test SMS');
 assert.equal(shown[0].data.url,'/?view=messages&conversation=synthetic-conversation');
 await dispatch('notificationclick',{notification:{data:shown[0].data,close(){}}});
 assert.equal(navigation,'https://relay.example/?view=messages&conversation=synthetic-conversation');assert.ok(focused);
 await dispatch('push',{data:{json:()=>({type:'call',body:'Ringing'})}});
 assert.equal(shown[1].data.url,'/?view=calls');
 for(const notification of shown){
  assert.match(notification.icon,/^data:image\/png;base64,/, 'notification display must not fetch its icon over the network');
  assert.deepEqual(Buffer.from(notification.icon.split(',')[1],'base64'),readFileSync('public/icon-192.png'));
 }
 await dispatch('notificationclick',{notification:{data:{url:'https://evil.example'},close(){}}});
 assert.equal(navigation,'https://relay.example');
});

test('SMS notification preserves message text and bounds Unicode payload size',()=>{
 const sms={number:'+12025550123',text:'سلام 👋\nSee you at 5',sim:2,conversationId:'synthetic-conversation'};
 const value=smsNotification(sms,'Fixture contact');
 assert.equal(value.title,'Fixture contact · SIM 2');assert.equal(value.body,sms.text);
 assert.equal(smsNotification(sms).title,'+12025550123 · SIM 2');
 const long=smsNotification({...sms,text:'😀'.repeat(10000)},'😀'.repeat(200));
 assert.ok(Buffer.byteLength(JSON.stringify(long),'utf8')<3500);
 assert.ok(long.body.endsWith('…'));assert.equal(Array.from(long.body).length,500);
});
