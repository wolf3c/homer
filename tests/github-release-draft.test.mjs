import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {runReleaseDraft} from '../scripts/github-release-draft.mjs';
import yaml from 'js-yaml';

const context={repository:'wolf3c/homer',sha:'a'.repeat(40),version:'1.2.3',tag:'v1.2.3',build:300,runId:'123',attempt:1,target:'desktop-three'};
const digest=data=>createHash('sha256').update(data).digest('hex');

function fixture(t){
 const parent=resolve('.codex/scratch');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'release-draft-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let release;const files=new Map(),calls=[];let tagSha=context.sha,corruptDownload=false;
 const fetch=async(url,options={})=>{
  const u=new URL(url),method=options.method??'GET';calls.push({path:u.pathname,method});
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
  if(u.pathname.endsWith('/git/ref/tags/'+context.tag))return json({object:{type:'commit',sha:tagSha}});
  if(u.pathname.endsWith('/releases')&&method==='GET')return json(release?[release]:[]);
  if(u.pathname.endsWith('/releases')&&method==='POST'){
   const body=JSON.parse(options.body);assert.equal(body.draft,true);assert.equal(body.make_latest,'false');
   release={...body,id:10,assets:[]};return json(release,201);
  }
  if(u.pathname.endsWith('/releases/10')&&method==='GET')return json(release);
  if(u.pathname.endsWith('/releases/10/assets')&&method==='GET')return json(release.assets);
  if(u.hostname==='uploads.github.com'&&method==='POST'){
   const name=u.searchParams.get('name');assert.ok(!files.has(name),'must not overwrite');
   const chunks=[];if(Buffer.isBuffer(options.body))chunks.push(options.body);else for await(const chunk of options.body)chunks.push(Buffer.from(chunk));
   const data=Buffer.concat(chunks),asset={id:files.size+1,name,size:data.length,digest:'sha256:'+digest(data),state:'uploaded'};
   files.set(name,data);release.assets.push(asset);return json(asset,201);
  }
  const id=Number(u.pathname.split('/').at(-1)),asset=release?.assets.find(row=>row.id===id);
  if(asset&&method==='GET')return new Response(corruptDownload?Buffer.from('corrupt'):files.get(asset.name));
  throw Error('unexpected_request: '+method+' '+u.pathname);
 };
 function receipt(target){
  const windows=target==='windows-x64',arch=target.endsWith('arm64')?'arm64':'x64';
  const directory=join(root,target);mkdirSync(directory,{recursive:true});
  const artifacts=[],add=(name,data)=>{const path=join(directory,name);writeFileSync(path,data);artifacts.push({path,bytes:Buffer.byteLength(data),sha256:digest(data)});};
  add(`Homer-${windows?'win32':'darwin'}-${arch}-${context.version}.${windows?'exe':'zip'}`,'synthetic sealed package '+target);
  if(windows){const name=`Homer-win32-x64-${context.version}.exe`,body=readFileSync(join(directory,name)),sha512=createHash('sha512').update(body).digest('base64');add('latest.yml',yaml.dump({version:context.version,files:[{url:name,sha512,size:body.length}],path:name,sha512}));}
  if(!windows)add('RELEASES.json',JSON.stringify({currentRelease:context.version,releases:[{version:context.version,updateTo:{version:context.version,pub_date:'2026-11-05T00:00:00Z',url:'https://example.invalid/old-name.zip'}}]}));
  const value={version:context.version,build:context.build,gitSha:context.sha,arch,...(windows?{platform:'win32'}:{minimumMacOS:arch==='arm64'?'27.0':'14.0'}),preparation:false,publishable:true,appId:'app.homer.desktop',releaseChannel:'stable',signature:windows?'unsigned Windows; native acceptance unverified':'Developer ID; notarized and stapled',bundle:'/private/runner/app',artifacts};
  const receiptPath=join(directory,'desktop-build-result.json');writeFileSync(receiptPath,JSON.stringify(value));
  return {directory,receiptPath,value};
 }
 const run=(mode,changes={},input={})=>runReleaseDraft(mode,{...context,...changes},{fetch,token:'synthetic',...input});
 return {run,receipt,files,calls,transport:fetch,published:()=>{release.draft=false;},wrongTag:()=>{tagSha='b'.repeat(40);},corrupt:()=>{corruptDownload=true;}};
}

test('preflight is read only and rejects a moved tag before building',async t=>{
 const f=fixture(t);await f.run('check');assert.ok(f.calls.every(row=>row.method==='GET'));
 f.wrongTag();await assert.rejects(()=>f.run('check'),/release_tag_sha_mismatch/);
});

test('preflight resolves annotated tags and finds releases beyond the first page',async t=>{
 const f=fixture(t);await f.run('upload',{target:'windows-x64'},f.receipt('windows-x64'));f.published();
 const transport=(url,options)=>{
  const u=new URL(url),json=value=>new Response(JSON.stringify(value));
  if(u.pathname.includes('/git/ref/tags/'))return json({object:{type:'tag',sha:'c'.repeat(40)}});
  if(u.pathname.includes('/git/tags/'))return json({object:{type:'commit',sha:context.sha}});
  if(u.pathname.endsWith('/releases')&&u.searchParams.get('page')==='1')return json(Array.from({length:100},(_,i)=>({tag_name:'other-'+i})));
  return f.transport(url,options);
 };
 await assert.rejects(()=>f.run('check',{}, {fetch:transport}),/release_must_remain_draft/);
});

test('preflight rejects an occupied draft from another attempt before rebuilding',async t=>{
 const f=fixture(t);await f.run('upload',{target:'macos-arm64'},f.receipt('macos-arm64'));
 const count=f.calls.length;
 await assert.rejects(()=>f.run('check',{attempt:2}),/release_manifest_identity_invalid/);
 assert.ok(f.calls.slice(count).every(row=>row.method==='GET'));
 await f.run('check');
});

test('preflight refuses a partial upload without a provenance manifest',async t=>{
 const f=fixture(t),transport=(url,options)=>new URL(url).searchParams.get('name')==='release-manifest-macos-arm64.json'?new Response('',{status:503}):f.transport(url,options);
 await assert.rejects(()=>f.run('upload',{target:'macos-arm64'},{...f.receipt('macos-arm64'),fetch:transport}),/release_request_failed: 503/);
 await assert.rejects(()=>f.run('check'),/release_draft_incomplete/);
 assert.ok(!f.files.has('release-manifest.json'));
});

test('three targets upload unchanged packages and native feeds, then verify all eleven draft assets',async t=>{
 const f=fixture(t);
 for(const target of ['macos-arm64','macos-x64','windows-x64'])await f.run('upload',{target},f.receipt(target));
 await f.run('finalize');
 const manifest=JSON.parse(f.files.get('release-manifest.json'));
 assert.deepEqual(manifest.assets.map(row=>row.name),['Homer-mac-arm64.zip','Homer-mac-x64.zip','Homer-windows-x64.exe']);
 assert.equal(manifest.build,context.build);assert.equal(manifest.gitSha,context.sha);
 for(const row of manifest.assets){assert.equal(digest(f.files.get(row.name)),row.sha256);assert.equal(row.runId,context.runId);assert.equal(row.attempt,1);assert.ok(row.assetId>0);}
 for(const arch of ['arm64','x64']){
  const feed=JSON.parse(f.files.get(`RELEASES-darwin-${arch}.json`));
  assert.equal(feed.releases[0].updateTo.url,`https://github.com/wolf3c/homer/releases/download/v1.2.3/Homer-mac-${arch}.zip`);
 }
 const windowsFeed=yaml.load(f.files.get('latest.yml').toString()),windowsBody=f.files.get('Homer-windows-x64.exe');
 assert.equal(windowsFeed.files[0].url,'https://github.com/wolf3c/homer/releases/download/v1.2.3/Homer-windows-x64.exe');
 assert.equal(windowsFeed.path,windowsFeed.files[0].url);assert.equal(windowsFeed.files[0].size,windowsBody.length);
 assert.equal(windowsFeed.files[0].sha512,createHash('sha512').update(windowsBody).digest('base64'));
 assert.equal(manifest.updateFeeds.length,3);assert.equal(f.files.size,11);
 for(const [name,data]of f.files)if(name.endsWith('.json'))assert.ok(!data.toString().includes('/private/runner'));
 assert.equal(f.files.get('SHA256SUMS').toString().trim().split('\n').length,6);
 assert.ok(f.calls.every(row=>['GET','POST'].includes(row.method)),'no publish, replacement or deletion');
});

test('a published release is rejected without writing or overwriting attachments',async t=>{
 const f=fixture(t),input=f.receipt('macos-arm64');await f.run('upload',{target:'macos-arm64'},input);f.published();
 const count=f.calls.length;await assert.rejects(()=>f.run('upload',{target:'macos-arm64'},input),/release_must_remain_draft/);
 assert.ok(f.calls.slice(count).every(row=>row.method==='GET'));
});

test('identical uploads are reusable but changed bytes and mixed attempts cannot overwrite a draft',async t=>{
 const f=fixture(t),input=f.receipt('macos-arm64');await f.run('upload',{target:'macos-arm64'},input);
 const count=f.files.size;await f.run('upload',{target:'macos-arm64'},input);assert.equal(f.files.size,count);
 await assert.rejects(()=>f.run('upload',{target:'macos-arm64',attempt:2},input),/release_manifest_identity_invalid/);
 writeFileSync(input.value.artifacts[0].path,'changed');await assert.rejects(()=>f.run('upload',{target:'macos-arm64'},input),/release_receipt_hash_mismatch/);
});

test('receipt identity, signature and artifact directory are checked before any write',async t=>{
 const f=fixture(t),input=f.receipt('macos-arm64');
 for(const change of [{gitSha:'b'.repeat(40)},{build:1},{arch:'x64'},{preparation:true},{signature:'ad-hoc'},{publishable:false}]){
  writeFileSync(input.receiptPath,JSON.stringify({...input.value,...change}));
  await assert.rejects(()=>f.run('upload',{target:'macos-arm64'},input),/release_receipt_identity_invalid/);
 }
 writeFileSync(input.receiptPath,JSON.stringify(input.value));
 const other=join(input.directory,'other');mkdirSync(other);
 await assert.rejects(()=>f.run('upload',{target:'macos-arm64'},{...input,directory:other}),/release_artifact_outside_directory/);
 assert.ok(f.calls.every(row=>row.method==='GET'));
});

test('missing platforms or corrupted downloads leave the release in draft and no aggregate is uploaded',async t=>{
 const f=fixture(t);await f.run('upload',{target:'macos-arm64'},f.receipt('macos-arm64'));
 await assert.rejects(()=>f.run('finalize'),/release_asset_missing/);assert.ok(!f.files.has('release-manifest.json'));
 await assert.rejects(()=>f.run('finalize',{target:'macos-arm64',attempt:2}),/release_manifest_identity_invalid/);
 f.corrupt();await assert.rejects(()=>f.run('finalize',{target:'macos-arm64'}),/release_download_hash_mismatch/);
 assert.ok(!f.files.has('release-manifest.json'));
});

test('a single requested platform can finalize without unrelated packages',async t=>{
 const f=fixture(t);await f.run('upload',{target:'windows-x64'},f.receipt('windows-x64'));
 await f.run('finalize',{target:'windows-x64'});
 const manifest=JSON.parse(f.files.get('release-manifest.json'));
 assert.equal(manifest.assets.length,1);assert.equal(manifest.updateFeeds.length,1);assert.equal(manifest.updateFeeds[0].name,'latest.yml');assert.equal(f.files.size,5);
});

for(const problem of ['missing','hash','size','version','elevation','root-elevation','array-like-files','web-installer'])test('Windows native feed rejects '+problem+' before uploading any asset',async t=>{
 const f=fixture(t),input=f.receipt('windows-x64'),artifact=input.value.artifacts.find(file=>file.path.endsWith('latest.yml'));
 if(problem==='missing')input.value.artifacts=input.value.artifacts.filter(file=>file!==artifact);
 else{
  const feed=yaml.load(readFileSync(artifact.path,'utf8'));
  if(problem==='hash')feed.files[0].sha512='invalid';
  if(problem==='size')feed.files[0].size++;
  if(problem==='version')feed.version='1.0.0';
  if(problem==='elevation')feed.files[0].isAdminRightsRequired=true;
  if(problem==='root-elevation')feed.isAdminRightsRequired=true;
  if(problem==='array-like-files')feed.files={0:feed.files[0],length:1};
  if(problem==='web-installer')feed.packages={x64:{path:'web-package.7z'}};
  const body=yaml.dump(feed);writeFileSync(artifact.path,body);artifact.bytes=Buffer.byteLength(body);artifact.sha256=digest(body);
 }
 writeFileSync(input.receiptPath,JSON.stringify(input.value));
 await assert.rejects(()=>f.run('upload',{target:'windows-x64'},input),problem==='missing'?/release_receipt_artifact_missing/:/desktop_update_artifacts_invalid/);
 assert.equal(f.files.size,0);assert.ok(f.calls.every(row=>row.method==='GET'));
});

test('native HTTP transport streams uploads and follows binary-download redirects without changing bytes',async t=>{
 const f=fixture(t),server=createServer(async(req,res)=>{
  try{
   const url=req.headers['x-test-url'];
   if(req.method==='GET'&&req.url==='/'&&req.headers.accept==='application/octet-stream'){
    res.writeHead(302,{location:'/download'});res.end();return;
   }
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const buffer=Buffer.concat(chunks),binary=req.headers['content-type']==='application/octet-stream';
   if(req.method==='POST'&&new URL(url).hostname==='uploads.github.com'&&req.headers.accept!=='application/vnd.github+json'){
    res.writeHead(415);res.end();return;
   }
   const response=await f.transport(url,{method:req.method,...(buffer.length?{body:binary?buffer:buffer.toString()}:{})});
   res.writeHead(response.status);res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const transport=(url,options)=>fetch(`http://127.0.0.1:${server.address().port}/`,{...options,headers:{...options.headers,'x-test-url':url}});
 await f.run('upload',{target:'windows-x64'},{...f.receipt('windows-x64'),fetch:transport});
 await f.run('finalize',{target:'windows-x64'},{fetch:transport});
 assert.equal(f.files.get('Homer-windows-x64.exe').toString(),'synthetic sealed package windows-x64');
});

test('workflow defaults to draft upload, retains a build-only option and verifies after all builds',()=>{
 const workflow=readFileSync('packaging/github/homer-build.yml.template','utf8');
 assert.match(workflow,/upload_release_draft:[\s\S]*?type: boolean\n        default: true/);
 assert.match(workflow,/cancel-in-progress: false/);
 const largeArtifact=workflow.split('      - name: Upload desktop package\n')[1].split('\n      - ')[0];
 assert.match(largeArtifact,/if: inputs.kind == 'desktop' && !inputs.upload_release_draft/);
 assert.match(largeArtifact,/retention-days: 1/);
 assert.match(workflow,/GH_TOKEN: \$\{\{ github.token \}\}/);
 assert.match(workflow,/verify-draft:[\s\S]*?needs: \[plan, build\]/);
 assert.match(workflow,/run: node scripts\/github-release-draft.mjs finalize/);
 assert.doesNotMatch(workflow,/gh release edit|--draft=false|--clobber/);
 for(const [,action]of workflow.matchAll(/uses: (\S+)/g))assert.match(action,/@[a-f0-9]{40}$/);
});
