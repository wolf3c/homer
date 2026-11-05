import {webChatPost} from '../src/web-contract.js';
import {mobileCall} from './mobile-connection.js';
export async function mobileFetch(request:Request):Promise<Response>{
 const path=new URL(request.url).pathname,post=request.method==='POST'?webChatPost(path):undefined;
 try{
  request.signal.throwIfAborted();
  if(new URL(request.url).search)throw Error('query_not_supported');
  let op:string,input:unknown={},status=200,binary=false;
  if(post){op=post.op;status=post.status;binary=op==='media.preview';const value=await request.json();input=post.id?{id:post.id,input:value}:value;}
  else if(request.method==='POST'&&path==='/api/uploads'){
   const blob=await request.blob();if(blob.size>8*1024*1024)throw Error('web_upload_size_limit');
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(Error('web_upload_invalid'));reader.readAsDataURL(blob);});
   op='media.upload';status=201;input={threadId:request.headers.get('x-homer-thread'),requestId:request.headers.get('x-homer-request'),uploadId:request.headers.get('x-homer-upload'),filename:decodeURIComponent(request.headers.get('x-homer-filename')??''),data};
  }else if(request.method==='GET'){
   let match:RegExpMatchArray|null;
   if(path==='/api/history/state')op='history.state';
   else if(path==='/api/tasks')op='tasks.list';
   else if((match=path.match(/^\/api\/tasks\/([\w:-]+)\/execution\/([\w:-]+)(?:\/(before|calls)\/([A-Za-z0-9_-]+))?$/))){op=match[3]==='calls'?'tasks.call':'tasks.execution';input={taskId:match[1],runId:match[2],...(match[3]==='calls'?{callKey:match[4]}:{before:match[4]})};}
   else if((match=path.match(/^\/api\/tasks\/([\w:-]+)\/workers\/([\w:-]+)(?:\/(?:after\/(\d+)|messages\/([\w:-]+)\/(\d+)))?$/))){op='tasks.detail';input={id:match[1],workerId:match[2],...(match[3]!==undefined?{after:Number(match[3])}:{}),...(match[4]!==undefined?{messageId:match[4],offset:Number(match[5])}:{})};}
   else if((match=path.match(/^\/api\/tasks\/([\w:-]+)(?:\/(summary|progress|origin)(?:\/([\w:-]+))?)?$/))){op='tasks.'+(match[2]??'detail');input={id:match[1],messageId:match[3]};}
   else if((match=path.match(/^\/api\/media\/([\w:-]+)\/(asset-[a-f0-9-]{36})\/([1-9]\d{0,7})$/))){op='media.read';input={messageId:match[1],assetId:match[2],revision:Number(match[3])};binary=true;}
   else if((match=path.match(/^\/api\/files\/((?:run|result)-[\w-]+)(\/origin)?$/))){op=match[2]?'files.origin':'files.read';input={id:match[1]};binary=!match[2];}
   else throw Error('route_not_found');
  }else throw Error('route_not_found');
  request.signal.throwIfAborted();
  let cancelled:()=>void=()=>{};
  const value=await new Promise<any>((resolve,reject)=>{
   cancelled=()=>reject(request.signal.reason);request.signal.addEventListener('abort',cancelled,{once:true});
   void mobileCall(op,input).then(resolve,reject);
  }).finally(()=>request.signal.removeEventListener('abort',cancelled));
  if(binary){const bytes=value.data?Uint8Array.from(atob(value.data),(c:string)=>c.charCodeAt(0)):new TextEncoder().encode(value.content??'');return new Response(bytes,{headers:{'Content-Type':value.mime??'text/markdown; charset=utf-8','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(value.filename??'preview'),'X-Homer-Artifact-Hash':value.sha256??''}});}
  return Response.json(value??{},{status});
 }catch(error){if(request.signal.aborted)throw request.signal.reason;return Response.json({error:error instanceof Error?error.message:'mobile_request_failed'},{status:409});}
}
