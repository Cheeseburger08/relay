import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('SMS and call push notifications route safely to their destination',async()=>{
 const handlers={},shown=[];let navigation,focused=false,pending;
 const self={location:{origin:'https://relay.example'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{matchAll:async()=>[{url:'https://relay.example/',navigate:async url=>navigation=url,focus:()=>focused=true}]}};
 vm.runInNewContext(readFileSync('public/voice-sw.js','utf8'),{self,URL,encodeURIComponent});
 const dispatch=async(name,event)=>{handlers[name]({...event,waitUntil:p=>pending=p});await pending;};
 await dispatch('push',{data:{json:()=>({type:'sms',body:'New message',conversationId:'synthetic-conversation'})}});
 assert.equal(shown[0].title,'New Relay message');
 assert.equal(shown[0].data.url,'/?view=messages&conversation=synthetic-conversation');
 await dispatch('notificationclick',{notification:{data:shown[0].data,close(){}}});
 assert.equal(navigation,'https://relay.example/?view=messages&conversation=synthetic-conversation');assert.ok(focused);
 await dispatch('push',{data:{json:()=>({type:'call',body:'Ringing'})}});
 assert.equal(shown[1].data.url,'/?view=calls');
 await dispatch('notificationclick',{notification:{data:{url:'https://evil.example'},close(){}}});
 assert.equal(navigation,'https://relay.example');
});
