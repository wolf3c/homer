import {generateKeyPairSync,createPrivateKey,createPublicKey,createHash,sign} from 'node:crypto';
import {openSync,readFileSync,writeFileSync,fstatSync,closeSync,constants} from 'node:fs';

// Separate from account/model credentials; the private key never leaves this owner.
export function mobileRoute(file:string){
 let fd:number|undefined,pem:string;
 try{
  try{fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   const key=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
   try{writeFileSync(file,key,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
   fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  }
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>4096||(stat.mode&0o077)!==0)throw Error();
  pem=readFileSync(fd,'utf8');
 }catch{throw Error('mobile_route_key_invalid');}finally{if(fd!==undefined)closeSync(fd);}
 const key=createPrivateKey(pem);if(key.asymmetricKeyType!=='ed25519')throw Error('mobile_route_key_invalid');
 const der=createPublicKey(key).export({type:'spki',format:'der'}),routeId=createHash('sha256').update(der).digest('hex');
 return {routeId,prove(challenge:{connectionId:string;challenge:string}){
  if(typeof challenge.connectionId!=='string'||typeof challenge.challenge!=='string'||challenge.connectionId.length>128||challenge.challenge.length>128)throw Error('mobile_signal_invalid');
  const message=Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,routeId]));
  return {routeId,publicKey:der.toString('base64url'),signature:sign(null,message,key).toString('base64url')};
 }};
}
