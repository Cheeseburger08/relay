self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{if(event.data?.type==='relay-push-capabilities')event.ports?.[0]?.postMessage({testReceipts:true});});
self.addEventListener('push',event=>{
  let data={};try{data=event.data.json();}catch{}
  const sms=data.type==='sms',test=data.type==='test';
  const conversation=typeof data.conversationId==='string'&&/^[\w-]{8,80}$/.test(data.conversationId)?data.conversationId:null;
  const url=test?'/?view=settings':sms?'/?view=messages'+(conversation?'&conversation='+encodeURIComponent(conversation):''):'/?view=calls';
  event.waitUntil(self.registration.showNotification(test?'Relay notification test':sms?(typeof data.title==='string'?data.title.slice(0,160):'New Relay message'):'Incoming Relay call',{
    body:typeof data.body==='string'?data.body:'Open Relay to check the call.',
    icon:'/icon-192.png',tag:test?'relay-push-test':sms?'relay-sms-'+(conversation||'inbox'):'relay-call',renotify:true,
    data:{url},requireInteraction:!sms&&!test,
  }).then(async()=>{
    if(!test||typeof data.receipt!=='string'||!/^[\w-]{43}$/.test(data.receipt))return;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{await fetch('/api/voice/push/receipt',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt:data.receipt}),signal:controller.signal});}catch{}finally{clearTimeout(timeout);}
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
