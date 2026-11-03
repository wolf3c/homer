import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MobileDevices} from '../src/mobile-devices.js';

test('a QR authorizes only its approved candidate, retries keep one identity, and bindings survive restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'homer-mobile-')),path=join(dir,'homer.sqlite');
 let devices=new MobileDevices(path);
 try{
  const invitation=devices.invite('https://mobile.example');
  const token=new URL(invitation.url).hash.slice(1);
  assert.throws(()=>devices.pair('wrong'),/mobile_invitation_expired/);
  const paired=devices.pair(token);
  assert.equal(devices.status(paired.credential),'pending');
  assert.equal(devices.pair(token,paired.credential).credential,paired.credential);
  assert.throws(()=>devices.pair(token),/mobile_pairing_busy/);
  const id=devices.state().pending!.id;
  assert.throws(()=>devices.approve(id,' '),/mobile_name_invalid/);
  assert.equal(devices.status(paired.credential),'pending');
  devices.approve(id,'扫码确认手机');
  assert.equal(devices.state().devices[0]!.name,'扫码确认手机');
  assert.equal(devices.status(paired.credential),'active');
  assert.equal(devices.pair(token,paired.credential).status,'active');
  assert.throws(()=>devices.pair(token),/mobile_invitation_expired/);
  devices.close();devices=new MobileDevices(path);
  assert.equal(devices.authorize(paired.credential),id);
  devices.update(id,{name:'我的手机'});
  assert.equal(devices.state().devices[0]!.name,'我的手机');
  assert.equal(readFileSync(path).includes(paired.credential),false);
  const other=devices.pair(new URL(devices.invite('https://mobile.example').url).hash.slice(1));
  devices.approve(devices.state().pending!.id);
  const revoked:string[]=[];devices.onRevoke(id=>revoked.push(id));
  devices.update(id,{enabled:false});
  assert.equal(devices.status(paired.credential),'denied');
  assert.ok(devices.authorize(other.credential));
  assert.deepEqual(revoked,[id]);
  devices.update(id,{enabled:true});assert.equal(devices.authorize(paired.credential),id);
  devices.remove(id);assert.equal(devices.status(paired.credential),'denied');
  assert.ok(devices.authorize(other.credential));
 }finally{devices.close();rmSync(dir,{recursive:true,force:true});}
});

test('renew, reject, timeout and restart cancel pending pairing without creating a device',()=>{
 const dir=mkdtempSync(join(tmpdir(),'homer-mobile-'));let now=1000;
 let devices=new MobileDevices(join(dir,'homer.sqlite'),()=>now);
 try{
  let token=new URL(devices.invite('https://mobile.example').url).hash.slice(1);
  let pair=devices.pair(token);const first=devices.state().pending!.id;
  devices.reject(first);assert.equal(devices.status(pair.credential),'denied');
  token=new URL(devices.invite('https://mobile.example').url).hash.slice(1);pair=devices.pair(token);
  now+=300001;assert.equal(devices.status(pair.credential),'expired');
  assert.throws(()=>devices.approve(first),/mobile_candidate_missing/);
  token=new URL(devices.invite('https://mobile.example').url).hash.slice(1);pair=devices.pair(token);
  devices.invite('https://mobile.example');assert.equal(devices.status(pair.credential),'denied');
  token=new URL(devices.invite('https://mobile.example').url).hash.slice(1);pair=devices.pair(token);
  devices.close();devices=new MobileDevices(join(dir,'homer.sqlite'));
  assert.equal(devices.status(pair.credential),'denied');assert.deepEqual(devices.state().devices,[]);
 }finally{devices.close();rmSync(dir,{recursive:true,force:true});}
});

test('invalid device edits cannot partially rename an authorized device',()=>{
 const devices=new MobileDevices(':memory:');try{
  const paired=devices.pair(new URL(devices.invite('https://mobile.example').url).hash.slice(1));devices.approve(devices.state().pending!.id);
  const id=devices.authorize(paired.credential)!;
  assert.throws(()=>devices.update(id,{name:'changed',enabled:'invalid'}),/mobile_enabled_invalid/);
  assert.equal(devices.state().devices[0]!.name,'移动设备');
 }finally{devices.close();}
});

test('only a known pending request that timed out reports expired, including after another invitation is created',()=>{
 let now=1000;const devices=new MobileDevices(':memory:',()=>now);
 try{
  const first=devices.pair(new URL(devices.invite('https://mobile.example').url).hash.slice(1));
  now+=300000;
  devices.invite('https://mobile.example');
  assert.equal(devices.status(first.credential),'expired');
  const rejected=devices.pair(new URL(devices.invite('https://mobile.example').url).hash.slice(1));
  devices.reject(devices.state().pending!.id);
  assert.equal(devices.status(rejected.credential),'denied');
  const renewed=devices.pair(new URL(devices.invite('https://mobile.example').url).hash.slice(1));
  devices.invite('https://mobile.example');assert.equal(devices.status(renewed.credential),'denied');
  assert.equal(devices.status('x'.repeat(43)),'denied');
  now+=24*60*60*1000+1;assert.equal(devices.status(first.credential),'denied');
 }finally{devices.close();}
});

test('expired approval evidence is bounded and is not retained after the owner restarts',()=>{
 let now=1000,first='',last='';let devices=new MobileDevices(':memory:',()=>now);
 try{
  for(let i=0;i<129;i++){
   const token=new URL(devices.invite('https://mobile.example').url).hash.slice(1),candidate=devices.pair(token);
   if(i===0)first=candidate.credential;last=candidate.credential;now+=300000;
  }
  assert.equal(devices.status(last),'expired');assert.equal(devices.status(first),'denied');
  devices.close();devices=new MobileDevices(':memory:',()=>now);
  assert.equal(devices.status(last),'denied');
 }finally{devices.close();}
});
