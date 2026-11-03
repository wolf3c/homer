import type {MobileDevices} from './mobile-devices.js';
import QRCode from 'qrcode';
import {StatePublication} from './state-publication.js';
import {HTML_PREVIEW_POLICY,htmlPreviewShell} from './html-preview.js';
import {updateReviewHtml,updateReviewJs,updateReviewCss} from './update-review-page.js';
import { createServer, type ServerResponse, type IncomingMessage } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import {webChatPost,type WebBridge} from "./web-contract.js";
import {createWebChat} from "./web-chat.js";
import {WEB_UPLOAD_BYTES,webUpload} from './web-upload.js';
import { telegramSettingsHtml, telegramSettingsCss, telegramSettingsJs } from "./channels/telegram-settings-page.js";
import {timingSafeEqual} from 'node:crypto';

const mime: Record<string, string> = { ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const json = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value === undefined ? {} : value));
};
const code = (error: unknown) => error instanceof Error && /^[a-z][a-z0-9_]{1,70}$/.test(error.message) ? error.message : "web_request_failed";
async function body(request: IncomingMessage) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") throw new Error("json_required");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 96 * 1024) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("invalid_json"); }
}

// Transport only: ownership and authorization stay in the existing Homer service.
export async function createWebServer({ bridge, port = 4780, uiDirectory, logoPath, getAssets, updateReview, deviceManagement, desktopAccessToken }: {
  desktopAccessToken?:string;
  deviceManagement?:{devices:MobileDevices;invitationUrl:string};
  updateReview?:{read():unknown;approve(hash:unknown):unknown}; bridge: WebBridge; port?: number; uiDirectory?: string; logoPath?: string; getAssets?: (version?: string) => { uiDirectory?: string; logoPath?: string };
}) {
  if(desktopAccessToken!==undefined&&(typeof desktopAccessToken!=='string'||!/^[a-f0-9]{64}$/.test(desktopAccessToken)))throw Error('desktop_access_invalid');
  const desktopAccess=desktopAccessToken===undefined?undefined:Buffer.from(desktopAccessToken,'hex');
  const chat=createWebChat(bridge);
  const clients = new Set<ServerResponse>(),historyClients=new Set<ServerResponse>();
  let url = "", sequence = 0, uploading=0;
  const publication=new StatePublication(()=>bridge.state(),state=>{
    const event=`id: ${++sequence}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;
    for(const client of clients){
      if(client.writableLength>2*1024*1024){clients.delete(client);client.end();}
      else client.write(event);
    }
  },()=>{for(const client of clients)client.write('event: unavailable\ndata: {}\n\n');},()=>clients.size>0);
  const historyPublication=new StatePublication(async()=>{if(!bridge.history)throw Error('history_protocol_required');return bridge.history.state();},state=>{
    const event=`id: ${++sequence}\nevent: state\ndata: ${JSON.stringify(state)}\n\n`;
    for(const client of historyClients){if(client.writableLength>2*1024*1024){historyClients.delete(client);client.end();}else client.write(event);}
  },()=>{for(const client of historyClients)client.write('event: unavailable\ndata: {}\n\n');},()=>historyClients.size>0);
  const unsubscribe=bridge.onStateChange?.(()=>{publication.invalidate();historyPublication.invalidate();});
  const server = createServer((request, response) => {
    void handle(request, response).catch(error => {
      if (response.headersSent) { response.end(); return; }
      if(!server.listening)response.setHeader('Connection','close');
      json(response, 409, { error: code(error) });
    });
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-src 'self' blob: https: http:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const requestOrigin=url;
    const expected = new URL(requestOrigin);
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "") || request.headers.host !== expected.host ||
      (request.headers.origin && request.headers.origin !== requestOrigin) || request.headers["sec-fetch-site"] === "cross-site")
      return json(response, 403, { error: "local_origin_required" });
    const target = new URL(request.url ?? "/", url);
    if (target.search) return json(response, 400, { error: "query_not_supported" });
    if(desktopAccess&&target.pathname.startsWith('/api/')){
      const supplied=request.headers['x-homer-desktop-access'];
      if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(desktopAccess,Buffer.from(supplied,'hex')))
        return json(response,401,{error:'web_desktop_auth_required'});
    }
    if(target.pathname.startsWith('/api/mobile/')){
      const path=target.pathname.slice('/api/mobile/'.length);
      if(request.method==='GET'&&path==='state')return json(response,200,deviceManagement?.devices.state()??{configured:false,devices:[],pending:null});
      if(request.method!=='POST'||request.headers.origin!==requestOrigin)return json(response,403,{error:'local_origin_required'});
      if(!deviceManagement)throw Error('mobile_not_configured');
      const input=await body(request),devices=deviceManagement.devices;
      if(path==='invite'){
        const invitation=devices.invite(deviceManagement.invitationUrl);
        return json(response,200,{...invitation,qr:await QRCode.toDataURL(invitation.url,{width:280,margin:2})});
      }
      if(path==='approve')devices.approve(input?.id,input?.name);
      else if(path==='reject')devices.reject(input?.id);
      else if(path==='update')devices.update(input?.id,input??{});
      else if(path==='delete')devices.remove(input?.id);
      else return json(response,404,{error:'route_not_found'});
      return json(response,200,devices.state());
    }
    if(request.method==='GET'&&target.pathname==='/preview/interactive'){
      response.setHeader('Content-Security-Policy',HTML_PREVIEW_POLICY);
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(htmlPreviewShell);return;
    }
    if(request.method==='GET'&&target.pathname==='/connect'){
      response.writeHead(302,{Location:'/#'});response.end();return;
    }
    if(request.method==='GET'&&['/settings/update','/update-review.js','/update-review.css'].includes(target.pathname)){
      response.writeHead(200,{'Content-Type':target.pathname.endsWith('.js')?'text/javascript; charset=utf-8':target.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});response.end(target.pathname.endsWith('.js')?updateReviewJs:target.pathname.endsWith('.css')?updateReviewCss:updateReviewHtml);return;
    }
    if(target.pathname==='/api/update/review'&&request.method==='GET')return json(response,200,updateReview?.read()??null);
    if(target.pathname==='/api/update/approve'&&request.method==='POST'){
      if(request.headers.origin!==requestOrigin)return json(response,403,{error:'local_origin_required'});
      if(!updateReview)throw Error('dev_update_review_unavailable');
      const input=await body(request);return json(response,200,updateReview.approve(input?.hash));
    }
    const versioned = target.pathname.match(/^\/ui\/([a-f0-9]{64})(\/assets\/[\w.-]+)$/);
    const path = versioned ? versioned[2]! : target.pathname;
    const assets = getAssets?.(versioned?.[1]) ?? { uiDirectory, logoPath };
    if(request.method==='POST'&&path==='/api/uploads'){
      if(request.headers.origin!==requestOrigin)return json(response,403,{error:'local_origin_required'});
      if(!bridge.media?.upload)throw Error('web_upload_unavailable');
      if(uploading>=2)throw Error('web_upload_busy');
      if(request.headers['content-type']!=='application/octet-stream')throw Error('web_upload_binary_required');
      const declared=Number(request.headers['content-length']);
      if(!Number.isSafeInteger(declared)||declared<1||declared>WEB_UPLOAD_BYTES)throw Error('web_upload_size_limit');
      const header=(name:string)=>{const value=request.headers[name];if(typeof value!=='string')throw Error('web_upload_invalid');return value;};
      let filename:string;try{filename=decodeURIComponent(header('x-homer-filename'));}catch{throw Error('web_upload_invalid');}
      const metadata={threadId:header('x-homer-thread'),requestId:header('x-homer-request'),uploadId:header('x-homer-upload'),filename};
      // Reject malformed scope metadata before retaining a binary body.
      webUpload({...metadata,data:'eA=='});
      uploading++;request.setTimeout(30000,()=>request.destroy());
      try{
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of request){size+=chunk.length;if(size>WEB_UPLOAD_BYTES)throw Error('web_upload_size_limit');chunks.push(chunk);}
        if(size!==declared)throw Error('web_upload_size_limit');
        request.setTimeout(0);
        return json(response,201,await chat('media.upload',{...metadata,data:Buffer.concat(chunks).toString('base64')}));
      }finally{uploading--;}
    }
    const execution=path.match(/^\/api\/tasks\/([\w:-]{1,100})\/execution\/([\w:-]{1,100})\/([\w:-]{1,100})(?:\/(before|calls)\/([A-Za-z0-9_-]{1,256}))?$/);
    if(request.method==='GET'&&execution){
      const owner=bridge.taskOverview;if(!owner?.execution||!owner.call)throw Error('task_execution_unavailable');
      const selector={rootTaskId:execution[1]!,taskId:execution[2]!,runId:execution[3]!};
      return json(response,200,await chat(execution[4]==='calls'?'tasks.call':'tasks.execution',{...selector,...(execution[4]==='calls'?{callKey:execution[5]}:{before:execution[5]})}));
    }
    const overviewProgress=path.match(/^\/api\/tasks\/([\w:-]{1,100})\/progress$/);
    if(request.method==='GET'&&overviewProgress){if(!bridge.taskOverview?.progress)throw Error('task_overview_unavailable');return json(response,200,await bridge.taskOverview.progress(overviewProgress[1]!));}
    const overviewSummary=path.match(/^\/api\/tasks\/([\w:-]{1,100})\/summary$/),overviewOrigin=path.match(/^\/api\/tasks\/([\w:-]{1,100})\/origin\/([\w:-]{1,100})$/);
    if(request.method==='GET'&&(overviewSummary||overviewOrigin)){
      if(overviewSummary&&bridge.taskOverview?.summary)return json(response,200,await bridge.taskOverview.summary(overviewSummary[1]!));
      if(overviewOrigin&&bridge.taskOverview?.origin)return json(response,200,await bridge.taskOverview.origin(overviewOrigin[1]!,overviewOrigin[2]!));
      throw Error('task_overview_unavailable');
    }
    const overviewDetail=path.match(/^\/api\/tasks\/([\w:-]{1,100})$/);
    if(request.method==='GET'&&(path==='/api/tasks'||overviewDetail)){
      if(!bridge.taskOverview)throw Error('task_overview_unavailable');
      return json(response,200,overviewDetail?await bridge.taskOverview.detail(overviewDetail[1]!):await bridge.taskOverview.list());
    }
    if(request.method==='GET'&&path==='/api/history/state')return json(response,200,await historyPublication.read());
    if(request.method==='GET'&&path==='/api/history/events'){
      const initial=await historyPublication.read();if(response.destroyed||response.writableEnded)return;
      if(!server.listening){response.writeHead(503,{Connection:'close'});response.end();return;}
      response.writeHead(200,{'Content-Type':'text/event-stream',Connection:'keep-alive','X-Accel-Buffering':'no'});historyClients.add(response);
      request.on('close',()=>historyClients.delete(response));response.write(`event: state\ndata: ${JSON.stringify(initial)}\n\n`);historyPublication.afterInitialDelivery();return;
    }
    if (request.method === "GET" && path === "/api/state") return json(response, 200, await publication.read());
    const media=path.match(/^\/api\/media\/([\w:-]{1,100})\/(asset-[a-f0-9-]{36})\/([1-9]\d{0,7})$/);
    if(request.method==='GET'&&media){
      if(!bridge.media)throw Error('media_unavailable');
      const file=await bridge.media.read({messageId:media[1]!,assetId:media[2]!,revision:Number(media[3])});
      const inline=['image/png','image/jpeg','image/webp','image/gif','audio/wav','audio/mpeg','audio/ogg','video/mp4'].includes(file.mime);
      response.writeHead(200,{'Content-Type':inline?file.mime:'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.filename)}`});response.end(Buffer.from(file.data,'base64'));return;
    }
    if (request.method === "GET" && path === "/api/channels/telegram") {
      if (!bridge.telegram) throw new Error("telegram_unavailable");
      return json(response, 200, await bridge.telegram.state());
    }
    if (request.method === "GET" && ["/settings/telegram", "/settings/telegram.css", "/settings/telegram.js"].includes(path)) {
      response.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript; charset=utf-8" : path.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8" });
      response.end(path.endsWith(".js") ? telegramSettingsJs : path.endsWith(".css") ? telegramSettingsCss : telegramSettingsHtml); return;
    }
    if (request.method === "GET" && path === "/api/channels/wechat") {
      if (!bridge.wechat) throw new Error("wechat_unavailable");
      return json(response, 200, await bridge.wechat.state());
    }
    const qr = path.match(/^\/api\/channels\/wechat\/login\/([a-f0-9-]{36})\/qr\.png$/);
    if (request.method === "GET" && qr) {
      if (!bridge.wechat) throw new Error("wechat_unavailable");
      const encoded = await bridge.wechat.qrPng(qr[1]!);
      if (typeof encoded !== "string" || encoded.length > 256 * 1024 || !/^[A-Za-z0-9+/]+=*$/.test(encoded)) throw new Error("wechat_qr_invalid");
      response.writeHead(200, { "Content-Type": "image/png" }); response.end(Buffer.from(encoded, "base64")); return;
    }
    if (request.method === "GET" && path === "/api/events") {
      const initial = await publication.read();
      if (response.destroyed||response.writableEnded) return;
      if(!server.listening){response.writeHead(503,{Connection:'close'});response.end();return;}
      response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      clients.add(response);
      request.on("close", () => clients.delete(response));
      response.write(`event: state\ndata: ${JSON.stringify(initial)}\n\n`);
      publication.afterInitialDelivery();
      return;
    }
    if (request.method === "POST") {
      if (request.headers.origin !== requestOrigin) return json(response, 403, { error: "local_origin_required" });
      const input = await body(request);
      const reveal=path.match(/^\/api\/files\/(result-[\w-]{1,100})\/reveal$/);
      if(reveal){
        if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)throw Error('artifact_reveal_invalid');
        if(!bridge.revealArtifact)throw Error('artifact_reveal_unsupported');
        return json(response,200,await bridge.revealArtifact(reveal[1]!));
      }
      if(path==='/api/uploads/preview'){
        const preview=await chat('media.preview',input) as {mime:string;data:string};
        response.writeHead(200,{'Content-Type':preview.mime});response.end(Buffer.from(preview.data,'base64'));return;
      }
      const operation=webChatPost(path);
      if(operation)return json(response,operation.status,await chat(operation.op,operation.id?{id:operation.id,input}:input));
      if (path.startsWith("/api/channels/telegram/")) {
        const telegram = bridge.telegram;
        if (!telegram) throw new Error("telegram_unavailable");
        if (path === "/api/channels/telegram/configure") return json(response, 200, await telegram.configure(input?.token));
        if (path === "/api/channels/telegram/connect") return json(response, 200, await telegram.connect());
        if (path === "/api/channels/telegram/disconnect") return json(response, 200, await telegram.disconnect());
        if (path === "/api/channels/telegram/forget") return json(response, 200, await telegram.forget());
        if (path === "/api/channels/telegram/pair") return json(response, 200, await telegram.beginPairing());
        if (path === "/api/channels/telegram/pair/candidate") return json(response, 200, await telegram.candidate(input?.code));
        if (path === "/api/channels/telegram/pair/approve") return json(response, 200, await telegram.approve(input?.code, input?.userId, input?.chatId));
      }
      if (path.startsWith("/api/channels/wechat/")) {
        if (!bridge.wechat) throw new Error("wechat_unavailable");
        if (path === "/api/channels/wechat/login") return json(response, 200, await bridge.wechat.beginLogin());
        if (path === "/api/channels/wechat/login/poll") {
          if (typeof input?.id !== "string" || !/^[a-f0-9-]{36}$/.test(input.id) ||
            (input.verifyCode !== undefined && (typeof input.verifyCode !== "string" || !/^\d{4,12}$/.test(input.verifyCode)))) throw new Error("wechat_login_invalid");
          return json(response, 200, await bridge.wechat.pollLogin(input.id, input.verifyCode));
        }
        if (path === "/api/channels/wechat/disable") return json(response, 200, await bridge.wechat.disable());
        if (path === "/api/channels/wechat/reconnect") return json(response, 200, await bridge.wechat.reconnect());
        if (path === "/api/channels/wechat/disconnect") return json(response, 200, await bridge.wechat.disconnect());
      }
    }
    const origin = path.match(/^\/api\/files\/(result-[\w-]+)\/origin$/);
    if(request.method==='GET'&&origin){
      if(!bridge.artifactOrigin)throw Error('artifact_origin_unavailable');
      return json(response,200,await bridge.artifactOrigin(origin[1]!));
    }
    const file = path.match(/^\/api\/files\/((?:run|result)-[\w-]+)$/);
    if (request.method === "GET" && file) {
      const artifact = await bridge.artifact(file[1]!);
      if(artifact.sha256)response.setHeader('X-Homer-Artifact-Hash',artifact.sha256);
      response.writeHead(200, { "Content-Type": artifact.mime??"text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}` });
      response.end(artifact.data?Buffer.from(artifact.data,'base64'):artifact.content);
      return;
    }
    if (request.method === "GET" && path === "/branding/homer.png" && assets.logoPath) {
      response.writeHead(200, { "Content-Type": "image/png" }); response.end(await readFile(assets.logoPath)); return;
    }
    if (request.method === "GET" && assets.uiDirectory && (path === "/" || /^\/assets\/[\w.-]+$/.test(path))) {
      const root = await realpath(assets.uiDirectory), full = resolve(root, path === "/" ? "index.html" : path.slice(1));
      if (full.startsWith(root + sep) && await realpath(full).catch(() => "") === full && mime[extname(full)]) {
        response.writeHead(200, { "Content-Type": mime[extname(full)] }); response.end(await readFile(full)); return;
      }
    }
    json(response, 404, { error: "route_not_found" });
  }
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); accept(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("web_listen_failed");
  url = `http://127.0.0.1:${address.port}`;
  function publish(){publication.invalidate();historyPublication.invalidate();}
  const heartbeat = setInterval(() => { for (const client of [...clients,...historyClients]) client.write(": heartbeat\n\n"); }, 15000);
  heartbeat.unref();
  const disconnectClients=()=>{for(const client of [...clients,...historyClients])client.end();clients.clear();historyClients.clear();};
  return { url, publish, reset:()=>{publication.reset();historyPublication.reset();}, disconnectClients, close: async () => {
    unsubscribe?.();publication.close();historyPublication.close();
    clearInterval(heartbeat);
    disconnectClients();
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  } };
}
