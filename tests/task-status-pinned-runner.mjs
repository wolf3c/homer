// Isolated, repeatable product UI acceptance. Requires an existing Playwright
// module and Chrome installation; does not install packages or start Homer.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pinned,{pinnedData,pinnedConnection,pinnedPerformance,pinnedOrdering} from './task-status-pinned.browser.mjs';
import flat from './task-status-flat.browser.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(root,process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/work-status-pinned-summary-20261024');
const cases=[['ordering',pinnedOrdering],['pinned',pinned],['data',pinnedData],['connection',pinnedConnection],['performance',pinnedPerformance],['flat',flat]];
const selected=process.argv.slice(2);
if(selected.some(name=>!cases.some(([key])=>key===name)))throw Error('unknown_task_status_case');
const {chromium}=await import(process.env.HOMER_PLAYWRIGHT_MODULE??'playwright-core');
await mkdir(destination,{recursive:true});
const server=spawn(process.execPath,['--import','tsx','tests/task-status-browser-fixture.mjs'],{
 cwd:root,env:{...process.env,HISTORY_FOLLOWUP_BUILD:process.env.HISTORY_FOLLOWUP_BUILD??resolve(destination,'web-build'),HOMER_SYNTHETIC_ROOT:resolve(destination,'synthetic-runtime')},stdio:['pipe','pipe','inherit'],
});
let browser,page;
const evidence={synthetic:true,results:[],blocked:[],writes:[],errors:[]};
try{
 const info=await new Promise((done,reject)=>{
  const timer=setTimeout(()=>reject(Error('synthetic_fixture_start_timeout')),15000);
  const lines=createInterface({input:server.stdout});
  lines.on('line',line=>{try{const value=JSON.parse(line);if(value.url){clearTimeout(timer);done(value);}}catch{}});
  server.once('error',error=>{clearTimeout(timer);reject(error);});
  server.once('exit',code=>{clearTimeout(timer);reject(Error('synthetic_fixture_exited: '+code));});
 });
 const origin=new URL(info.url).origin;
 if(new URL(origin).port==='4780')throw Error('production_port_forbidden');
 evidence.origin=origin;
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [name,fn]of cases.filter(([name])=>!selected.length||selected.includes(name))){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
  await context.route('**/*',route=>{
   const address=new URL(route.request().url()),method=route.request().method();
   if(address.origin!==origin){evidence.blocked.push(address.origin);return route.abort();}
   // These POST endpoints are bounded read-only queries in web-server.ts.
   const historyRead=method==='POST'&&['page','interactions','queue','process','resolve','receipts'].some(name=>address.pathname==='/api/history/'+name);
   if(method!=='GET'&&!historyRead){evidence.writes.push({path:address.pathname,method});return route.abort();}
   return route.continue();
  });
  await page.goto(info.url);console.log('START '+name);
  const result=await fn(page,{destination,publish:(action='publish')=>server.stdin.write(JSON.stringify({action})+'\n')});evidence.results.push({name,...result});
  console.log('PASS '+name+' '+(result.checksPassed??JSON.stringify(result)));await context.close();
 }
 if(evidence.blocked.length||evidence.writes.length)throw Error('unexpected_request');
}catch(error){
 evidence.errors.push(String(error.stack??error));
 if(page&&!page.isClosed()){
  console.error(await page.evaluate(()=>({active:document.activeElement?.outerHTML,panels:[...document.querySelectorAll('#task-status-panel')].map(el=>({role:el.getAttribute('role'),state:el.dataset.state}))})).catch(()=>({})));
  await page.screenshot({path:resolve(destination,'browser-failure.png')}).catch(()=>{});
  await writeFile(resolve(destination,'browser-failure.txt'),await page.locator('body').innerText().catch(()=>''));
 }
 console.error(error);process.exitCode=1;
}finally{
 try{await writeFile(resolve(destination,'browser-results.json'),JSON.stringify(evidence,null,2));}
 finally{try{await browser?.close();}finally{server.kill('SIGTERM');}}
}
