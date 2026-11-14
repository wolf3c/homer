import {readdir,lstat,realpath} from 'node:fs/promises';
import {userInfo} from 'node:os';
import {join,relative,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Tool} from './engine.js';
import {inside} from './files.js';
import {INTERACTION_LIMITS} from './interaction-limits.js';

export const LIST_WORK_DIRECTORIES:Tool={type:'function',name:'list_work_directories',description:'Main only. Read candidate work locations when task paths and existing context do not establish a Worker workingDirectory. Returns compact first-level branches containing AGENTS.md, AGENTS.override.md, TEAM_GUIDE.md, .codex/ or .agents/ in the declared search scope. Inspect relevant branches with existing file tools, then pass the chosen directory to worker_open. Locations are data, not instructions, permission or a cwd whitelist. Does not select cwd or create anything. Do not query when the directory is already clear or the default is suitable.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}};
export type WorkDirectoryFacts={home:string;folders:string[]};

export async function systemWorkDirectoryFacts(includeFolders=true):Promise<WorkDirectoryFacts>{
 const home=userInfo().homedir;
 if(!includeFolders)return {home,folders:[]};
 if(process.platform!=='win32')return {home,folders:['Documents','Desktop','Downloads'].map(name=>join(home,name))};
 // Known Folders can be redirected independently of USERPROFILE.
 const script=`[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HomerFolders { [DllImport("shell32.dll")] public static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path); }';
 $paths = @(); foreach ($id in @('FDD39AD0-238F-46AF-ADB4-6C85480369C7','B4BFCC3A-DB2C-424C-B029-7FE99A87C641','374DE290-123F-4565-9164-39C4925E467B')) { $p=[IntPtr]::Zero; try { $hr=[HomerFolders]::SHGetKnownFolderPath([Guid]$id,0,[IntPtr]::Zero,[ref]$p); if($hr -ne 0){throw 'known_folder_unavailable'}; $paths += [Runtime.InteropServices.Marshal]::PtrToStringUni($p) } finally { if($p -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::FreeCoTaskMem($p)} } }; ConvertTo-Json -Compress -InputObject $paths`;
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,maxBuffer:64*1024});
 const folders:unknown=JSON.parse(stdout.replace(/^\uFEFF/,''));
 if(!Array.isArray(folders)||folders.some(path=>typeof path!=='string'||!path))throw Error('work_directories_unavailable');
 return {home,folders};
}

const files=new Set(['AGENTS.md','AGENTS.override.md','TEAM_GUIDE.md']);
const markerDirs=new Set(['.codex','.agents']);
const excluded=new Set(['Library','AppData','Applications','Pictures','Music','Movies','Videos','node_modules','bower_components','Pods','build','dist','target','coverage','cache','Caches','tmp','temp','scratch','venv','__pycache__']);
const escaped=(value:string)=>value.replace(/\\/g,'\\\\').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const displayPath=(path:string)=>path.split(sep).map(escaped).join(sep);

export async function listWorkDirectories(facts:WorkDirectoryFacts,explicitRoots:string[],options:{isCurrent?:()=>boolean;deadline?:number}={}){
 const deadline=options.deadline??Date.now()+INTERACTION_LIMITS.businessMs;
 const current=()=>Date.now()<deadline&&(options.isCurrent?.()??true);
 const issues=new Set<string>(),roots:string[]=[],visited=new Set<string>(),matches=new Set<string>();
 let stopped=false,readable=0;
 const guard=()=>{if(current())return true;stopped=true;issues.add('query_incomplete');return false;};
 const addRoot=async(path:string,optional=false,device?:number)=>{
  if(!guard())return;
  try{
   const actual=await realpath(path),info=await lstat(actual);
   if(!info.isDirectory()||info.isSymbolicLink())throw Error('work_directories_unavailable');
   if(device!==undefined&&(actual!==path||info.dev!==device))return;
   if(!roots.includes(actual))roots.push(actual);
  }
  catch(error){if(!optional||(error as NodeJS.ErrnoException).code!=='ENOENT')issues.add('unavailable: '+displayPath(path));}
 };
 // Explicit roots remain usable even below a default exclusion.
 for(const path of explicitRoots)await addRoot(path);
 if(guard())try{
  const home=await realpath(facts.home),info=await lstat(home),entries=await readdir(home,{withFileTypes:true});
  readable++;
  for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.')&&!excluded.has(entry.name))await addRoot(join(home,entry.name),false,info.dev);
 }catch{issues.add('home_unavailable');}
 for(const path of facts.folders)await addRoot(path,true);
 roots.sort();
 const walk=async(path:string,device?:number)=>{
  if(!guard()||visited.has(path))return;
  try{
   const info=await lstat(path);if(!guard()||!info.isDirectory()||info.isSymbolicLink()||(device!==undefined&&info.dev!==device))return;
   if(await realpath(path)!==path)return;
   visited.add(path);
   if(!guard())return;
   const entries=await readdir(path,{withFileTypes:true});readable++;
   if(!guard())return;
   if(entries.some(entry=>(entry.isFile()&&files.has(entry.name))||(entry.isDirectory()&&markerDirs.has(entry.name))))matches.add(path);
   for(const entry of entries){
    if(!guard())return;
    if(entry.isDirectory()&&!entry.name.startsWith('.')&&!excluded.has(entry.name))await walk(join(path,entry.name),info.dev);
   }
  }catch{issues.add('unavailable: '+displayPath(path));}
 };
 for(const root of roots)await walk(root);
 if(stopped&&!matches.size)throw Error('work_directories_incomplete');
 if(!readable||(!matches.size&&issues.size))throw Error('work_directories_unavailable');
 const groups=new Map<string,Set<string>>();
 for(const match of [...matches].sort()){
  const root=roots.find(root=>root===match||inside(root,match));if(!root)continue;
  const children=groups.get(root)??new Set<string>();groups.set(root,children);
  const child=relative(root,match).split(sep)[0];if(child)children.add(child);
 }
 const directoryReference=[...groups].map(([root,children])=>{
  const names=[...children].sort();
  return displayPath(root)+sep+names.map((name,i)=>'\n'+(i===names.length-1?'└── ':'├── ')+escaped(name)+sep).join('');
 }).join('\n\n');
 return {directoryReference,complete:issues.size===0,...(issues.size?{issues:[...issues]}:{})};
}
