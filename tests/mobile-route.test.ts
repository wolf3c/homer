import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,chmodSync,symlinkSync} from 'node:fs';import {resolve} from 'node:path';import {verify,createPublicKey} from 'node:crypto';
import {mobileRoute} from '../src/mobile-route.js';
test('one local route key survives reload and signs the exact connection challenge',()=>{
 const dir=mkdtempSync(resolve('.codex/scratch/mobile-webrtc/route-')),file=dir+'/route.pem';
 try{
  const one=mobileRoute(file),two=mobileRoute(file);assert.equal(one.routeId,two.routeId);assert.equal(statSync(file).mode&0o777,0o600);
  const challenge={connectionId:'synthetic',challenge:'synthetic-challenge'},proof=one.prove(challenge);
  assert.equal(verify(null,Buffer.from(JSON.stringify(['homer-rtc-register-v1',challenge.connectionId,challenge.challenge,one.routeId])),createPublicKey({key:Buffer.from(proof.publicKey,'base64url'),format:'der',type:'spki'}),Buffer.from(proof.signature,'base64url')),true);
  assert.doesNotMatch(JSON.stringify(proof),/PRIVATE KEY/);
  symlinkSync(file,dir+'/link');assert.throws(()=>mobileRoute(dir+'/link'));
  chmodSync(file,0o644);assert.throws(()=>mobileRoute(file));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
