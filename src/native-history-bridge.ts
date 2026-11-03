import {createServer} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {Agent,ProxyAgent,Socks5ProxyAgent,request,type Dispatcher} from 'undici';

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
 const server=createServer(async(req,res)=>{
  const abort=new AbortController();res.once('close',()=>abort.abort());
  try{
   const url=new URL(req.url??'/','http://127.0.0.1');
   const responses=req.method==='POST'&&url.pathname==='/responses'&&!url.search;
   const models=req.method==='GET'&&url.pathname==='/models'&&[...url.searchParams.keys()].every(key=>key==='client_version');
   if(req.headers.origin||req.headers['sec-fetch-site']){res.writeHead(403).end();return;}
   if(!responses&&!models){res.writeHead(req.method==='GET'&&url.pathname==='/responses'?426:404).end();return;}
   if(req.headers.host!=='127.0.0.1:'+String((server.address() as any).port)||!/^Bearer \S+$/.test(req.headers.authorization??'')){res.writeHead(401).end();return;}
   let body:string|undefined;
   if(responses){
    if(req.headers['content-encoding']){res.writeHead(415).end();return;}
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>64*1024*1024){res.writeHead(413).end();return;}chunks.push(chunk);}
    try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(data.input))throw Error();data.input=nativeHistoryInput(data.input);body=JSON.stringify(data);}catch{res.writeHead(400).end();return;}
   }
   const headers={...req.headers};
   for(const key of ['host','connection','keep-alive','transfer-encoding','te','trailer','upgrade','proxy-authorization','proxy-authenticate','content-length'])delete headers[key];
   const upstream=await request('https://chatgpt.com/backend-api/codex'+url.pathname+url.search,{
    method:responses?'POST':'GET',headers,body,dispatcher:client,signal:abort.signal,bodyTimeout:0,
   });
   const responseHeaders={...upstream.headers};delete responseHeaders['transfer-encoding'];delete responseHeaders.connection;
   res.writeHead(upstream.statusCode,responseHeaders);await pipeline(upstream.body,res);
  }catch{if(res.headersSent)res.destroy();else res.writeHead(502).end();}
 });
 // The fixed native client probes WebSocket first; reject before any model request is sent.
 server.on('upgrade',(_req,socket)=>socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}catch{await client.destroy();throw Error('engine_history_bridge_start_failed');}
 let closing:Promise<void>|undefined;
 return {baseUrl:'http://127.0.0.1:'+String((server.address() as any).port),close:()=>closing??=(async()=>{
  server.closeAllConnections();await Promise.all([new Promise<void>(resolve=>server.close(()=>resolve())),client.destroy()]);
 })()};
}
