self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};try{data=event.data.json();}catch{}
  event.waitUntil(self.registration.showNotification('Incoming Relay call',{
    body:typeof data.body==='string'?data.body:'Open Relay to check the call.',
    icon:'/icon-192.png',tag:'relay-call',renotify:true,
    data:{url:'/?view=calls'},requireInteraction:true,
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.navigate('/?view=calls');return client.focus();}}
    return self.clients.openWindow('/?view=calls');})());
});
