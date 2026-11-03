import {test} from 'node:test';import assert from 'node:assert/strict';
import {pairingAddress,savedPairing,navigation,downloadMessage,LOCAL_ORIGIN} from './connection.mjs';
const route='a'.repeat(64),invitation='b'.repeat(43),origin='https://signal.example';
test('QR provides only signaling route and one-time invitation; saved pairing excludes invitation',()=>{
 const config={signalOrigin:origin,routeId:route};
 assert.deepEqual(pairingAddress(origin+'/homer/mobile/'+route+'#'+invitation),{...config,invitation});
 assert.deepEqual(savedPairing(JSON.stringify({...config,credential:'c'.repeat(43)})),{...config,credential:'c'.repeat(43)});
 for(const input of ['http://signal.example/homer/mobile/'+route+'#'+invitation,origin+'/homer/mobile/'+route+'?q=x#'+invitation,origin+'/homer/mobile/'+route+'#short','https://u:p@signal.example/homer/mobile/'+route+'#'+invitation])assert.throws(()=>pairingAddress(input));
 assert.throws(()=>savedPairing(JSON.stringify({...config,invitation})));
 for(const value of [{...config,routeId:[route],credential:'c'.repeat(43)},{...config,credential:['c'.repeat(43)]}])assert.throws(()=>savedPairing(JSON.stringify(value)));
});
test('local page and sandboxed previews stay embedded; external top-level links leave the App',()=>{
 assert.equal(navigation(LOCAL_ORIGIN+'/',LOCAL_ORIGIN),'internal');
 assert.equal(navigation('about:blank',LOCAL_ORIGIN),'internal');
 assert.equal(navigation('about:srcdoc',LOCAL_ORIGIN,false),'internal');
 assert.equal(navigation('https://example.com/',LOCAL_ORIGIN),'external');
 assert.equal(navigation('https://example.com/embedded',LOCAL_ORIGIN,false),'internal');
 for(const url of ['javascript:alert(1)','file:///etc/passwd','data:text/html,hi','intent://any'])assert.equal(navigation(url,LOCAL_ORIGIN),'blocked');
});
test('native bridge only accepts bounded shares from the local page',()=>{
 const value=JSON.stringify({type:'share-file',filename:'合成.txt',base64:'eA=='});
 assert.deepEqual(downloadMessage(value,LOCAL_ORIGIN,LOCAL_ORIGIN+'/'),{filename:'合成.txt',base64:'eA=='});
 assert.throws(()=>downloadMessage(value,LOCAL_ORIGIN,'https://foreign.example/'));
 for(const filename of ['../bad','..','/secret'])assert.throws(()=>downloadMessage(JSON.stringify({type:'share-file',filename,base64:'eA=='}),LOCAL_ORIGIN,LOCAL_ORIGIN+'/'));
});

test('connection screen distinguishes first launch, approval and reconnect without hiding an existing chat',async()=>{
 const connection=await import('./connection.mjs');
 assert.equal(typeof connection.connectionScreen,'function');
 const screen=connection.connectionScreen;
 assert.equal(screen('restoring',false),'loading');
 assert.equal(screen('scan',false),'welcome');
 assert.equal(screen('connecting',false),'connecting');
 assert.equal(screen('pending',false),'pending');
 assert.equal(screen('active',false),'chat');
 assert.equal(screen('denied',false),'denied');
 assert.equal(screen('invitation-expired',false),'invitation-expired');
 assert.equal(screen('unavailable',false),'unavailable');
 assert.equal(screen('version',false),'version');
 assert.equal(screen('restore-error',false),'restore-error');
 for(const status of ['connecting','unavailable','denied','version'])assert.equal(screen(status,true),'chat');
});
