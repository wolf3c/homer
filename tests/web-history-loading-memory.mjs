// Disk-backed synthetic owners in separate processes: do not confuse an
// in-memory fixture's entire database with allocations from a bounded read.
import {spawnSync} from 'node:child_process';
import {writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {historyFixture,syntheticRoot} from './web-history-loading-fixture.js';
import {WebHistoryPages} from '../src/web-history-pages.js';
const destination=resolve(syntheticRoot);
if(process.argv[2]){
 const total=Number(process.argv[2]);if(![1000,10000].includes(total))throw Error('synthetic_size_invalid');
 const directory=join(destination,'memory-'+total+'-'+process.pid);mkdirSync(directory,{recursive:true});
 const f=historyFixture(total,160,true,join(directory,'synthetic.sqlite'));
 const memory=()=>{global.gc?.();return process.memoryUsage();};
 try{
  const before=memory(),reader=new WebHistoryPages(f.history,f.processes,f.inputs),initialized=memory();
  for(let n=0;n<30;n++)reader.read('synthetic-history');
  const warm=memory(),tempStore=f.store.db.prepare('PRAGMA temp_store').get(),compile=f.store.db.prepare('PRAGMA compile_options').all().map(row=>Object.values(row)[0]).filter(value=>String(value).startsWith('TEMP_STORE'));
  console.log(JSON.stringify({total,before,initialized,warm,peakRssKiB:process.resourceUsage().maxRSS,initialization:reader.initialization,tempStore,compile}));
 }finally{f.close();rmSync(directory,{recursive:true,force:true});}
}else{
 const results=[];
 for(const total of [1000,10000]){
  const child=spawnSync(process.execPath,['--expose-gc','--import','tsx',fileURLToPath(import.meta.url),String(total)],{encoding:'utf8'});
  if(child.status!==0)throw Error('synthetic_memory_child_failed');results.push(JSON.parse(child.stdout));
 }
 writeFileSync(join(destination,'server-memory-observations.json'),JSON.stringify({seed:20261021,node:process.version,diskBacked:true,isolatedProcesses:true,results},null,2)+'\n');
}
