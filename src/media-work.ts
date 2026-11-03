// Limits whole decode jobs, including temporary files and multi-process frame/ASR work.
// A cancelled waiter is removed immediately; active work owns its slot until cleanup completes.
export class MediaWorkQueue {
 private active=0;
 private waiting:{start:()=>void;cancel:()=>void}[]=[];
 constructor(private concurrency:number,private maxWaiting:number){
  if(!Number.isSafeInteger(concurrency)||concurrency<1||!Number.isSafeInteger(maxWaiting)||maxWaiting<0)throw Error('media_decode_queue_invalid');
 }
 run<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  if(signal?.aborted)return Promise.reject(Error('media_decode_cancelled'));
  if(this.active>=this.concurrency&&this.waiting.length>=this.maxWaiting)return Promise.reject(Error('media_decode_busy'));
  return new Promise<T>((resolve,reject)=>{
   const job={
    start:()=>{
     signal?.removeEventListener('abort',job.cancel);
     if(signal?.aborted){reject(Error('media_decode_cancelled'));this.drain();return;}
     this.active++;
     void (async()=>{try{resolve(await work());}catch(error){reject(error);}finally{this.active--;this.drain();}})();
    },
    cancel:()=>{
     const index=this.waiting.indexOf(job);if(index<0)return;
     this.waiting.splice(index,1);signal?.removeEventListener('abort',job.cancel);reject(Error('media_decode_cancelled'));
    },
   };
   if(this.active<this.concurrency)job.start();else{this.waiting.push(job);signal?.addEventListener('abort',job.cancel,{once:true});}
  });
 }
 private drain(){while(this.active<this.concurrency&&this.waiting.length)this.waiting.shift()!.start();}
}
