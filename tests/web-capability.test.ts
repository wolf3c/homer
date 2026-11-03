import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Homer} from '../src/service.js';
import {homerWebBridge} from '../src/web-homer.js';
test('actual Web gateway handshake controls both advertised and callable upload capability',async()=>{
 const app=Object.create(Homer.prototype) as Homer;
 Object.assign(app,{config:{model:'synthetic'},channelViews:new Map()});
 assert.equal((await app.capabilities()).surfaces.web.receive,'unavailable');
 const legacy=homerWebBridge(app,{draftUpload:false});
 assert.equal(legacy.media?.upload,undefined);assert.equal(legacy.media?.discard,undefined);
 assert.equal((await app.capabilities()).surfaces.web.receive,'text_and_history');
 assert.equal((await app.capabilities()).surfaces.web.draftUpload,false);
 const current=homerWebBridge(app);
 assert.equal(typeof current.media?.upload,'function');
 assert.equal((await app.capabilities()).surfaces.web.receive,'scoped_draft_upload_and_history');
 assert.equal((await app.capabilities()).surfaces.web.draftUpload,true);
});
