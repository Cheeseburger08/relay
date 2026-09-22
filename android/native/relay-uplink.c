/* Xperia F8332 / Android 8 arm64 only. ABI declarations match Bionic and
 * tinyalsa android-8.0.0_r1. No recording, networking or shell execution.
 * Raw 16kHz mono s16le stdin; never buffers speech as a file. */
typedef unsigned long usize;
typedef long isize;
extern isize read(int,void*,usize),write(int,const void*,usize);
extern int close(int),pipe(int*),ioctl(int,unsigned long,...),poll(void*,unsigned long,int);
extern int printf(const char*,...),fflush(void*),strcmp(const char*,const char*);
extern void *memset(void*,int,usize);
struct timespec {long sec,nsec;};
extern int clock_gettime(int,struct timespec*);
struct pollfd {int fd;short events,revents;};
struct pcm;
struct pcm_config {unsigned channels,rate,period_size,period_count,format;
 unsigned start_threshold,stop_threshold,silence_threshold,silence_size;int avail_min;};
extern struct pcm *pcm_open(unsigned,unsigned,unsigned,struct pcm_config*);
extern int pcm_is_ready(struct pcm*),pcm_write(struct pcm*,const void*,unsigned),pcm_close(struct pcm*);
extern unsigned pcm_get_buffer_size(struct pcm*);
extern const char *pcm_get_error(struct pcm*);
static long now_ms(void){struct timespec t;clock_gettime(1,&t);return t.sec*1000+t.nsec/1000000;}
static int exact(int fd,unsigned char *data,int bytes){
 int done=0;
 while(done<bytes){struct pollfd p={fd,1,0};if(poll(&p,1,5000)<=0)return -1;
  isize n=read(fd,data+done,bytes-done);if(n<=0)return done?-1:0;done+=(int)n;}
 return done;
}
/* Keep at most two queued packets after a burst. Whole-packet drops preserve
 * sample alignment and never consume a later partial packet. Only this process
 * reads stdin. No stdio buffering or second pipe between reader and pcm_write. */
static int next_frame(int fd,unsigned char *frame,unsigned *dropped,int *queued){
 int available=0;if(ioctl(fd,0x541b,&available)<0)return -1;
 *queued=available/960;
 int skip=available>3840?(available/960)-2:0;
 for(int i=0;i<skip;i++){if(exact(fd,frame,960)!=960)return -1;(*dropped)++;}
 return exact(fd,frame,960);
}
static int self_test(void){
 int fds[2];if(pipe(fds))return 10;unsigned char block[960],got[960];
 for(int i=0;i<8;i++){memset(block,i,960);if(write(fds[1],block,960)!=960)return 11;}
 unsigned dropped=0;int queued=0;
 if(next_frame(fds[0],got,&dropped,&queued)!=960||dropped!=6||queued!=8)return 12;
 for(int i=0;i<960;i++)if(got[i]!=6)return 13;
 if(next_frame(fds[0],got,&dropped,&queued)!=960||dropped!=6)return 14;
 for(int i=0;i<960;i++)if(got[i]!=7)return 15;
 close(fds[1]);if(next_frame(fds[0],got,&dropped,&queued)!=0)return 16;
 close(fds[0]);memset(got,0,960);memset(block,0,960);
 printf("Relay uplink self-test passed: stale packets dropped, order/alignment/EOF preserved\n");return 0;
}
/* Synthetic transport check through the real su/timeout stdin path; no PCM. */
static int stream_test(void){unsigned char frame[960];unsigned dropped=0,frames=0;int queued=0,n;
 while((n=next_frame(0,frame,&dropped,&queued))==960){frames++;memset(frame,0,960);}
 printf("Relay pipe check: frames=%u dropped=%u result=%d\n",frames,dropped,n);return n<0?20:0;
}
int main(int argc,char **argv,char **env){
 (void)env;if(argc==2&&!strcmp(argv[1],"--self-test"))return self_test();
 if(argc==2&&!strcmp(argv[1],"--stream-test"))return stream_test();
 if(argc!=2)return 2;
 unsigned device;if(!strcmp(argv[1],"first"))device=1;else if(!strcmp(argv[1],"second"))device=32;else return 2;
 struct pcm_config config={1,16000,240,2,0,0,0,0,0,0};
 struct pcm *pcm=pcm_open(0,device,0,&config);
 if(!pcm||!pcm_is_ready(pcm)){if(pcm)pcm_close(pcm);printf("Error playing: PCM unavailable\n");return 3;}
 if(pcm_get_buffer_size(pcm)!=480){pcm_close(pcm);printf("Error playing: unexpected buffer\n");return 4;}
 unsigned char frame[960];unsigned dropped=0,writes=0;int queued=0,maxQueue=0,result=0;long maxWrite=0,last=now_ms();
 printf("Relay uplink started: packet_ms=30 buffer_ms=30\n");fflush((void*)0);
 for(;;){int n=next_frame(0,frame,&dropped,&queued);if(!n)break;if(n!=960){result=5;break;}
  if(queued>maxQueue)maxQueue=queued;
  if(!writes){printf("Relay uplink first packet: bytes=%d queued_packets=%d\n",n,queued);fflush((void*)0);}
  long start=now_ms();int error=pcm_write(pcm,frame,960);long duration=now_ms()-start;
  memset(frame,0,960);if(error){printf("Error playing: PCM write result=%d detail=%s\n",error,pcm_get_error(pcm));fflush((void*)0);result=6;break;}writes++;if(writes==1){printf("Relay uplink first write: duration_ms=%ld\n",duration);fflush((void*)0);}if(duration>maxWrite)maxWrite=duration;
  if(now_ms()-last>=5000){printf("Relay uplink timing: max_pipe_packets=%d dropped_packets=%u max_write_ms=%ld\n",maxQueue,dropped,maxWrite);fflush((void*)0);maxQueue=0;maxWrite=0;last=now_ms();}
 }
 memset(frame,0,960);pcm_close(pcm);if(result)printf("Error playing: stream stopped (%d)\n",result);return result;
}
/* Bionic CRT entry for the fixed arm64 device. The linker initializes libc;
 * __libc_init performs normal application startup and exit handling. */
typedef void (*init_fn)(void);
struct structors {init_fn *preinit,*init,*fini;};
extern void __libc_init(void*,void*,int(*)(int,char**,char**),struct structors*) __attribute__((noreturn));
static init_fn empty_array[]={ (init_fn)-1,0 };
__attribute__((used,noreturn)) void relay_start(void *args){struct structors s={empty_array,empty_array,empty_array};__libc_init(args,0,main,&s);}
__attribute__((naked,noreturn)) void _start(void){__asm__("mov x0, sp\n b relay_start");}
