// Runs the exact package check without persisting assertion payloads, request
// bodies, prompts, source excerpts, credentials or raw child logs.
import {spawn} from 'node:child_process';import {writeFileSync,mkdirSync,existsSync,watch} from 'node:fs';import {resolve} from 'node:path';
const root=resolve('.codex/scratch/flexible-execution-review');mkdirSync(root,{recursive:true});
const command=process.argv.slice(2);const argv=command.length?command:['npm','run','check'];
let sharedDependencyTempEvents=0,dependencyWatcher;const temp=resolve('node_modules/.vite-temp');if(existsSync(temp))dependencyWatcher=watch(temp,{persistent:false},()=>{sharedDependencyTempEvents++;});
const child=spawn(argv[0],argv.slice(1),{env:process.env,stdio:['ignore','pipe','pipe']});
let buffer='',current='',failures=[],summary=[],stages=[];
const line=l=>{if(l.startsWith('# Subtest: '))current=l.slice(11);if(l.startsWith('not ok '))failures.push({test:current||l.replace(/^not ok \d+ - /,''),code:'failed'});if(/^  error:/.test(l)&&failures.length){const v=l.replace(/^  error: /,'');failures.at(-1).error=/^[a-zA-Z0-9_.' :/<>-]{1,200}$/.test(v)?v:'assertion_or_structured_error';}if(/^# (tests|pass|fail|cancelled|skipped|duration_ms) /.test(l))summary.push(l.slice(2));if(/^> homer|^> tsc|^> vite|^> tsx/.test(l))stages.push(l);if(/error TS\d+/.test(l))failures.push({test:'typecheck',code:l.split(': error ')[1]?.split(':')[0]??'typescript_error'});};
child.stdout.on('data',b=>{buffer+=b;let i;while((i=buffer.indexOf('\n'))>=0){line(buffer.slice(0,i));buffer=buffer.slice(i+1);}});child.stderr.resume();
child.on('error',()=>{process.exitCode=1;});child.on('exit',(code,signal)=>{dependencyWatcher?.close();const receipt={sharedDependencyTempEvents,command:argv.join(' '),at:new Date().toISOString(),exitCode:code,signal,stages,failures,summary};const filename=command.length?'focused-check-receipt.json':'package-check-receipt.json';writeFileSync(resolve(root,filename),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exitCode=code??1;});
