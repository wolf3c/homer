import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {MobileDevices} from '../src/mobile-devices.js';
import {requestMobileRelay, answerMobileRelay} from '../src/mobile-relay.js';

const route='a'.repeat(64), session='s'.repeat(22), otherSession='t'.repeat(22);
const relay={urls:'turns:relay.example.test:443?transport=tcp',username:'2000000000:0123456789abcdef0123456789abcdef',credential:'MDEyMzQ1Njc4OWFiY2RlZjAxMjM='};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

test('only holders of the invitation or current device credential can open a session-bound relay grant',async t=>{
 let now=1000;
 const devices=new MobileDevices(':memory:',()=>now); t.after(()=>devices.close());
 const token=new URL(devices.invite('https://example.test').url).hash.slice(1);
 const invitation=await requestMobileRelay(route,token);
 assert.ok(invitation);
 const forged=await requestMobileRelay(route,randomBytes(32).toString('base64url'));
 assert.ok(forged);
 assert.equal(await answerMobileRelay(route,forged.proof,session,()=>devices.relayCredentialHashes(),relay),undefined);
 assert.equal(await answerMobileRelay('b'.repeat(64),invitation.proof,session,()=>devices.relayCredentialHashes(),relay),undefined);
 const answer=await answerMobileRelay(route,invitation.proof,session,()=>devices.relayCredentialHashes(),relay);
 assert.ok(answer);
 for(const secret of [token,hash(token),relay.credential,relay.username]){
  assert.ok(!invitation.proof.includes(secret)); assert.ok(!answer.includes(secret));
 }
 assert.deepEqual(await invitation.open(session,answer),relay);
 assert.equal(await invitation.open(otherSession,answer),undefined);
 const retry=await requestMobileRelay(route,token);
 assert.ok(retry); assert.notEqual(retry.proof,invitation.proof);
 assert.equal(await retry.open(session,answer),undefined);
 assert.equal(await forged.open(session,answer),undefined);
 const damaged=(answer[0]==='a'?'b':'a')+answer.slice(1);
 assert.equal(await invitation.open(session,damaged),undefined);
 const {credential}=devices.pair(token);
 const pending=deviceRequest(credential);
 assert.equal(await answerMobileRelay(route,invitation.proof,session,()=>devices.relayCredentialHashes(),relay),undefined);
 const request=await pending; assert.ok(request);
 assert.ok(await answerMobileRelay(route,request.proof,session,()=>devices.relayCredentialHashes(),relay));
 const id=devices.state().pending!.id;
 devices.approve(id,'Synthetic phone');
 assert.ok(await answerMobileRelay(route,request.proof,session,()=>devices.relayCredentialHashes(),relay));
 devices.update(id,{enabled:false});
 assert.equal(await answerMobileRelay(route,request.proof,session,()=>devices.relayCredentialHashes(),relay),undefined);
 const expiring=new URL(devices.invite('https://example.test').url).hash.slice(1);
 const expires=await deviceRequest(expiring); assert.ok(expires);
 now+=300000;
 assert.equal(await answerMobileRelay(route,expires.proof,session,()=>devices.relayCredentialHashes(),relay),undefined);
});

const deviceRequest=(credential:string)=>requestMobileRelay(route,credential);
