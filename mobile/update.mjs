export const downloadPage='https://super-tree.com/homer/app';
const numeric=value=>typeof value==='string'&&/^\d+(?:\.\d+)*$/.test(value);
const parts=value=>value.split('.').map(part=>part.replace(/^0+(?=\d)/,''));
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function compareVersions(a,b){
 if(!numeric(a)||!numeric(b))return null;
 const left=parts(a),right=parts(b);
 for(let i=0;i<Math.max(left.length,right.length);i++){
  const x=left[i]??'0',y=right[i]??'0';
  if(x!==y)return x.length===y.length?(x>y?1:-1):(x.length>y.length?1:-1);
 }
 return 0;
}
export function releaseEnabled(local){
 return local.channel==='stable'&&local.development===false&&local.applicationId==='com.homer.mobile'&&numeric(local.version)&&numeric(local.build)&&
  (local.platform==='android'&&/^\d+$/.test(local.build)&&positive(Number(local.build))&&positive(local.apiLevel)&&Array.isArray(local.abis)&&local.abis.length>0&&local.abis.every(abi=>typeof abi==='string'&&abi.length>0)||
   local.platform==='ios'&&local.storeEnvironment==='production'&&numeric(local.osVersion)&&typeof local.storefront==='string'&&/^[A-Z]{3}$/.test(local.storefront));
}
function validUrl(value,platform){
 if(typeof value!=='string')return false;
 try{const url=new URL(value);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&
   (platform==='android'?url.hostname==='github.com'&&/^\/wolf3c\/homer\/releases\/download\/[^/]+\/[^/]+\.apk$/.test(url.pathname):url.hostname==='apps.apple.com'&&/^(?:\/[a-z]{2})?\/app\/(?:[^/]+\/)?id6830019784\/?$/.test(url.pathname));
 }catch{return false;}
}
export function availableUpdate(data,local,dismissed){
 if(!releaseEnabled(local)||data?.schemaVersion!==1)return null;
 const record=data.releases?.stable?.[local.platform];
 if(record?.status!=='available'||!numeric(record.version))return null;
 if(local.platform==='android'){
  if(!positive(record.versionCode)||!positive(record.minApiLevel)||!Array.isArray(record.supportedAbis)||!record.supportedAbis.length||!record.supportedAbis.every(abi=>typeof abi==='string'&&/^[a-z0-9_-]+$/.test(abi))||typeof record.sha256!=='string'||! /^[a-f\d]{64}$/i.test(record.sha256)||!validUrl(record.downloadUrl,'android'))return null;
  if(local.apiLevel<record.minApiLevel||!local.abis.some(abi=>record.supportedAbis.includes(abi))||record.versionCode<=Number(local.build))return null;
  if(dismissed!==null&&(!/^\d+$/.test(dismissed)||!positive(Number(dismissed))||record.versionCode<=Number(dismissed)))return null;
  return {version:record.version,identifier:String(record.versionCode)};
 }
 if(!numeric(record.minOsVersion)||!Array.isArray(record.verifiedStorefronts)||!record.verifiedStorefronts.length||!record.verifiedStorefronts.every(code=>typeof code==='string'&&/^[A-Z]{3}$/.test(code))||!validUrl(record.storeUrl,'ios'))return null;
 if(compareVersions(local.osVersion,record.minOsVersion)<0||!record.verifiedStorefronts.includes(local.storefront)||compareVersions(record.version,local.version)!==1)return null;
 if(dismissed!==null&&compareVersions(record.version,dismissed)!==1)return null;
 return {version:record.version,identifier:parts(record.version).join('.').replace(/(?:\.0)+$/,'')};
}
export async function fetchRelease(){
 const controller=new AbortController();let timer;
 try{return await Promise.race([
  (async()=>{
   const response=await fetch('https://super-tree.com/homer/mobile-releases.json',{signal:controller.signal,credentials:'omit',headers:{'Cache-Control':'no-cache, no-store'}});
   if(!response.ok||Number(response.headers.get('content-length'))>32768||!response.body)return null;
   const reader=response.body.getReader(),chunks=[];let size=0;
   while(!controller.signal.aborted){
    const {done,value}=await reader.read();if(controller.signal.aborted)return null;if(done)break;
    size+=value.byteLength;if(size>32768){void reader.cancel().catch(()=>{});return null;}chunks.push(value);
   }
   if(controller.signal.aborted)return null;
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  })(),
  new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},5000);}),
 ]);}catch{return null;}finally{clearTimeout(timer);controller.abort();}
}
