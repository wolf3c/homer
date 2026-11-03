// Shared in-flight snapshots only. Durable facts stay in the service/store.
// No timer reads the DB unless a change remains unpublished and a page exists.
export class StatePublication<T> {
  private revision=0;
  private epoch=0;
  private dirty=true;
  private closed=false;
  private timer?:ReturnType<typeof setTimeout>;
  private inFlight?:Promise<T>;
  private publishing?:Promise<void>;
  private failures=0;
  private completedRevision=-1;
  private completedEpoch=-1;
  constructor(private build:()=>Promise<T>,private deliver:(value:T)=>void,private unavailable:()=>void,private connected:()=>boolean,private windowMs=150){}
  invalidate(){this.revision++;this.dirty=true;this.schedule();}
  reset(){this.epoch++;this.invalidate();}
  private schedule(delay=this.windowMs){
    if(this.closed||this.timer||!this.connected()||!this.dirty||this.publishing)return;
    this.timer=setTimeout(()=>{this.timer=undefined;void this.flush();},delay);this.timer.unref?.();
  }
  read():Promise<T>{
    if(this.closed)return Promise.reject(Error('web_server_closed'));
    if(this.inFlight)return this.inFlight;
    const work=(async()=>{
      for(;;){
        const revision=this.revision,epoch=this.epoch;
        try{
          const value=await this.build();
          if(this.closed)throw Error('web_server_closed');
          // A complete point-in-time snapshot is useful even if more facts
          // arrived while building. flush keeps dirty and publishes again.
          if(epoch===this.epoch){this.completedRevision=revision;this.completedEpoch=epoch;return value;}
        }catch(error){if(epoch===this.epoch)throw error;}
        if(this.closed)throw Error('web_server_closed');
      }
    })();
    this.inFlight=work;
    void work.finally(()=>{if(this.inFlight===work)this.inFlight=undefined;}).catch(()=>{});
    return work;
  }
  // Used for SSE initial snapshots, GET and invalidation publication alike.
  async flush():Promise<void>{
    if(this.publishing)return this.publishing;
    if(this.closed||!this.connected()||!this.dirty)return;
    const work=(async()=>{
      try{
        const value=await this.read();
        if(this.closed||this.completedEpoch!==this.epoch)return;
        this.deliver(value);this.failures=0;
        // A change during construction/read/delivery always schedules another
        // publication. Even a synchronous listener cannot lose the last fact.
        if(this.completedRevision===this.revision)this.dirty=false;
      }catch{this.failures++;if(!this.closed)this.unavailable();}
    })();
    this.publishing=work;
    try{await work;}finally{this.publishing=undefined;this.schedule(this.failures?Math.min(5000,250*2**Math.min(this.failures,5)):this.windowMs);}
  }
  // The transport has written its initial snapshot. An update may have arrived
  // before the first client joined, when connected() could not schedule it.
  afterInitialDelivery(){if(this.completedEpoch!==this.epoch||this.completedRevision!==this.revision)this.schedule();}
  connect(){this.dirty=true;return this.flush();}
  close(){this.closed=true;if(this.timer)clearTimeout(this.timer);}
}
