import {createHash} from 'node:crypto';
import {createReadStream,readFileSync,realpathSync} from 'node:fs';
import {basename,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {planBuild} from './github-build-plan.mjs';

const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
async function hashStream(stream){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of stream){bytes+=chunk.length;hash.update(chunk);}
 return {bytes,sha256:hash.digest('hex')};
}
const bufferAsset=(name,body)=>({name,body,bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});
const sameFile=(asset,file)=>asset.state==='uploaded'&&asset.size===file.bytes&&asset.digest==='sha256:'+file.sha256;

export async function runReleaseDraft(mode,context,{fetch=globalThis.fetch,token,receiptPath,directory}={}){
 const {repository,sha,version,tag,build,runId,attempt,target}=context;
 if(!['check','upload','finalize'].includes(mode)||!token||!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!/^v?\d+\.\d+\.\d+$/.test(tag??'')||tag.replace(/^v/,'')!==version||!Number.isSafeInteger(build)||build<1||!/^\d+$/.test(runId??'')||!Number.isSafeInteger(attempt)||attempt<1)throw Error('release_inputs_invalid');
 const {include}=planBuild({kind:'desktop',target,expectedSha:sha,actualSha:sha});
 if(mode==='upload'&&include.length!==1)throw Error('release_upload_requires_one_target');
 const api=`https://api.github.com/repos/${repository}`,downloadBase=`https://github.com/${repository}/releases/download/${tag}/`;
 async function request(url,{method='GET',body,binary=false,bytes}={}){
  const response=await fetch(url,{method,headers:{authorization:'Bearer '+token,accept:binary&&method==='GET'?'application/octet-stream':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(body?{'content-type':binary?'application/octet-stream':'application/json',...(bytes===undefined?{}:{'content-length':String(bytes)})}:{})},...(body?{body:binary?body:JSON.stringify(body),...(binary?{duplex:'half'}:{})}:{})});
  if(!response.ok)throw Error('release_request_failed: '+response.status);
  return binary&&method==='GET'?response:response.json();
 }
 // Resolve annotated tags too; never let Release creation manufacture or move a tag.
 let ref=(await request(`${api}/git/ref/tags/${tag}`)).object;
 for(let depth=0;ref.type==='tag'&&depth<5;depth++)ref=(await request(`${api}/git/tags/${ref.sha}`)).object;
 if(ref.type!=='commit'||ref.sha!==sha)throw Error('release_tag_sha_mismatch');
 let release;
 for(let page=1;;page++){
  const rows=await request(`${api}/releases?per_page=100&page=${page}`);
  release=rows.find(row=>row.tag_name===tag);if(release||rows.length<100)break;
 }
 if(release&&!release.draft)throw Error('release_must_remain_draft');
 const identity={version,build,repository,gitSha:sha,runId,attempt};
 const receiptName=platform=>`release-manifest-${platform}.json`;
 const remote=[];
 if(release)for(let page=1;;page++){
  const rows=await request(`${api}/releases/${release.id}/assets?per_page=100&page=${page}`);remote.push(...rows);if(rows.length<100)break;
 }
 function find(name){const file=remote.find(row=>row.name===name);if(!file)throw Error('release_asset_missing: '+name);return file;}
 async function download(file){return request(`${api}/releases/assets/${file.id}`,{binary:true});}
 async function verify(file,expected){
  if(!sameFile(file,expected))throw Error('release_asset_conflict: '+file.name);
  const response=await download(file),actual=await hashStream(response.body);
  if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error('release_download_hash_mismatch: '+file.name);
 }
 const parts=new Map();
 for(const file of remote.filter(file=>file.name.startsWith('release-manifest-')&&file.name.endsWith('.json'))){
  if(file.size>65536)throw Error('release_manifest_size_invalid');
  const response=await download(file),body=Buffer.from(await response.arrayBuffer());
  if(!sameFile(file,bufferAsset(file.name,body)))throw Error('release_download_hash_mismatch: '+file.name);
  const part=JSON.parse(body);
  if(Object.entries(identity).some(([key,value])=>part[key]!==value))throw Error('release_manifest_identity_invalid');
  parts.set(file.name,part);
 }
 if(mode==='check'){
  if(remote.length&&!parts.size)throw Error('release_draft_incomplete');
  return;
 }
 let uploads=[],manifest;
 if(mode==='upload'){
  const row=include[0],windows=row.platform==='win32',receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
  const signature=windows?'unsigned Windows; automatic updates disabled':'Developer ID; notarized and stapled';
  if(receipt.version!==version||receipt.build!==build||receipt.gitSha!==sha||receipt.arch!==row.arch||(receipt.platform??'darwin')!==row.platform||receipt.preparation!==false||receipt.publishable!==true||receipt.appId!=='app.homer.desktop'||receipt.releaseChannel!=='stable'||receipt.signature!==signature||(!windows&&!/^\d+\.\d+$/.test(receipt.minimumMacOS??'')))throw Error('release_receipt_identity_invalid');
  const root=realpathSync(directory);
  async function artifact(name){
   const matches=receipt.artifacts.filter(file=>basename(file.path)===name);
   if(matches.length!==1)throw Error('release_receipt_artifact_missing: '+name);
   const file=matches[0],path=realpathSync(file.path),rel=relative(root,path);
   if(!rel||rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel))throw Error('release_artifact_outside_directory');
   const actual=await hashStream(createReadStream(path));
   if(actual.bytes!==file.bytes||actual.sha256!==file.sha256)throw Error('release_receipt_hash_mismatch: '+name);
   if(actual.bytes===0||actual.bytes>=2**31)throw Error('release_asset_size_invalid: '+name);
   return {path,...actual};
  }
  const originalName=`Homer-${row.platform}-${row.arch}-${version}.${windows?'exe':'zip'}`;
  const name=`Homer-${windows?'windows':'mac'}-${row.arch}.${windows?'exe':'zip'}`;
  const pkg={name,...await artifact(originalName)};uploads.push(pkg);
  const assets=[{platform:target,originalName,name,bytes:pkg.bytes,sha256:pkg.sha256,url:downloadBase+name,signature,minimumSystem:windows?'Windows 11':receipt.minimumMacOS,runId,attempt}],updateFeeds=[];
  if(!windows){
   const source=await artifact('RELEASES.json'),feed=JSON.parse(readFileSync(source.path,'utf8'));
   if(feed.currentRelease!==version||feed.releases?.length!==1||feed.releases[0].version!==version||feed.releases[0].updateTo?.version!==version)throw Error('release_update_feed_invalid');
   feed.releases[0].updateTo.url=downloadBase+name;
   const {body,...info}=bufferAsset(`RELEASES-darwin-${row.arch}.json`,json(feed));
   uploads.push({...info,body});updateFeeds.push({arch:row.arch,...info,url:downloadBase+info.name});
  }
  manifest={...identity,assets,updateFeeds};
  uploads.push(bufferAsset(receiptName(target),json(manifest)));
 }
 if(!release){
  if(mode!=='upload')throw Error('release_draft_missing');
  release=await request(`${api}/releases`,{method:'POST',body:{tag_name:tag,target_commitish:sha,name:`Homer ${version}`,body:`Source: ${sha}\nBuild: ${build}\nAwaiting acceptance; do not publish incomplete assets.`,draft:true,prerelease:false,make_latest:'false'}});
 }
 async function draft(){
  const current=await request(`${api}/releases/${release.id}`);
  if(!current.draft||current.tag_name!==tag)throw Error('release_must_remain_draft');
 }
 if(mode==='finalize'){
  const manifests=[];
  for(const row of include){
   const part=parts.get(find(receiptName(row.target)).name);
   if(part.assets?.length!==1||part.assets[0].platform!==row.target||part.updateFeeds?.length!==(row.platform==='darwin'?1:0))throw Error('release_manifest_identity_invalid');
   const names=[`Homer-${row.platform==='darwin'?'mac':'windows'}-${row.arch}.${row.platform==='darwin'?'zip':'exe'}`,...(row.platform==='darwin'?[`RELEASES-darwin-${row.arch}.json`]:[])];
   if(JSON.stringify([...part.assets,...part.updateFeeds].map(file=>file.name))!==JSON.stringify(names))throw Error('release_manifest_assets_invalid');
   manifests.push(part);
  }
  manifest={...identity,assets:manifests.flatMap(part=>part.assets),updateFeeds:manifests.flatMap(part=>part.updateFeeds)};
  const files=[...manifest.assets,...manifest.updateFeeds],allowed=new Set([...files.map(file=>file.name),...include.map(row=>receiptName(row.target)),'SHA256SUMS','release-manifest.json']);
  if(remote.some(file=>!allowed.has(file.name)))throw Error('release_unexpected_asset');
  for(const file of files){const asset=find(file.name);await verify(asset,file);file.assetId=asset.id;}
  uploads=[bufferAsset('SHA256SUMS',Buffer.from(files.map(file=>`${file.sha256}  ${file.name}\n`).join(''))),bufferAsset('release-manifest.json',json(manifest))];
 }
 for(const file of uploads){
  await draft();
  let uploaded=remote.find(row=>row.name===file.name);
  if(uploaded&&!sameFile(uploaded,file))throw Error('release_asset_conflict: '+file.name);
  if(!uploaded){
   uploaded=await request(`https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,{method:'POST',binary:true,body:file.path?createReadStream(file.path):file.body,bytes:file.bytes});remote.push(uploaded);
  }
  // Finalize streams the large packages once from GitHub; no second local copy is needed.
  if(mode==='finalize'||!file.path)await verify(uploaded,file);
  else if(!sameFile(uploaded,file))throw Error('release_asset_conflict: '+file.name);
 }
 await draft();
 return {releaseId:release.id,manifest};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const env=process.env,context={repository:env.GITHUB_REPOSITORY,sha:env.GITHUB_SHA,version:JSON.parse(readFileSync('package.json','utf8')).version,tag:env.HOMER_RELEASE_TAG,build:Number(env.HOMER_BUILD_NUMBER),runId:env.GITHUB_RUN_ID,attempt:Number(env.GITHUB_RUN_ATTEMPT),target:env.HOMER_BUILD_TARGET};
  const result=await runReleaseDraft(process.argv[2],context,{token:env.GH_TOKEN,receiptPath:env.HOMER_RELEASE_RECEIPT,directory:env.HOMER_RELEASE_DIRECTORY});
  console.log(process.argv[2]==='check'?'Release preflight passed':`Release draft ${result.releaseId}: ${process.argv[2]} complete`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
