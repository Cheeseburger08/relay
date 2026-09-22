// 16 kHz mono PCM in both directions; the AudioContext resamples hardware input.
class RelayPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue=new Float32Array(4096); this.read=0; this.write=0; this.count=0; this.playing=false;
    this.packet=new Int16Array(320); this.used=0; this.muted=false; this.frames=0;
    this.micPeak=0; this.callerPeak=0;
    this.port.onmessage=({data})=>{
      if(data.type==='reset'){this.queue.fill(0);this.read=0;this.write=0;this.count=0;this.playing=false;this.packet.fill(0);this.used=0;return;}
      if(data.type==='mute'){this.muted=data.value;return;}
      if(data.type!=='pcm')return;
      const pcm=new Int16Array(data.buffer);
      // Stay near live speech after a scheduling/network burst. Never tear down
      // a working call just because old playback samples accumulated.
      if(pcm.length!==320)return;
      if(this.count+pcm.length>1600){const skip=Math.max(0,this.count-640);this.read=(this.read+skip)%4096;this.count-=skip;}
      for(const sample of pcm){this.queue[this.write]=sample/32768;this.write=(this.write+1)%4096;this.count++;}
    };
  }
  process(inputs,outputs){
    const input=inputs[0]?.[0],output=outputs[0][0];
    if(!this.playing&&this.count>=640)this.playing=true;
    for(let i=0;i<output.length;i++){
      const value=this.muted?0:Math.max(-.95,Math.min(.95,input?.[i]||0));
      this.micPeak=Math.max(this.micPeak,Math.abs(value));
      this.packet[this.used++]=Math.round(value*32767);
      if(this.used===320){const buffer=this.packet.buffer;this.port.postMessage({type:'mic',buffer,captureAt:typeof currentTime==='number'?currentTime:0},[buffer]);this.packet=new Int16Array(320);this.used=0;}
      if(this.playing&&this.count>0){output[i]=this.queue[this.read];this.queue[this.read]=0;this.read=(this.read+1)%4096;this.count--;}
      else{output[i]=0;this.playing=false;}
      this.callerPeak=Math.max(this.callerPeak,Math.abs(output[i]));
    }
    this.frames+=output.length;
    if(this.frames>=1600){this.port.postMessage({type:'levels',mic:this.micPeak,caller:this.callerPeak,queuedMs:this.count/16});this.frames=0;this.micPeak=0;this.callerPeak=0;}
    return true;
  }
}
registerProcessor('relay-pcm',RelayPcm);
