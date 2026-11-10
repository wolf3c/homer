// Isolated browser fixture: static built UI + in-memory HTTP/SSE only. No product backend imports.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
export async function composerFixture({webDir,beforeDir,branding,resource,interaction,historyPage}) {
 const streams=new Set(),received={messages:[],uploads:[],stops:[],discards:[],denied:[]};
 let state,mode={},held=[],revision=0;
 const task={id:"synthetic-task",headVersion:1,revision:1,goal:"核对合成材料",notes:"",state:"open",outcome:null,controlState:"normal",historyState:"visible",workers:[],sourceRequestId:null};
 function snapshot(){return {...state,history:{protocol:3,readEpoch:"composer-synthetic-epoch",moreQueue:null,moreInteractions:null,page:{protocol:3,threadId:state.threadId,revision:++revision,messages:state.messages,units:state.messages.map(m=>m.id),before:null,after:null,artifacts:state.artifacts??[]}}};}
 const history=()=>Array.from({length:18},(_,i)=>({id:'fixture-'+i,threadId:'composer-review',requestId:'fixture-request-'+Math.floor(i/2),role:i%2?'assistant':'user',text:i%2?'已整理这份合成材料。先核对目标，再逐项检查细节。\n\n这是隔离浏览器检查使用的示例内容。'.repeat(2):'请整理这份示例材料，并保留需要核对的事项。',status:'completed',createdAt:1700000000000+i*1000}));
 function reset(overrides={}){state={conversationView:4,acceptedRequestIds:[],queue:[],threadId:'composer-review',messages:history(),isRunning:false,activeMessageId:null,work:[],interactions:[],upgrade:{phase:'running',accepting:true},features:{draftUpload:true,taskOverview:true},...overrides};mode={};for(const r of held)r.end(JSON.stringify({error:'fixture_reset'}));held=[];for(const a of Object.values(received))a.length=0;broadcast();}
 function broadcast(event='state'){for(const r of streams)r.write('event: '+event+'\ndata: '+JSON.stringify(snapshot())+'\n\n');}
 reset();
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='GET'&&url.pathname.startsWith('/api/media/')&&resource)return resource(req,res,url);
  if(url.pathname==='/api/history/events'){if(mode.offline)return json({error:'synthetic_offline'},503);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});streams.add(res);res.write('event: state\ndata: '+JSON.stringify(snapshot())+'\n\n');req.on('close',()=>streams.delete(res));return;}
  if(url.pathname==='/api/tasks'&&req.method==='GET')return json({tasks:[task]});
  if(url.pathname==='/api/tasks/'+task.id&&req.method==='GET')return json({taskId:task.id,requirements:[{taskId:task.id,version:task.headVersion,goal:task.goal,sourceRequestId:null}],runs:[],artifacts:[]});
  if(req.method==='POST'){
   const chunks=[];for await(const c of req)chunks.push(c);const data=Buffer.concat(chunks);
   if(url.pathname==='/api/uploads'){
    const value={assetId:req.headers['x-homer-upload'],revision:1,filename:decodeURIComponent(req.headers['x-homer-filename']),kind:decodeURIComponent(req.headers['x-homer-filename']).endsWith('.png')?'image':'file',state:'ready',mime:'application/octet-stream',size:data.length,error:null};
    received.uploads.push({threadId:req.headers['x-homer-thread'],uploadId:req.headers['x-homer-upload'],requestId:req.headers['x-homer-request'],filename:value.filename});
    if(mode.uploadHold){held.push(res);return;}
    if(mode.uploadFailAt===received.uploads.length)return json({error:'fixture_upload_unknown'},503);
    return json(value);
   }
   const body=JSON.parse(data.toString()||'{}');
   if(/^\/api\/interactions\/[^/]+$/.test(url.pathname)&&interaction)return interaction({url,body,res,json});
   if(url.pathname==='/api/history/page'&&historyPage)return historyPage({body,res,json});
   if(url.pathname==='/api/history/receipts')return json({statuses:body.requestIds.map(requestId=>({requestId,state:state.acceptedRequestIds.includes(requestId)?'accepted':'unconfirmed'})),acceptedRequestIds:state.acceptedRequestIds});
   if(url.pathname==='/api/messages'){
    received.messages.push(body);
    if(mode.sendUnknown)return json({error:'fixture_receipt_unknown'},503);
    accept(body);return json({ok:true});
   }
   if(url.pathname==='/api/stop'){received.stops.push(body);if(mode.stopHold){held.push(res);return;}return json({error:'fixture_stop_unknown'},503);}
   if(url.pathname==='/api/uploads/discard'){received.discards.push(body);return json(mode.discardFail?{error:'synthetic_discard_unknown'}:{ok:true},mode.discardFail?503:200);}
  }
  if(url.pathname.startsWith('/api/')){received.denied.push(req.method+' '+url.pathname);return json({error:'fixture_route_not_allowed'},404);}
  try{
   const before=url.pathname.startsWith('/before/'),root=before?beforeDir:webDir;
   const relative=((before?url.pathname.slice(7):url.pathname)==='/'?'index.html':(before?url.pathname.slice(7):url.pathname).slice(1)).replace(/^ui\/[a-f0-9]{64}\//,'');
   if(relative.includes('..'))throw Error('bad_path');
   const file=url.pathname==='/branding/homer.png'?branding:path.join(root,relative);
   let body=await readFile(file);if(before&&relative==='index.html')body=Buffer.from(body.toString().replaceAll('/assets/','/before/assets/'));
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream'});res.end(body);
  }catch{res.writeHead(404);res.end('fixture_not_found');}
 });
 function accept(input){if(!state.acceptedRequestIds.includes(input.requestId))state.acceptedRequestIds.push(input.requestId);if(!state.messages.some(m=>m.requestId===input.requestId&&m.role==='user'))state.messages.push({id:'accepted-'+input.requestId,threadId:state.threadId,requestId:input.requestId,role:'user',text:input.text,quotes:input.quotes,quote:input.quote,status:'completed',createdAt:Date.now()});broadcast();}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port,received,reset,accept,configure(v){Object.assign(mode,v);},update(v){Object.assign(state,v);broadcast();},unavailable(){broadcast('unavailable');},releaseStops(){for(const r of held)r.end(JSON.stringify({ok:true}));held=[];},close:async()=>{for(const r of streams)r.end();for(const r of held)r.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
