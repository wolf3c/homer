// Build-time only. Fixed official archives; no package-manager installs or caches.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const lock=JSON.parse(readFileSync(new URL('../packaging/macos/dependencies-lock.json',import.meta.url),'utf8'));

export const NODE_VERSION='22.22.0',CODEX_VERSION='0.163.0';
const sha=(data,algorithm='sha256')=>createHash(algorithm).update(data).digest('hex');
export function prepareDependencies(scratch,{archiveSource,arch=process.arch,platform=process.platform}={}){
  if(!['arm64','x64'].includes(arch))throw Error('desktop_dependency_target_invalid');
  const windows=platform==='win32';
  if(!['darwin','win32'].includes(platform)||windows&&arch!=='x64')throw Error('desktop_dependency_target_invalid');
  const target=platform+'-'+arch,nodePin=windows?lock.nodeWin32X64:arch==='arm64'?lock.node:lock.nodeDarwinX64,codexPin=windows?lock.codexWin32X64:arch==='arm64'?lock.codexDarwinArm64:lock.codexDarwinX64;
  const curl=windows?join(process.env.SystemRoot,'System32/curl.exe'):'/usr/bin/curl',tar=windows?join(process.env.SystemRoot,'System32/tar.exe'):'/usr/bin/tar';
  if(!nodePin||!codexPin)throw Error('desktop_dependency_target_invalid');
  scratch=resolve(scratch);mkdirSync(scratch,{recursive:true});
  const archives=new Map();
  const fetch=(url,name,max)=>{
    const file=join(archiveSource?resolve(archiveSource):scratch,name);
    if(archiveSource&&!existsSync(file))throw Error('desktop_readonly_archive_missing');
    if(!existsSync(file))execFileSync(curl,['--fail','--silent','--show-error','--location','--proto','=https','--tlsv1.2','--max-time','180','--max-filesize',String(max),url,'-o',file],{stdio:'inherit'});
    archives.set(name,file);
    return file;
  };
  const components=[];
  const sums=readFileSync(fetch(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`,'node-shasums256.txt',50000),'utf8');
  const nodeName=`node-v${NODE_VERSION}-${windows?'win-x64.zip':target+'.tar.gz'}`;
  const nodeUrl=`https://nodejs.org/dist/v${NODE_VERSION}/${nodeName}`;
  const nodeArchive=fetch(nodeUrl,nodeName,60000000);
  const nodeSha=sums.split('\n').find(line=>line.endsWith('  '+nodeName))?.split(' ')[0];
  if(!nodeSha||nodeSha!==nodePin.sha256||sha(readFileSync(nodeArchive))!==nodeSha)throw Error('desktop_node_integrity_failed');
  components.push({name:'Node.js',version:NODE_VERSION,archive:nodeName,url:nodeUrl,sha256:nodeSha,verification:'official HTTPS SHASUMS256.txt; not an independent PGP signature',license:'Node.js LICENSE (MIT and bundled third-party notices)'});
  for(const [version,name]of[[CODEX_VERSION,'codex-registry.json'],[CODEX_VERSION+'-'+target,`codex-${arch}-registry.json`]]){
    const metadata=JSON.parse(readFileSync(fetch(`https://registry.npmjs.org/@openai/codex/${version}`,name,30000),'utf8'));
    if(metadata.name!=='@openai/codex'||metadata.version!==version||metadata.license!=='Apache-2.0')throw Error('desktop_codex_metadata_mismatch');
    const url=metadata.dist.tarball;
    if(url!==`https://registry.npmjs.org/@openai/codex/-/codex-${version}.tgz`)throw Error('desktop_codex_source_invalid');
    const archive=fetch(url,`codex-${version}.tgz`,150000000);
    const bytes=readFileSync(archive);
    const pinned=version.endsWith(target)?codexPin:lock.codex;
    if((pinned.sha256&&sha(bytes)!==pinned.sha256)||metadata.dist.integrity!==pinned.integrity||'sha512-'+createHash('sha512').update(bytes).digest('base64')!==metadata.dist.integrity)throw Error('desktop_codex_integrity_failed');
    components.push({name:'@openai/codex',version,archive:`codex-${version}.tgz`,url,sha256:sha(bytes),integrity:metadata.dist.integrity,license:metadata.license,completePlatformArchive:version.endsWith(target)});
  }
  for(const name of ['LICENSE','NOTICE']){
    const metadata=JSON.parse(readFileSync(fetch(`https://api.github.com/repos/openai/codex/contents/${name}?ref=rust-v${CODEX_VERSION}`,`codex-${name}-source.json`,50000),'utf8'));
    if(metadata.path!==name||metadata.encoding!=='base64'||!metadata.content)throw Error('desktop_codex_license_invalid');
    writeFileSync(join(scratch,'codex-'+name),Buffer.from(metadata.content,'base64'));
  }
  const paths={node:join(scratch,'official-node'),codex:join(scratch,'official-codex'),cli:join(scratch,'official-codex-cli')};
  for(const [key,name]of[['node',nodeName],['codex',`codex-${CODEX_VERSION}-${target}.tgz`],['cli',`codex-${CODEX_VERSION}.tgz`]]){
    const path=paths[key];if(existsSync(path))rmSync(path,{recursive:true});mkdirSync(path);
    const listing=execFileSync(tar,['-tf',archives.get(name)],{encoding:'utf8'}).split('\n').filter(Boolean);
    if(listing.some(p=>p.startsWith('/')||p.split('/').includes('..')))throw Error('desktop_archive_path_invalid');
    execFileSync(tar,['-xf',archives.get(name),'-C',path,'--strip-components=1',...(key==='node'?[`node-v${NODE_VERSION}-${windows?'win-x64':target}/${windows?'node.exe':'bin/node'}`,`node-v${NODE_VERSION}-${windows?'win-x64':target}/LICENSE`]:[])],{stdio:'inherit'});
  }
  writeFileSync(join(scratch,'official-dependencies.json'),JSON.stringify({format:1,components},null,2)+'\n');
  return {...paths,components,vendor:windows?'x86_64-pc-windows-msvc':arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin'};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){const paths=prepareDependencies(process.argv[2]??'.codex/scratch/macos-desktop-application');console.log(JSON.stringify(paths));}
