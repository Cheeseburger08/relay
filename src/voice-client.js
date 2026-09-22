import { CallAudioOutput } from "./audio-output.js";
export class VoiceClient {
  constructor(csrf, changed) {
    this.csrf=csrf;this.changed=changed;this.state={online:false,call:null,claimed:false,message:'',busy:false,muted:false,mic:0,caller:0,pushStatus:''};
    this.closed=false;this.audio=null;this.wantAudio=false;this.clientId=crypto.randomUUID();
    this.onPageHide=()=>this.disconnect();window.addEventListener('pagehide',this.onPageHide);
    this.onPageShow=()=>{if(!this.closed&&!this.ws)this.connect();};window.addEventListener('pageshow',this.onPageShow);
    this.connect();
    fetch('/api/voice').then(r=>r.ok?r.json():null).then(v=>{if(v)this.pushKey=v.pushKey;}).catch(()=>{});
  }
  update(value){this.state={...this.state,...value};if(!this.closed)this.changed(this.state);}
  send(value){if(this.ws?.readyState!==WebSocket.OPEN)throw Error('Call connection is offline.');this.ws.send(JSON.stringify(value));}
  pauseAudio(){if(this.audio){this.audio.attached=false;this.audio.requested=false;this.audio.received=false;this.audio.node?.port.postMessage({type:'reset'});}this.update({audioConnected:false,mic:0,caller:0});}
  recovering(ms=60000){
    const deadline=performance.now()+ms;
    this.recoveryDeadline=this.recoveryDeadline?Math.min(this.recoveryDeadline,deadline):deadline;
    clearInterval(this.recoveryTimer);
    const tick=()=>{const seconds=Math.max(0,Math.ceil((this.recoveryDeadline-performance.now())/1000));this.update({reconnectSeconds:seconds});if(!seconds){clearInterval(this.recoveryTimer);this.stopAudio();this.update({message:'Reconnection timed out. The phone will end the call.'});}};
    tick();this.recoveryTimer=setInterval(tick,1000);
  }
  clearRecovery(){clearInterval(this.recoveryTimer);this.recoveryDeadline=0;this.update({reconnectSeconds:0});}
  retryAudio(){
    if(this.retryTimer||!this.wantAudio||this.state.needsAudioGesture||this.closed||this.audio?.attached)return;
    this.retryTimer=setTimeout(async()=>{
      this.retryTimer=null;const c=this.state.call;
      if(!this.wantAudio||c?.state!=='active')return;
      if(!this.state.online||this.state.claimed||this.ws?.readyState!==WebSocket.OPEN){this.retryAudio();return;}
      try{
        if(!await this.prepareAudio())return;
        if(!this.wantAudio||this.state.call?.id!==c.id)return;
        if(!this.audio.requested){this.audio.requested=true;this.send({type:'attach',callId:c.id,clientId:this.clientId});}
      }catch(e){this.wantAudio=true;this.update({message:e.message||'Retrying call audio…',needsAudioGesture:e.name==='NotAllowedError'||e.name==='SecurityError'});}
      this.retryAudio();
    },500);
  }
  rebuildAudio(message){const muted=this.state.muted;this.stopAudio();this.wantAudio=true;this.update({muted});this.audioInterrupted(message);}
  audioInterrupted(message){this.pauseAudio();this.recovering();this.update({message});try{this.send({type:'pause',callId:this.state.call?.id});}catch{}this.retryAudio();}
  connect(){
    if(this.closed)return;
    const ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/api/voice/browser');this.ws=ws;ws.binaryType='arraybuffer';
    ws.onmessage=({data})=>{
      if(this.ws!==ws)return;
      if(typeof data!=='string'){
        if(this.audio?.attached){this.audio.node.port.postMessage({type:'pcm',buffer:data},[data]);if(!this.audio.received){this.audio.received=true;this.update({message:'Live audio connected.'});}}
        return;
      }
      const msg=JSON.parse(data);
      if(msg.type==='state'){
        const old=this.state.call,c=!msg.online&&!msg.call&&this.wantAudio?old:msg.call;
        if(this.audio?.attached&&(!msg.claimed||!msg.online||c?.state!=='active'))this.pauseAudio();
        if(!c||c.state==='ended'){this.clearRecovery();this.stopAudio();this.pendingEnd=null;}
        this.update({...msg,call:c,busy:false,canStartAudio:c?.state==='active'&&!this.wantAudio&&!this.audio});
        if(msg.reconnectMs>0&&this.wantAudio)this.recovering(msg.reconnectMs);else if(msg.claimed&&this.audio?.attached)this.clearRecovery();
        if(this.pendingEnd&&c?.id===this.pendingEnd){this.send({type:'hangup',callId:c.id});this.pendingEnd=null;}
        if(c?.id!==old?.id||c?.state!==old?.state)this.ringtone(c?.state==='ringing');
        if(c?.state==='active')this.retryAudio();
      }
      if(msg.type==='recovering'&&this.wantAudio){this.pauseAudio();this.recovering(msg.remainingMs);this.update({message:msg.message});this.retryAudio();}
      if(msg.type==='audio_taken'&&msg.callId===this.state.call?.id){this.clearRecovery();this.stopAudio();this.update({audioTaken:true,audioElsewhere:true,canStartAudio:true,busy:false,message:msg.message});}
      if(msg.type==='recovery_expired'){this.endedCallId=this.state.call?.id;this.clearRecovery();this.stopAudio();this.update({message:msg.message});}
      if(msg.type==='media_ready'&&this.audio){this.audio.attached=true;this.update({message:'Starting phone audio…',busy:false});}
      if(msg.type==='command_accepted'&&msg.action!=='dtmf')this.update({message:msg.action==='check'?'Phone confirmed: call controls and SIM selection are ready.':msg.action==='dial'?'Phone accepted the call request.':msg.action==='answer'?'Phone accepted the answer request.':'Phone accepted the end-call request.',busy:false});
      if(msg.type==='error'){if(!this.state.call||this.state.call.state==='ended')this.stopAudio();this.update({message:msg.message,busy:false});this.retryAudio();}
    };
    ws.onclose=()=>{if(this.ws!==ws)return;this.ws=null;this.pauseAudio();if(this.wantAudio&&this.state.call)this.recovering();this.ringtone(false);this.update({online:false,claimed:false,busy:false,message:'Call connection lost; reconnecting…'});if(!this.closed)this.reconnect=setTimeout(()=>this.connect(),3000);};
    ws.onerror=()=>{};
  }
  stopAudio(){clearTimeout(this.retryTimer);this.retryTimer=null;const old=this.audio;this.audio=null;this.wantAudio=false;if(old){old.output?.dispose();old.stream?.getTracks().forEach(t=>t.stop());old.node?.disconnect();old.ctx?.close().catch(()=>{});}this.update({muted:false,mic:0,caller:0,audioConnected:false,needsAudioGesture:false,outputOpen:false,outputId:'',outputLabel:'Device default',outputBusy:false,outputError:'',outputDevices:[],audioTaken:false,canStartAudio:false});}
  prepareAudio(){
    if(this.preparing)return this.preparing;
    const pending=this.createAudio();this.preparing=pending;
    return pending.finally(()=>{if(this.preparing===pending)this.preparing=null;});
  }
  async createAudio(){
    if(this.audio?.node)return true;
    const a={};this.audio=a;
    try{
      a.ctx=new AudioContext({sampleRate:16000,latencyHint:'interactive'});
      let timeout;try{await Promise.race([a.ctx.resume(),new Promise((_,reject)=>{timeout=setTimeout(()=>{const e=Error('Tap Enable microphone to allow browser call audio.');e.name='NotAllowedError';reject(e);},1500);})]);}finally{clearTimeout(timeout);}
      a.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(this.audio!==a){a.stream.getTracks().forEach(t=>t.stop());return false;}
      if(a.ctx.sampleRate!==16000)throw Error('This browser cannot open the required call audio format.');
      await a.ctx.audioWorklet.addModule('/voice-worklet.js');if(this.audio!==a)return false;
      a.node=new AudioWorkletNode(a.ctx,'relay-pcm',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
      a.node.port.postMessage({type:'mute',value:!!this.state.muted});
      a.gain=a.ctx.createGain();a.gain.gain.value=this.volume??0.7;
      a.source=a.ctx.createMediaStreamSource(a.stream);a.source.connect(a.node);a.node.connect(a.gain).connect(a.ctx.destination);
      a.node.port.onmessage=({data})=>{
        if(this.audio!==a)return;
        if(data.type==='mic'&&a.attached&&this.ws?.readyState===WebSocket.OPEN){if(a.ctx.currentTime-data.captureAt>.12||this.ws.bufferedAmount>6400)return;this.ws.send(data.buffer);}
        if(data.type==='levels')this.update({mic:data.mic,caller:data.caller,audioConnected:!!a.attached});
        if(data.type==='error')this.audioInterrupted(data.message);
      };
      a.node.onprocessorerror=()=>{if(this.audio===a)this.rebuildAudio('Restarting browser call audio…');};
      a.stream.getTracks().forEach(t=>t.onended=()=>{if(this.audio===a)this.rebuildAudio('Restoring microphone…');});
      a.ctx.onstatechange=()=>{if(this.audio===a&&a.ctx.state==='suspended'){a.ctx.resume().catch(()=>this.update({needsAudioGesture:true,message:'Tap Enable microphone to resume browser audio.'}));}};
      this.wantAudio=true;this.update({needsAudioGesture:false});return true;
    }catch(e){if(this.audio===a){const muted=this.state.muted;this.stopAudio();this.update({muted});}throw e;}
  }
  async answer(){
    const call=this.state.call;if(call?.state!=='ringing')return;
    this.update({busy:true,message:'Opening microphone…'});
    try{if(!await this.prepareAudio())return;if(this.state.call?.id!==call.id||this.state.call.state!=='ringing'){this.stopAudio();return;}this.send({type:'answer',callId:call.id});this.update({message:'Requesting answer…'});}catch(e){this.update({message:e.message||'Microphone permission is required.',busy:false});}
  }
  async dial(number,sim){
    if(this.state.busy)return;
    if(!/^\+[1-9]\d{6,14}$/.test(number)){this.update({message:'Enter an international number, including +.'});return;}
    this.update({busy:true,message:'Opening microphone…'});
    try{if(!await this.prepareAudio())return;this.send({type:'dial',number,sim});this.update({message:'Sending call request to phone…'});}catch(e){this.stopAudio();this.update({message:e.message,busy:false});}
  }
  async takeAudio(){
    const call=this.state.call;
    if(this.state.busy||!this.state.online||call?.state!=='active')return;
    this.update({busy:true,canStartAudio:false,needsAudioGesture:false,message:'Preparing audio on this browser...'});
    try{
      if(!await this.prepareAudio())return;
      if(this.state.call?.id!==call.id||this.state.call.state!=='active'){this.stopAudio();this.update({busy:false});return;}
      this.audio.requested=true;
      this.send({type:'takeover',callId:call.id,clientId:this.clientId});
    }catch(e){this.stopAudio();this.update({busy:false,canStartAudio:true,message:e.message||'Microphone permission is required to move the call.'});}
  }
  async attach(){this.wantAudio=true;this.update({needsAudioGesture:false});try{if(!await this.prepareAudio())return;const c=this.state.call;if(c?.state!=='active'){this.stopAudio();return;}this.audio.requested=true;this.send({type:'attach',callId:c.id,clientId:this.clientId});}catch(e){this.wantAudio=true;this.update({message:e.message,busy:false,needsAudioGesture:e.name==='NotAllowedError'||e.name==='SecurityError'});this.retryAudio();}}
  end(){this.endedCallId=this.state.call?.id;this.pendingEnd=this.endedCallId;try{this.send({type:'hangup',callId:this.pendingEnd});this.pendingEnd=null;this.update({message:'Requesting end of call…',busy:false});}catch{this.update({message:'End requested; waiting for the connection to return.',busy:false});}this.clearRecovery();this.stopAudio();}
  mute(){const muted=!this.state.muted;this.audio?.node?.port.postMessage({type:'mute',value:muted});this.update({muted});}
  dtmf(digit){const c=this.state.call;if(c?.state!=='active'||!this.state.online||!(/^[0-9*#]$/).test(digit))return;try{this.send({type:'dtmf',callId:c.id,digit});}catch(e){this.update({message:e.message});}}
  setVolume(value){this.volume=value;if(this.audio?.gain)this.audio.gain.gain.value=value;}
  async openOutput(){
    const a=this.audio;if(!a)return;
    if(this.state.outputOpen){this.update({outputOpen:false});return;}
    a.output??=new CallAudioOutput(a.ctx,a.gain);const supported=a.output.supported;
    this.update({outputOpen:true,outputSupported:supported,outputError:'',outputDevices:[],outputId:a.output.id});
    if(!supported)return;
    await this.refreshOutputs();
  }
  async refreshOutputs(){
    const a=this.audio;if(!a)return;
    try{const devices=await navigator.mediaDevices.enumerateDevices();if(this.audio!==a)return;this.update({outputDevices:devices.filter(d=>d.kind==='audiooutput'&&d.deviceId&&d.deviceId!=='default').map((d,i)=>({id:d.deviceId,label:d.label||`Audio output ${i+1}`}))});}
    catch{if(this.audio===a)this.update({outputError:'Available speakers could not be listed. Your current audio output is unchanged.'});}
  }
  async selectOutput(id,label){
    const a=this.audio;if(!a||this.state.outputBusy)return;a.output??=new CallAudioOutput(a.ctx,a.gain);if(!a.output.supported)return;
    this.update({outputBusy:true,outputError:''});
    try{const selected=await a.output.select(id);if(selected&&this.audio===a)this.update({outputId:id,outputLabel:label||'Device default',outputBusy:false});}
    catch{if(this.audio===a)this.update({outputBusy:false,outputError:'Could not switch audio output. Check device access and try again.'});}
  }
  async pickOutput(){
    const a=this.audio;if(!a||this.state.outputBusy||!navigator.mediaDevices.selectAudioOutput)return;a.output??=new CallAudioOutput(a.ctx,a.gain);if(!a.output.supported)return;
    try{const device=await navigator.mediaDevices.selectAudioOutput();if(this.audio!==a)return;await this.selectOutput(device.deviceId,device.label||'Selected speaker');if(this.audio!==a)return;this.update({outputDevices:[...(this.state.outputDevices||[]).filter(d=>d.id!==device.deviceId),{id:device.deviceId,label:device.label||'Selected speaker'}]});}
    catch(e){if(this.audio===a&&e.name!=='NotAllowedError')this.update({outputError:'Audio output selection is unavailable. Use your device’s audio controls.'});}
  }
  ringtone(enabled){clearInterval(this.ringTimer);if(!enabled||this.ringContext?.state!=='running')return;this.ringTimer=setInterval(()=>{const o=this.ringContext.createOscillator(),g=this.ringContext.createGain();o.frequency.value=660;g.gain.value=.025;o.connect(g).connect(this.ringContext.destination);o.start();o.stop(this.ringContext.currentTime+.18);},1400);}
  async enableNotifications(){
    try{
      this.ringContext??=new AudioContext();await this.ringContext.resume();
      if(!('PushManager'in window)||!('Notification'in window)||!this.pushKey)throw Error('Push is unavailable here. On iPhone, open Relay from the Home Screen.');
      if(await Notification.requestPermission()!=='granted')throw Error('Notification permission was not granted.');
      await navigator.serviceWorker.register('/voice-sw.js',{scope:'/'});const registration=await navigator.serviceWorker.ready;
      const key=Uint8Array.from(atob(this.pushKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      const r=await fetch('/api/voice/push',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:JSON.stringify(subscription)});
      if(!r.ok)throw Error('Notification subscription could not be saved.');
      this.update({pushStatus:'Call and SMS notifications enabled.'});
    }catch(e){this.update({pushStatus:e.message});}
  }
  disconnect(){clearTimeout(this.reconnect);this.clearRecovery();const ws=this.ws;this.ws=null;this.stopAudio();this.ringtone(false);ws?.close();}
  dispose(){this.closed=true;this.disconnect();this.ringContext?.close().catch(()=>{});window.removeEventListener('pagehide',this.onPageHide);window.removeEventListener('pageshow',this.onPageShow);}
}
