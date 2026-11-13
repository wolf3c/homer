import {createServer,STATUS_CODES,type IncomingMessage} from 'node:http';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {Agent,ProxyAgent,Socks5ProxyAgent,request,type Dispatcher} from 'undici';
import WebSocket,{WebSocketServer,createWebSocketStream} from 'ws';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {SocksProxyAgent} from 'socks-proxy-agent';

const maxBytes=64*1024*1024;
const hopHeaders=['host','connection','keep-alive','transfer-encoding','te','trailer','upgrade','proxy-authorization','proxy-authenticate','content-length'];
function forwardedHeaders(headers:IncomingMessage['headers'],websocket=false){
 const forwarded={...headers};
 const omitted=[...hopHeaders,...String(headers.connection??'').split(',').map(name=>name.trim().toLowerCase())];
 for(const key of Object.keys(forwarded))if(omitted.includes(key)||websocket&&key.startsWith('sec-websocket-'))delete forwarded[key];
 return forwarded;
}

// Project foreign plaintext reasoning onto the request only; Codex owns the untouched rollout.
export function nativeHistoryInput(input:any[]):any[]{
 return input.map(item=>{
  if(item?.type!=='reasoning'||!Array.isArray(item.content)||!item.content.length)return item;
  const content=[...(item.summary??[]),...item.content];
  if(content.some(part=>!['summary_text','reasoning_text'].includes(part?.type)||typeof part.text!=='string'))throw Error('engine_history_input_invalid');
  return {type:'message',role:'assistant',content:content.map(part=>({type:'output_text',text:part.text}))};
 });
}
export async function nativeHistoryBridge(proxy:NodeJS.ProcessEnv,dispatcher?:Dispatcher){
 const proxyUrl=proxy.HTTPS_PROXY??proxy.https_proxy??proxy.HTTP_PROXY??proxy.http_proxy??proxy.ALL_PROXY??proxy.all_proxy;
 const bypass=(proxy.NO_PROXY??proxy.no_proxy??'').split(/[,\s]+/).some(entry=>{
  const match=entry.toLowerCase().match(/^(.+?)(?::(\d+))?$/);if(!match||match[2]&&match[2]!=='443')return false;
  const host=match[1]!.replace(/^\*?\./,'');return host==='*'||host==='chatgpt.com'||'chatgpt.com'.endsWith('.'+host);
 });
 const client=dispatcher??(bypass||!proxyUrl?new Agent():/^socks5?h?:/.test(proxyUrl)?new Socks5ProxyAgent(proxyUrl.replace(/^socks5h:/,'socks5:')):new ProxyAgent(proxyUrl));
 const cleanup=new Set<()=>void>();let closing:Promise<void>|undefined;
 const socketOptions={perMessageDeflate:false,maxPayload:maxBytes,closeTimeout:1000};
 const sockets=new WebSocketServer({...socketOptions,noServer:true});
 function denied(req:IncomingMessage){
  if(req.headers.origin||req.headers['sec-fetch-site'])return 403;
  if(req.headers.host!=='127.0.0.1:'+String((server.address() as any).port)||!/^Bearer \S+$/.test(req.headers.authorization??''))return 401;
 }
 const server=createServer(async(req,res)=>{
  const abort=new AbortController();res.once('close',()=>abort.abort());
  try{
   const url=new URL(req.url??'/','http://127.0.0.1');
   const responses=req.method==='POST'&&url.pathname==='/responses'&&!url.search;
   const models=req.method==='GET'&&url.pathname==='/models'&&[...url.searchParams.keys()].every(key=>key==='client_version');
   if(req.headers.origin||req.headers['sec-fetch-site']){res.writeHead(403).end();return;}
   if(!responses&&!models){res.writeHead(req.method==='GET'&&url.pathname==='/responses'?426:404).end();return;}
   const failure=denied(req);if(failure){res.writeHead(failure).end();return;}
   let body:string|undefined;
   if(responses){
    if(req.headers['content-encoding']){res.writeHead(415).end();return;}
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>maxBytes){res.writeHead(413).end();return;}chunks.push(chunk);}
    try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(data.input))throw Error();data.input=nativeHistoryInput(data.input);body=JSON.stringify(data);}catch{res.writeHead(400).end();return;}
   }
   const headers=forwardedHeaders(req.headers);
   const upstream=await request('https://chatgpt.com/backend-api/codex'+url.pathname+url.search,{
    method:responses?'POST':'GET',headers,body,dispatcher:client,signal:abort.signal,bodyTimeout:0,
   });
   const responseHeaders={...upstream.headers};delete responseHeaders['transfer-encoding'];delete responseHeaders.connection;
   res.writeHead(upstream.statusCode,responseHeaders);await pipeline(upstream.body,res);
  }catch{if(res.headersSent)res.destroy();else res.writeHead(502).end();}
 });
 server.on('upgrade',(req,socket,head)=>{
  socket.on('error',()=>socket.destroy());
  let answered=false;
  function reject(status:number,headers:IncomingMessage['headers']={}){
   if(socket.destroyed||answered)return;answered=true;
   const lines=[`HTTP/1.1 ${status} ${STATUS_CODES[status]??'Rejected'}`,'Connection: close'];
   for(const [name,value]of Object.entries(forwardedHeaders(headers,true)))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])lines.push(name+': '+item);
   socket.write(lines.join('\r\n')+'\r\n\r\n');
  }
  const failure=denied(req)??(closing?503:req.method!=='GET'||req.url!=='/responses'?404:undefined);
  if(failure){reject(failure);socket.end(()=>socket.destroy());return;}
  const abort=new AbortController();
  // shortcut: pending SOCKS negotiation drains within the library's 30s limit; use a cancellable connector if immediate teardown is needed.
  const agent=bypass||!proxyUrl?undefined:/^socks5?h?:/.test(proxyUrl)?new SocksProxyAgent(proxyUrl.replace(/^socks5:/,'socks5h:')):new HttpsProxyAgent(proxyUrl,{signal:abort.signal});
  let downstream:WebSocket|undefined,upstream:WebSocket|undefined,response:IncomingMessage|undefined,disposed=false;
  const dispose=()=>{
   if(disposed)return;disposed=true;clearTimeout(timer);abort.abort();response?.destroy();upstream?.terminate();downstream?.terminate();socket.destroy();agent?.destroy();cleanup.delete(dispose);
  };
  const timer=setTimeout(()=>{reject(504);socket.end(()=>socket.destroy());upstream?.terminate();abort.abort();},15000);
  cleanup.add(dispose);socket.once('close',dispose);
  try{
   const protocols=req.headers['sec-websocket-protocol']?.split(',').map(value=>value.trim())??[];
   const options={...socketOptions,headers:forwardedHeaders(req.headers,true) as Record<string,string>,agent,followRedirects:false,signal:abort.signal};
   upstream=new WebSocket('wss://chatgpt.com/backend-api/codex/responses',protocols,options);
   upstream.on('error',()=>{if(!downstream&&!disposed){reject(502);socket.end(()=>socket.destroy());}else dispose();});
   upstream.on('unexpected-response',(_request,res)=>{
    response=res;reject(res.statusCode??502,res.headers);socket.once('finish',()=>socket.destroy());
    void pipeline(res,socket).catch(()=>{}).finally(dispose);
   });
   upstream.on('upgrade',res=>response=res);
   upstream.on('close',(code,reason)=>{
    if(downstream){if(code!==1005&&code!==1006)downstream.close(code,reason);else downstream.terminate();}
   });
   upstream.on('open',()=>{
    clearTimeout(timer);if(disposed||closing){dispose();return;}
    // Each hop has its own handshake; retain the upstream's end-to-end state.
    if(upstream!.protocol)req.headers['sec-websocket-protocol']=upstream!.protocol;
    const headers=(lines:string[])=>{
     for(const [name,value]of Object.entries(forwardedHeaders(response!.headers,true)))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])lines.push(name+': '+item);
    };
    sockets.on('headers',headers);
    try{sockets.handleUpgrade(req,socket,head,peer=>{
     downstream=peer;peer.once('close',dispose);
     const streamOptions={decodeStrings:false,readableObjectMode:true,readableHighWaterMark:1};
     const local=createWebSocketStream(peer,streamOptions),remote=createWebSocketStream(upstream!,streamOptions);
     const project=new Transform({readableObjectMode:true,writableObjectMode:true,highWaterMark:1,decodeStrings:false,transform(message,_encoding,done){
      try{
       if(typeof message!=='string')throw Error('engine_history_message_invalid');
       const data=JSON.parse(message);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('engine_history_message_invalid');
       if(data.type==='response.create'&&data.input!==undefined){if(!Array.isArray(data.input))throw Error('engine_history_input_invalid');data.input=nativeHistoryInput(data.input);message=JSON.stringify(data);}
       if(Buffer.byteLength(message)>maxBytes)throw Error('engine_history_message_too_large');done(null,message);
      }catch{done(Error('engine_history_message_invalid'));}
     }});
     void pipeline(local,project,remote).catch(()=>{});
     void pipeline(remote,local).catch(()=>{});
    });}finally{sockets.off('headers',headers);}
   });
  }catch{reject(502);socket.end(()=>socket.destroy());abort.abort();agent?.destroy();}
 });
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}catch{sockets.close();await client.destroy();throw Error('engine_history_bridge_start_failed');}
 return {baseUrl:'http://127.0.0.1:'+String((server.address() as any).port),close:()=>closing??=(async()=>{
  for(const dispose of cleanup)dispose();sockets.close();
  server.closeAllConnections();await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),client.destroy()]);
 })()};
}
