import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {once} from 'node:events';
import {mkdirSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {isIPv4} from 'node:net';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {chromium} from 'playwright-core';
import {buildMobileUi} from '../scripts/build-mobile-ui.mjs';
import {mobileBrowserFixture} from './fixtures/mobile-browser.ts';

const {HOMER_YEZI2_ROOT, HOMER_RTC_RELAY_LAB, HOMER_RTC_NO_UDP_CHROME, HOMER_RTC_RELAY_SECRET_FILE, HOMER_RTC_RELAY_CERT_SPKI, HOMER_RTC_RELAY_ADDRESS}=process.env;
if(!HOMER_YEZI2_ROOT||!HOMER_RTC_RELAY_LAB||!HOMER_RTC_NO_UDP_CHROME||!HOMER_RTC_RELAY_SECRET_FILE||!HOMER_RTC_RELAY_CERT_SPKI||!isIPv4(HOMER_RTC_RELAY_ADDRESS??''))throw Error('Local TURN/TLS integration requires explicit isolated lab inputs');
const {startHomerRtcLab}=await import(pathToFileURL(resolve(HOMER_YEZI2_ROOT,'scripts/homer-rtc-lab.mjs')));

async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

for(const blockedUdp of [true,false])test(blockedUdp
 ?'mobile starts and resumes chats over authorized TLS 443 relay with UDP blocked'
 :'mobile pairs and reconnects over UDP without configuring the offered TLS relay',{timeout:95000},async()=>{
 const base=resolve(HOMER_RTC_RELAY_LAB); mkdirSync(base,{recursive:true});
 const uiDirectory=join(base,'ui'),{html}=await buildMobileUi(uiDirectory);
 const lab=await startHomerRtcLab();
 const signalOrigin=new URL(lab.url).origin.replace(/^ws/,'http');
 const expiresAt=Math.floor(Date.now()/1000)+3600,username=expiresAt+':'+ 'd'.repeat(32);
 const key=readFileSync(HOMER_RTC_RELAY_SECRET_FILE,'utf8').trim();
 const credential=createHmac('sha1',key).update(username).digest('base64');
 const issuer=createServer((request,response)=>{
  if(request.method!=='POST'||request.url!=='/api/homer/turn/credentials'||request.headers.authorization!=='Bearer synthetic-turn-account'){
   response.writeHead(401).end();return;
  }
  response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({
   iceServers:[{urls:['turn:127.0.0.1:34879?transport=udp'],username,credential}],
   mobileTurnUrl:'turns:relay.qa.test:443?transport=tcp',expiresAt,ttlSeconds:3600,
  }));
 });
 const pageServer=createServer((_request,response)=>response.writeHead(200,{'Content-Type':'text/html'}).end(html));
 let host,browser;
 try{
  const [gatewayOrigin,pageOrigin]=await Promise.all([listen(issuer),listen(pageServer)]);
  host=await mobileBrowserFixture({signalOrigin,base,uiDirectory,turnAccount:{gatewayOrigin,token:'synthetic-turn-account',allowSyntheticLoopback:true}});
  await host.ready;
  async function owner(path,input){
   const response=await fetch(host.url+'/api/mobile/'+path,input===undefined?undefined:{method:'POST',headers:{Origin:host.url,'Content-Type':'application/json'},body:JSON.stringify(input)});
   assert.equal(response.status,200);return response.json();
  }
  const invite=new URL((await owner('invite',{})).url),routeId=invite.pathname.split('/').at(-1);
  browser=await chromium.launch({...(blockedUdp?{executablePath:HOMER_RTC_NO_UDP_CHROME}:{channel:'chrome'}),headless:true,args:[
   '--host-resolver-rules=MAP relay.qa.test '+HOMER_RTC_RELAY_ADDRESS,
   '--ignore-certificate-errors-spki-list='+HOMER_RTC_RELAY_CERT_SPKI,
   '--use-mock-keychain','--no-proxy-server',
  ]});
  const page=await browser.newPage({viewport:{width:393,height:852}});
  page.setDefaultTimeout(26000);
  await page.addInitScript(()=>{
   window.__homerMobileNonce='synthetic'; window.__qaMessages=[];
   window.ReactNativeWebView={postMessage:value=>window.__qaMessages.push(JSON.parse(value))};
   const Parent=window.RTCPeerConnection;
   window.RTCPeerConnection=class extends Parent{constructor(...args){super(...args);window.__qaPeer=this;}};
  });
  const bind=async proof=>{
   await page.goto(pageOrigin);
   await page.getByRole('textbox').first().waitFor();
   await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('homer-mobile-connect',{detail})),{signalOrigin,routeId,...proof});
  };
  const active=()=>page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='connection-status'&&value.code==='active'));
  const selection=()=>page.evaluate(async()=>{
   const stats=await window.__qaPeer.getStats();
   for(const item of stats.values())if(item.type==='transport'&&item.selectedCandidatePairId){
    const pair=stats.get(item.selectedCandidatePairId),local=stats.get(pair.localCandidateId);
    return [local.candidateType,local.relayProtocol];
   }
  });
  const assertTransport=async()=>{
   const hasRelay=await page.evaluate(()=>window.__qaPeer.getConfiguration().iceServers.some(server=>String(server.urls).startsWith('turns:')));
   assert.equal(hasRelay,blockedUdp);
   const selected=await selection();
   if(blockedUdp)assert.deepEqual(selected,['relay','tls']);
   else assert.ok(selected&&selected[0]!=='relay');
  };
  await bind({invitation:invite.hash.slice(1)});
  await page.waitForFunction(()=>window.__qaMessages.some(value=>value.type==='credential'));
  const paired=await page.evaluate(()=>window.__qaMessages.find(value=>value.type==='credential').credential);
  const state=await owner('state'); assert.ok(state.pending);
  await owner('approve',{id:state.pending.id,name:'Synthetic TLS phone'});
  await active();
  await assertTransport();
  await page.getByRole('textbox').first().fill('合成 TLS 443 测试');
  await page.getByRole('button',{name:'发送消息',exact:true}).click();
  await page.getByText('合成主端回复',{exact:true}).first().waitFor();
  assert.equal(host.turns.length,1);
  await bind({credential:paired});
  await active();
  await assertTransport();
  assert.equal((await owner('state')).devices.length,1);
 }finally{
  await browser?.close();await host?.close();await lab.close();await close(issuer);await close(pageServer);
 }
});
