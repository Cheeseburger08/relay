self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data.json();}catch{}
  const sms=data.type==='sms';
  const conversation=typeof data.conversationId==='string'&&/^[\w-]{8,80}$/.test(data.conversationId)?data.conversationId:null;
  const url=sms?'/?view=messages'+(conversation?'&conversation='+encodeURIComponent(conversation):''):'/?view=calls';
  event.waitUntil(self.registration.showNotification(sms?(typeof data.title==='string'?data.title.slice(0,160):'New Relay message'):'Incoming Relay call',{
    body:typeof data.body==='string'?data.body:'Open Relay to check the call.',
    icon:'/icon-192.png',tag:sms?'relay-sms-'+(conversation||'inbox'):'relay-call',renotify:true,
    data:{url},requireInteraction:!sms,
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const candidate=new URL(event.notification.data?.url||'/',self.location.origin);
    const url=candidate.origin===self.location.origin?candidate.href:self.location.origin;
    for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}}
    return self.clients.openWindow(url);})());
});
