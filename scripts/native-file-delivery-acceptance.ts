// Explicit local acceptance with the real host and a scripted engine.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
import {extractDocument} from '../src/media-documents.js';
import {fixture} from '../tests/fixtures/worker-chat-host.js';
import type {WebArtifact} from '../src/web-contract.js';

const python=process.argv[2];
if(!python)throw Error('existing_python_path_required');
const scratch=resolve('.codex/scratch/native-file-delivery');mkdirSync(scratch,{recursive:true});
const directory=mkdtempSync(join(scratch,'accepted-'));
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
execFileSync(python,['-B',fileURLToPath(new URL('./fixtures/native-office-files.py',import.meta.url)),directory],
  {timeout:20000,env:{PATH:'/usr/bin:/bin',TMPDIR:directory},stdio:'pipe'});
const f=fixture();
let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
try{
  const files=['docx','pptx','xlsx','pdf','png'].map(ext=>({ext,filename:'synthetic-'+(ext==='png'?'image':'report')+'.'+ext}));
  for(const {ext,filename} of files){
    const source=join(directory,filename),bytes=readFileSync(source);
    if(ext!=='png'){
      const content=await extractDocument(bytes,filename);
      for(const token of ['Homer synthetic office acceptance','120','90','30'])
        assert.ok(content.text.includes(token),'actual_document_content_missing:'+ext+':'+token);
    }
    copyFileSync(source,join(f.app.config.workspace,filename));
  }
  f.setScript(async engine=>{
    await engine.call('send_user_message',{text:'已核对合成文件',attachments:files.map(({filename})=>({path:join(f.app.config.workspace,filename)}))});
    return {status:'completed',text:''};
  });
  await f.app.start();
  await f.app.message('Attach the exact verified files.','synthetic-files');
  const bridge=homerWebBridge(f.app);
  web=await createWebServer({port:process.argv.includes('--serve')?4811:0,bridge,uiDirectory:resolve('dist/web'),
    logoPath:resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png')});
  const attached=(await bridge.history!.state()).artifacts??[];
  assert.equal(attached.length,files.length);
  const results=[];
  const url=({messageId,assetId,revision}:WebArtifact)=>web!.url+'/api/media/'+[messageId,assetId,revision].map(encodeURIComponent).join('/');
  for(const {ext,filename} of files){
    const file=attached.find(item=>item.title===filename)!;
    assert.ok(file);
    const response=await fetch(url(file));
    assert.equal(response.status,200);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes),sha(readFileSync(join(directory,filename))));
    assert.match(response.headers.get('content-disposition')!,/filename/);
    results.push({filename,bytes:bytes.length,sha256:sha(bytes),assetId:file.assetId,contentVerified:ext!=='png'});
  }
  assert.equal((await fetch(web.url+'/api/files/run-no-such-run')).status,404);
  const receipt={synthetic:true,noModelOrAccount:true,url:web.url,directory,results,exactDownloadBytes:true};
  writeFileSync(join(directory,'verification-receipt.json'),JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
  if(process.argv.includes('--serve'))await new Promise<void>(done=>{process.once('SIGINT',done);process.once('SIGTERM',done);});
}finally{await web?.close();await f.close();}
