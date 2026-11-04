import {randomUUID} from 'node:crypto';

// Public ingestion configuration supplied for Homer; never use an MCP token here.
const ENDPOINT = 'https://tracemind.sandbox.galaxycloud.app/api/user-feedback';
const PROJECT_KEY = 'tm_proj_LK7HuFcjwOCMls_Ic1tuD6-DDQwbyN1U';

// shortcut: obvious sensitive text only; the Agent must review the summary before submission.
const sensitive = /\bbearer\s+\S+|\b(?:api[_-]?key|access[_-]?token|secret[_-]?token|authorization|cookie|set-cookie)\s*[:=]|sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s?#]+[^\s]*\?[^\s]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:raw\s+prompt|source\s+diff|code\s+diff|request\s+body|response\s+body|tool\s+arguments?|tool\s+results?)\b/i;

async function submit(){
 process.stdin.setEncoding('utf8');
 let text='';
 for await(const chunk of process.stdin){
  text+=chunk;
  if(Buffer.byteLength(text)>32768)throw Error('invalid_input');
 }
 let input;
 try{input=JSON.parse(text);}catch{throw Error('invalid_input');}
 if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(key=>!['title','body'].includes(key))||
  typeof input.title!=='string'||typeof input.body!=='string'||!input.title.trim()||!input.body.trim()||input.title.length>160||input.body.length>4000)throw Error('invalid_input');
 if(sensitive.test(input.title+'\n'+input.body))throw Error('sensitive_content');
 if(!ENDPOINT||!PROJECT_KEY.startsWith('tm_proj_'))throw Error('not_configured');
 let endpoint;
 try{endpoint=new URL(ENDPOINT);}catch{throw Error('not_configured');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/api/user-feedback')throw Error('not_configured');
 const payload={projectKey:PROJECT_KEY,sessionId:randomUUID(),platform:'server',source:{type:'server_app',key:'homer',label:'Homer'},path:'/feedback',
  message:{kind:'issue',title:input.title.trim(),body:input.body.trim()},occurredAt:new Date().toISOString()};
 let response,result;
 try{
  response=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(15000)});
 }catch{throw Error('delivery_unconfirmed');}
 if(!response.ok)throw Error(response.status<500?'submission_rejected':'delivery_unconfirmed');
 try{result=await response.json();}catch{throw Error('delivery_unconfirmed');}
 if(result?.ok===false)throw Error('submission_rejected');
 if(result?.ok!==true||typeof result.userFeedbackId!=='string'||!result.userFeedbackId.trim()||result.ignored===true)throw Error('delivery_unconfirmed');
 return {ok:true,userFeedbackId:result.userFeedbackId};
}

try{console.log(JSON.stringify(await submit()));}
catch(error){
 const known=['invalid_input','sensitive_content','not_configured','submission_rejected','delivery_unconfirmed'];
 console.log(JSON.stringify({ok:false,error:known.includes(error.message)?error.message:'delivery_unconfirmed'}));
 process.exitCode=1;
}
