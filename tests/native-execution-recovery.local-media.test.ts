import {test} from 'node:test';
import assert from 'node:assert/strict';
import {host} from './native-execution-recovery-fixture.js';

for(const reason of ['idle-exit','previous-turn-failure'] as const)test('main recovery: first image input after '+reason+' probes the restored engine without replay',async()=>{
  const f=host();try{
    await f.app.start();const old=f.peers[0]!;
    if(reason==='previous-turn-failure'){
      old.behavior=async()=>{throw Error('engine_disconnected');};
      assert.match(await f.app.message('failed request','failed-before-image'),/engine_disconnected/);
    }else{await f.app.message('earlier text','earlier-text');old.available=false;old.emit('exit');}
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=','base64');
    const ref=await f.app.uploadAttachment({threadId:old.threadId,requestId:'first-image',uploadId:'synthetic-image',filename:'synthetic.png',data:bytes.toString('base64')});
    const input={requestId:'first-image',text:'inspect the synthetic image',attachments:[{assetId:ref.assetId,revision:ref.revision}]};
    assert.throws(()=>f.app.submitMessage({...input,requestId:'wrong-image-source'}),/media_scope_denied/);
    const accepted=f.app.submitMessage(input);assert.equal(accepted.fresh,true);await f.app.idle();
    const row=f.app.inputs.list().find(i=>i.input.requestId==='first-image');assert.equal(row?.state,'completed');
    assert.equal(f.peers.length,2);assert.equal(old.imageProbes,0);assert.equal(f.peers[1]!.imageProbes,1);assert.deepEqual(f.peers[1]!.images,[1]);
    assert.equal(f.peers[1]!.options.threadId,old.threadId);assert.equal(f.app.submitMessage(input).fresh,false);
    assert.equal(await f.app.message('text after image','after-image'),'text after image');
    assert.equal(f.peers.flatMap(p=>p.seen).filter(t=>t==='failed request').length,reason==='previous-turn-failure'?1:0);
    assert.equal(f.peers[1]!.seen.filter(t=>t.includes('inspect the synthetic image')).length,1);
  }finally{await f.close();}
});
