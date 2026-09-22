import net from 'node:net';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

export function shellPacket(id,data=Buffer.alloc(0)) {
  const frame=Buffer.alloc(5+data.length);frame[0]=id;frame.writeUInt32LE(data.length,1);data.copy(frame,5);return frame;
}

// Internal local ADB client. Browser callers cannot provide commands or addresses.
// Uses shell-v2 raw packets to bypass Windows CLI text-mode conversion/buffering.
export class RawAdbShell extends EventEmitter {
  constructor(command,{port=5037}={}) {
    super();this.stdout=new PassThrough();this.stderr=new PassThrough();
    let phase=0,tail=Buffer.alloc(0),waiting,done=false,exitCode=null;
    const socket=net.createConnection({host:'127.0.0.1',port});socket.setNoDelay(true);
    this.socket=socket;
    const request=text=>{const body=Buffer.from(text);socket.write(Buffer.concat([Buffer.from(body.length.toString(16).padStart(4,'0')),body]));};
    const timeout=setTimeout(()=>socket.destroy(new Error('ADB handshake timed out')),8000);
    const write=(id,data,callback)=>{
      if(done){callback(new Error('ADB stream closed'));return;}
      const perform=()=>socket.write(shellPacket(id,data),callback);
      if(phase===2)perform();else waiting=perform;
    };
    this.stdin=new Writable({highWaterMark:6400,
      write:(data,_encoding,callback)=>write(0,data,callback),
      final:callback=>write(4,Buffer.alloc(0),callback),
    });
    socket.on('connect',()=>request('host:transport-usb'));
    socket.on('error',()=>this.emit('error',new Error('Local ADB transport failed')));
    socket.on('close',()=>{
      done=true;clearTimeout(timeout);this.stdin.destroy();this.stdout.end();this.stderr.end();this.emit('close',exitCode);
    });
    socket.on('data',chunk=>{
      tail=Buffer.concat([tail,chunk]);
      while(!done){
        if(phase<2){
          if(tail.length<4)return;
          const status=tail.subarray(0,4).toString();tail=tail.subarray(4);
          if(status!=='OKAY'){socket.destroy(new Error('ADB request rejected'));return;}
          if(phase===0){phase=1;request(`shell,v2,raw:${command}`);}
          else{phase=2;clearTimeout(timeout);const resume=waiting;waiting=null;resume?.();}
          continue;
        }
        if(tail.length<5)return;
        const id=tail[0],length=tail.readUInt32LE(1);
        if(length>65536){socket.destroy(new Error('Oversized ADB packet'));return;}
        if(tail.length<length+5)return;
        const data=Buffer.from(tail.subarray(5,5+length));tail=tail.subarray(5+length);
        if(id===1)this.stdout.write(data);
        else if(id===2)this.stderr.write(data);
        else if(id===3){exitCode=data.length?data[0]:null;done=true;socket.end();return;}
        else{socket.destroy(new Error('Unexpected ADB channel'));return;}
      }
    });
  }
}
