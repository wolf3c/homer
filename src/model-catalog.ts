import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync,constants,openSync,fstatSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonicalDir} from './files.js';
import {validReasoningEffort} from './model-config.js';

export type ModelCapabilities={inputModalities:('text'|'image')[];reasoningEfforts:string[];webSearch:boolean;toolSearch:boolean};
export function validateModelCapabilities(value:unknown,effort:string|null):ModelCapabilities{
 const invalid=():never=>{throw Error('invalid_model_capabilities');};
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==4||!['inputModalities','reasoningEfforts','webSearch','toolSearch'].every(k=>Object.hasOwn(v,k)))return invalid();
 if(!Array.isArray(v.inputModalities)||!v.inputModalities.includes('text')||v.inputModalities.some(m=>m!=='text'&&m!=='image')||new Set(v.inputModalities).size!==v.inputModalities.length)return invalid();
 if(!Array.isArray(v.reasoningEfforts)||v.reasoningEfforts.length>32||v.reasoningEfforts.some(e=>!validReasoningEffort(e))||new Set(v.reasoningEfforts).size!==v.reasoningEfforts.length||
  (effort===null?v.reasoningEfforts.length!==0:!v.reasoningEfforts.includes(effort))||typeof v.webSearch!=='boolean'||typeof v.toolSearch!=='boolean')return invalid();
 return {inputModalities:[...v.inputModalities],reasoningEfforts:[...v.reasoningEfforts],webSearch:v.webSearch,toolSearch:v.toolSearch} as ModelCapabilities;
}
export function materializeModelCatalog(runtime:string,catalog:unknown){
 canonicalDir(runtime);
 const directory=join(runtime,'model-catalogs');
 mkdirSync(directory,{mode:0o700,recursive:true});
 if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory()||(lstatSync(directory).mode&0o077)!==0)throw Error('invalid_model_catalog_directory');
 const content=JSON.stringify(catalog)+'\n',path=join(directory,'codex-0.171.0-alpha.7-'+createHash('sha256').update(content).digest('hex')+'.json');
 const read=()=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>65536||(stat.mode&0o077)!==0)throw Error('invalid_model_catalog_file');return readFileSync(fd,'utf8');}finally{closeSync(fd);}};
 try{if(read()===content)return path;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('invalid_model_catalog_file');}
 const temporary=join(directory,'.catalog-'+randomUUID());
 try{writeFileSync(temporary,content,{mode:0o600,flag:'wx'});renameSync(temporary,path);}finally{rmSync(temporary,{force:true});}
 if(read()!==content)throw Error('invalid_model_catalog_file');
 return path;
}
