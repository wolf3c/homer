import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createMobileGateway,readMobileConfig} from '../src/mobile-gateway.js';
import type {WebBridge} from '../src/web-contract.js';
const bridge={state:async()=>({upgrade:{phase:'running'}})} as WebBridge;
test('invalid signaling origins fail before opening storage or a listener',async()=>{
 for(const signalOrigin of ['http://phone.example','https://u:p@phone.example','https://phone.example/path','https://phone.example?q=1'])await assert.rejects(createMobileGateway({bridge,port:0,databasePath:':memory:',signalOrigin}),/mobile_signal_origin_invalid/);
});
test('profile defaults to the shared service, permits only a signaling origin override',()=>{
 const dir=mkdtempSync('.codex/scratch/mobile-webrtc/config-'),path=join(dir,'mobile.json');
 try{
  assert.deepEqual(readMobileConfig(path),{mobileSignalOrigin:'https://super-tree.com'});
  writeFileSync(path,JSON.stringify({signalOrigin:'https://signal.example'}));assert.deepEqual(readMobileConfig(path),{mobileSignalOrigin:'https://signal.example'});
  for(const value of [{signalOrigin:'http://phone.example'},{publicOrigin:'https://phone.example'},{signalOrigin:'https://phone.example',port:4781}]){writeFileSync(path,JSON.stringify(value));assert.throws(()=>readMobileConfig(path),/mobile_(config|signal_origin)_invalid/);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
