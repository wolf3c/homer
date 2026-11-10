// Authorized call history, never telemetry. Only sanitized, bounded JSON leaves
// the execution boundary. Limits apply independently to input and output.
import {isProxy} from 'node:util/types';
import {isCuaTool} from './desktop-cua.js';
export const TOOL_CONTENT_LIMITS={bytes:32*1024,stringBytes:16*1024,depth:8,nodes:512} as const;
type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type ToolValue={state:'recorded'|'truncated';value:JsonValue;redacted?:true}|{state:'not-recorded'|'pending'|'hidden';reason?:'non-json'|'binary';redacted?:never};
export type ToolContent={input:ToolValue;output:ToolValue};
const omission='[…已省略：达到调用内容上限]';
const masked='[已遮蔽]';
// Match credential names, not substrings such as keyboard, monkey, tokenCount
// or an ordinary database key. Generic key is secret only in a credential map.
const secretName=(key:string,context:string)=>{
 const normalized=key.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase().replace(/[-.]/g,'_');
 return /^(?:authorization|proxy_authorization|cookie|set_cookie|password|passwd|pwd|secret|token|api_?key|access_?key|private_?key|secret_?key|encryption_?key|signing_?key|auth_?key|client_?secret|access_?token|refresh_?token|id_?token|session_?token|password_?hash)$/.test(normalized)
  || /(?:^|_)(?:password|passwd|secret|token|api_key|private_key|access_key|secret_key|encryption_key|signing_key|auth_key|password_hash)$/.test(normalized)
  || normalized==='key'&&/^(?:credentials?|auth|secrets?|headers|env)$/i.test(context);
};
function redact(text:string){
 return text
  .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi,'$1'+masked+'@')
  .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,masked)
  .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+={0,2}/gi,'$1 '+masked)
  .replace(/\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,masked)
  .replace(/((?:["']?\b(?:authorization|cookie|password|passwd|secret[_-]?key|private[_-]?key|encryption[_-]?key|signing[_-]?key|auth[_-]?key|password[_-]?hash|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;&}\]]+)/gi,'$1"'+masked+'"');
}
function prefixBytes(text:string,bytes:number){
 // Inspect at most the bounded prefix; Buffer never receives the whole output.
 let end=Math.min(text.length,bytes);while(end>0&&Buffer.byteLength(text.slice(0,end))>bytes)end=Math.floor(end*0.9);
 if(end>0&&/[\uD800-\uDBFF]/.test(text[end-1]!))end--;
 return text.slice(0,end);
}
export function captureToolValue(value:unknown):ToolValue{
 if(value===undefined)return {state:'not-recorded'};
 let budget=TOOL_CONTENT_LIMITS.bytes-256,nodes=0,truncated=false,redacted=false;
 const ancestors=new Set<object>();
 const spend=(value:JsonValue)=>{budget-=Buffer.byteLength(JSON.stringify(value));return value;};
 const omit=()=>{truncated=true;return omission;};
 const visit=(value:unknown,depth:number,context:string):JsonValue=>{
  if(++nodes>TOOL_CONTENT_LIMITS.nodes||depth>TOOL_CONTENT_LIMITS.depth||budget<128)return omit();
  if(value===null||typeof value==='boolean')return spend(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw Error();return spend(value);}
  if(typeof value==='string'){
   const cap=Math.min(TOOL_CONTENT_LIMITS.stringBytes,Math.max(0,budget-128));
   // Extra bounded lookahead avoids exposing the end of a credential at a cut.
   const inspected=value.slice(0,cap+1024),safe=redact(inspected);if(safe!==inspected)redacted=true;
   const prefixCap=Math.max(0,cap-Buffer.byteLength(JSON.stringify(omission))-4);
   if(prefixCap<2)return spend(omit());
   let result=prefixBytes(safe,prefixCap);
   while(Buffer.byteLength(JSON.stringify(result))>prefixCap)result=result.slice(0,Math.floor(result.length*0.8));
   if(result.length<safe.length||inspected.length<value.length){result+=omission;truncated=true;}
   return spend(result);
  }
  if(typeof value!=='object'||ancestors.has(value)||isProxy(value))throw Error();
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
  if(!array&&proto!==Object.prototype&&proto!==null)throw Error();
  ancestors.add(value);budget-=2;
  const result:JsonValue[]|{[key:string]:JsonValue}=array?[]:Object.create(null);
  // Own data descriptors only: no getters/toJSON, no inherited content.
  for(const key in value){
   if(!Object.hasOwn(value,key))continue;
   if(array&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)!==(result as JsonValue[]).length))throw Error();
   if(budget<256||nodes>=TOOL_CONTENT_LIMITS.nodes){if(array)(result as JsonValue[]).push(omit());else (result as {[key:string]:JsonValue})['…']=omit();break;}
   const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!('value' in descriptor))throw Error();
   if(!array&&key.length>256){(result as {[key:string]:JsonValue})['…']=omit();break;}
   const safeKey=redact(key);if(safeKey!==key)redacted=true;
   budget-=Buffer.byteLength(JSON.stringify(safeKey))+2;
   const child=secretName(key,context)?(redacted=true,visit(masked,depth+1,key)):visit(descriptor.value,depth+1,key);
   if(array)(result as JsonValue[]).push(child);else (result as {[key:string]:JsonValue})[safeKey]=child;
  }
  if(array&&(result as JsonValue[]).length!==value.length&&(result as JsonValue[]).at(-1)!==omission)throw Error();
  ancestors.delete(value);return result;
 };
 try{
  const sanitized=visit(value,0,''),json=JSON.stringify(sanitized);
  if(Buffer.byteLength(json)>TOOL_CONTENT_LIMITS.bytes)return {state:'truncated',value:omission,...(redacted?{redacted:true}:{})};
  return {state:truncated?'truncated':'recorded',value:JSON.parse(json) as JsonValue,...(redacted?{redacted:true}:{})};
 }
 catch{return {state:'hidden',reason:'non-json'};}
}
const pick=(item:Record<string,unknown>,keys:string[])=>{
 const present=keys.filter(key=>Object.hasOwn(item,key)&&item[key]!==undefined);
 return present.length?Object.fromEntries(present.map(key=>[key,item[key]])):undefined;
};
export function captureToolError(error:unknown):ToolValue{
 if(typeof error==='object'&&error!==null&&isProxy(error))return {state:'hidden',reason:'non-json'};
 if(error instanceof Error){const message=Object.getOwnPropertyDescriptor(error,'message');return message&&'value' in message?captureToolValue({error:message.value}):{state:'hidden',reason:'non-json'};}
 return captureToolValue({error});
}
// Fixed native ThreadItem protocol. No reasoning, raw image bytes or unrelated
// native metadata. A missing terminal field is not an invented empty result.
export function nativeToolContent(item:Record<string,unknown>,completed:boolean):ToolContent|undefined{
 let input:unknown,output:unknown;
 switch(item.type){
  case 'commandExecution':input=pick(item,['command','cwd']);output=Object.hasOwn(item,'aggregatedOutput')?{output:item.aggregatedOutput,...pick(item,['exitCode'])}:pick(item,['exitCode']);break;
  case 'mcpToolCall':
   if(item.server==='homer_interactions'&&(item.tool==='generate_image'||item.tool==='generate_video'||isCuaTool(item.tool)))break;
   input=item.arguments;output=item.error!=null?{...pick(item,['result']),error:item.error}:item.result;break;
  case 'dynamicToolCall':input=item.arguments;output=item.contentItems;break;
  case 'fileChange':input=pick(item,['changes']);break;
  case 'webSearch':input=pick(item,['query','action']);output=item.results;break;
  case 'imageView':input=pick(item,['path']);break;
  case 'imageGeneration':return {input:captureToolValue(pick(item,['revisedPrompt','transparentBackground'])),output:completed?(item.failure?captureToolValue(item.failure):{state:'hidden',reason:'binary'}):{state:'pending'}};
  default:return;
 }
 return {input:captureToolValue(input),output:completed?captureToolValue(output):{state:'pending'}};
}
