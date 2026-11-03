// Local synthetic candidate only. No Homer service/config/database/account/model.
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const scratch=resolve('.codex/scratch/legacy-activity-reading-20261022');
process.env.HISTORY_FOLLOWUP_BUILD??=resolve(scratch,'candidate-web');
process.env.HOMER_SYNTHETIC_ROOT??=resolve(scratch,'preview-synthetic');
if(!existsSync(resolve(process.env.HISTORY_FOLLOWUP_BUILD,'index.html')))throw Error('candidate_bundle_missing: build the isolated candidate described in docs/2026-10-22-legacy-activity-reading-candidate.md');
const {legacyActivityFixture}=await import('../tests/legacy-activity-reading-browser-fixture.mjs');
const services=[];
try{
 for(const [mode,label] of [['all-old','旧调用（展开Worked查看）'],['mixed','具体活动与旧调用混合'],['risks','失败与待核实状态']]){
  const f=await legacyActivityFixture(mode);services.push(f);console.log(label+'：'+f.server.url);
 }
 console.log('仅隔离合成数据；Ctrl+C关闭这三个预览。');
 let closing=false;
 const close=async()=>{if(closing)return;closing=true;await Promise.all(services.map(f=>f.close()));};
 process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
}catch(error){await Promise.all(services.map(f=>f.close()));throw error;}
