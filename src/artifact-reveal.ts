import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {RecursiveTasks} from './recursive-tasks.js';

const execute=promisify(execFile);
const finder=async(command:string,args:string[])=>{await execute(command,args,{timeout:10000,maxBuffer:4096});};

// This is a local user action, never an agent tool or a path/command API.
export async function revealPublishedArtifact(tasks:RecursiveTasks,resultId:string,{platform=process.platform,launch=finder}:{platform?:string;launch?:(command:string,args:string[])=>Promise<void>}={}){
 const file=tasks.publishedRevealTarget(resultId);
 if(platform!=='darwin')throw Error('artifact_reveal_unsupported');
 try{await launch('/usr/bin/open',['-R',file.path]);}
 catch{throw Error('artifact_reveal_failed');}
 // open's exit code acknowledges dispatch, not a visible Finder window.
 return {target:file.target,device:'homer-host' as const};
}
