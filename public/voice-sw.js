// Keep notification display independent of a network request for the icon.
const NOTIFICATION_ICON = 'data:image/png;base64,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';
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
    icon:NOTIFICATION_ICON,tag:test?'relay-push-test':sms?'relay-sms-'+(conversation||'inbox'):'relay-call',renotify:true,
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
