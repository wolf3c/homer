import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {appendFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadavg,availableParallelism} from 'node:os';

const tracePath=base=>join(base,'runtime','build-stage-timing.jsonl');
export const fixtureBuildEnvironment=base=>({...process.env,
 NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+import.meta.url].filter(Boolean).join(' '),
 HOMER_FIXTURE_BUILD_TRACE:tracePath(base),
});
export function fixtureBuildEvidence(base){
 try{return readFileSync(tracePath(base),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.event!=='start');}
 catch{return [{event:'trace_unavailable'}];}
}

// Only a synthetic fixture child receives this environment. Never log command
// arguments, output bodies or configuration; the compiler stage and exit suffice.
if(process.env.HOMER_FIXTURE_BUILD_TRACE){
 const original=childProcess.spawn;
 childProcess.spawn=function(bin,args=[]){
  const child=original.apply(this,arguments);
  const stage=args.some(x=>String(x).endsWith('/typescript/bin/tsc'))?'typescript':args.some(x=>String(x).endsWith('/vite/bin/vite.js'))?'vite':undefined;
  if(!stage)return child;
  const start=Date.now();
  const emit=event=>{try{appendFileSync(process.env.HOMER_FIXTURE_BUILD_TRACE,JSON.stringify({stage,pid:child.pid,at:Date.now(),elapsedMs:Date.now()-start,load:loadavg()[0],parallelism:availableParallelism(),...event})+'\n');}catch{}};
  emit({event:'start'});
  child.once('error',error=>emit({event:'error',code:error.code??'unknown'}));
  child.once('exit',(code,signal)=>emit({event:'exit',code,signal}));
  return child;
 };
 syncBuiltinESMExports();
}
