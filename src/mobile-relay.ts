export type MobileRelay = {urls:string;username:string;credential:string};
const encoder=new TextEncoder();
const base64url=/^[A-Za-z0-9_-]+$/;
const dnsLabel='[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const tlsUrl=new RegExp('^turns:(?:'+dnsLabel+'\\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?:443\\?transport=tcp$');

export function mobileRelayConfig(urls:unknown,username:unknown,credential:unknown):MobileRelay|undefined{
 if(typeof urls!=='string'||urls.length>277||!tlsUrl.test(urls)||
    typeof username!=='string'||!/^\d{1,16}:[0-9a-f]{32}$/.test(username)||
    typeof credential!=='string'||!/^[A-Za-z0-9+/]{27}=$/.test(credential))return;
 return {urls,username,credential};
}

// Yezi2 only forwards these envelopes. The pairing proof and the grant are bound
// to the route, with the grant also bound to this specific request and session.
const context=(...fields:string[])=>encoder.encode(JSON.stringify(['homer-turn-relay-v1',...fields]));
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
const baseKey=async(hash:string)=>crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',context('key',hash)),'AES-GCM',false,['encrypt','decrypt']);
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));

async function seal(key:CryptoKey,data:Uint8Array<ArrayBuffer>,additionalData:Uint8Array<ArrayBuffer>){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData},key,data);
 const packet=new Uint8Array(12+cipher.byteLength);
 packet.set(iv);packet.set(new Uint8Array(cipher),12);
 return encode(packet);
}

function open(key:CryptoKey,value:string,additionalData:Uint8Array<ArrayBuffer>){
 const bytes=decode(value);
 return crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12),additionalData},key,bytes.subarray(12));
}

export async function requestMobileRelay(route:string,credential:string|undefined){
 if(!credential||! /^[A-Za-z0-9_-]{43}$/.test(credential)||!globalThis.crypto?.subtle)return;
 try{
  const key=await baseKey(hex(await crypto.subtle.digest('SHA-256',encoder.encode(credential))));
  const proof=await seal(key,new Uint8Array(0),context('request',route));
  return {proof,async open(session:string,grant:string){
   if(grant.length<39||grant.length>1024||!base64url.test(grant))return;
   try{
    const config=JSON.parse(new TextDecoder().decode(await open(key,grant,context('grant',route,session,proof))));
    return mobileRelayConfig(config?.urls,config?.username,config?.credential);
   }catch{return;}
  }};
 }catch{return;}
}

export async function answerMobileRelay(route:string,proof:string,session:string,credentialHashes:()=>string[],relay:MobileRelay){
 if(!/^[A-Za-z0-9_-]{38}$/.test(proof))return;
 const requestContext=context('request',route);
 for(const hash of credentialHashes()){
  const key=await baseKey(hash);
  try{if((await open(key,proof,requestContext)).byteLength!==0)continue;}catch{continue;}
  const grant=await seal(key,encoder.encode(JSON.stringify(relay)),context('grant',route,session,proof));
  if(credentialHashes().includes(hash))return grant;
  return;
 }
}
