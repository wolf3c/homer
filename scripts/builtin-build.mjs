// Build-time only. Produces immutable offline resources; never installs a user plugin.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, readlinkSync, cpSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const source=fileURLToPath(new URL('../packaging/builtin-tools/',import.meta.url));
const lock=JSON.parse(readFileSync(join(source,'runtime-lock.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function run(bin,args,cwd,env){execFileSync(bin,args,{cwd,env,stdio:'pipe',timeout:600000,maxBuffer:8*1024*1024});}
export function inventory(root){
 const files=[];
 function visit(path){
  const full=join(root,path),stat=lstatSync(full);
  if(stat.isSymbolicLink()){
   const target=readlinkSync(full),actual=resolve(dirname(full),target),rel=relative(root,actual);
   if(isAbsolute(target)||rel==='..'||rel.startsWith('../'))throw Error('builtin_external_symlink:'+path);
   files.push({path,symlink:target});
  }else if(stat.isDirectory())for(const name of readdirSync(full).sort())visit(join(path,name));
  else if(stat.isFile())files.push({path,bytes:stat.size,mode:stat.mode&0o777,sha256:sha(readFileSync(full))});
  else throw Error('builtin_special_file:'+path);
 }
 for(const name of readdirSync(root).sort())if(name!=='resource-manifest.json')visit(name);
 return files;
}
export function verifyBuiltinResources(root){
 root=realpathSync(root);
 const manifest=JSON.parse(readFileSync(join(root,'resource-manifest.json')));
 if(manifest.schema!==1||manifest.platform!==`${process.platform}-${process.arch}`)throw Error('builtin_platform_or_manifest_invalid');
 if(JSON.stringify(inventory(root))!==JSON.stringify(manifest.files))throw Error('builtin_resource_integrity_mismatch');
 return {root,manifest};
}
export async function buildBuiltinResources(cache,output){
 if(`${process.platform}-${process.arch}`!==lock.platform)throw Error('builtin_unverified_platform');
 cache=resolve(cache);output=resolve(output);
 if(existsSync(output))throw Error('builtin_output_must_be_new_directory');
 // All archives must already be downloaded by the release maintainer and hash checked.
 const archivePaths={node:'node-v22.22.0-darwin-arm64.tar.gz',python:'python-verified.tar.gz',desktop:'cliclick-api.zip',chromium:`chromium-${lock.chromium.revision}-mac-arm64.zip`};
 for(const [name,file]of Object.entries(archivePaths))if(sha(readFileSync(join(cache,file)))!==lock[name].sha256)throw Error('builtin_archive_hash_mismatch:'+name);
 if(sha(readFileSync(join(cache,'python-full-verified.tar.zst')))!==lock.python.licenseBundle.sha256)throw Error('builtin_python_license_bundle_hash_mismatch');
 const wheels=JSON.parse(readFileSync(join(source,'python-wheels.lock.json')));
 for(const wheel of wheels)if(sha(readFileSync(join(cache,'wheels',wheel.filename)))!==wheel.sha256)throw Error('builtin_wheel_hash_mismatch:'+wheel.filename);
 mkdirSync(output,{recursive:true});
 try{
  mkdirSync(join(output,'node'));
  run('/usr/bin/tar',['-xzf',join(cache,archivePaths.node),'--strip-components=1','-C',join(output,'node')]);
  run('/usr/bin/tar',['-xzf',join(cache,archivePaths.python),'-C',output]);
  mkdirSync(join(output,'notices/python-runtime'),{recursive:true});
  run('/usr/bin/tar',['-xf',join(cache,'python-full-verified.tar.zst'),'--strip-components=1','-C',join(output,'notices/python-runtime'),'python/licenses','python/PYTHON.json']);
  mkdirSync(join(output,'desktop-extract'));
  run('/usr/bin/unzip',['-q',join(cache,archivePaths.desktop),'-d',join(output,'desktop-extract')]);
  mkdirSync(join(output,'desktop'));
  cpSync(join(output,'desktop-extract/cliclick/cliclick'),join(output,'desktop/cliclick'));
  cpSync(join(source,'cliclick-LICENSE.txt'),join(output,'desktop/LICENSE'));
  rmSync(join(output,'desktop-extract'),{recursive:true});
  // Upstream universal binary lacks arm64 code signature. Only signs this release copy.
  run('/usr/bin/codesign',['--force','--sign','-',join(output,'desktop/cliclick')]);
  const browserDirectory=join(output,'browsers/chromium-'+lock.chromium.revision);
  mkdirSync(browserDirectory,{recursive:true});
  run('/usr/bin/unzip',['-q',join(cache,archivePaths.chromium),'-d',browserDirectory]);
  writeFileSync(join(browserDirectory,'INSTALLATION_COMPLETE'),'');
  for(const name of['package.json','package-lock.json','runtime-lock.json','NOTICE.md','python-requirements.lock.txt','python-wheels.lock.json'])cpSync(join(source,name),join(output,name));
  const buildHome=join(cache,'build-home');mkdirSync(buildHome,{recursive:true});
  const env={HOME:buildHome,PATH:join(output,'node/bin')+':/usr/bin:/bin:/usr/sbin:/sbin',PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',PIP_DISABLE_PIP_VERSION_CHECK:'1',npm_config_cache:join(cache,'npm-cache'),PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',PLAYWRIGHT_BROWSERS_PATH:join(output,'browsers')};
  run('npm',['ci','--prefix',output,'--ignore-scripts','--omit=optional','--no-audit','--no-fund'],output,env);
  const python=join(output,'python/bin/python3');
  run(python,['-B','-m','pip','install','--no-compile','--no-index','--find-links',join(cache,'wheels'),'--require-hashes','-r',join(source,'python-requirements.lock.txt')],output,env);
  cpSync(join(source,'skills'),join(output,'skills'),{recursive:true});
  run(python,['-B',fileURLToPath(new URL('./builtin-audit.py',import.meta.url)),output],output,env);
  process.env.PLAYWRIGHT_BROWSERS_PATH=join(output,'browsers');
  const {chromium}=createRequire(join(output,'package.json'))('playwright');
  const browser=await chromium.launch({channel:'chromium',headless:true});
  let browserComponents=[];
  try{const page=await browser.newPage();await page.goto('chrome://credits');const text=await page.content();if(text.length<10000)throw Error('builtin_chromium_notices_missing');writeFileSync(join(output,'Chromium-THIRD-PARTY-NOTICES.html'),text);browserComponents=(await page.locator('.product').evaluateAll(rows=>rows.map(row=>({name:row.querySelector('.title')?.textContent?.trim(),homepage:row.querySelector('.homepage a')?.href,license:row.querySelector('.license')?.textContent??''})))).filter(c=>c.name).map(c=>({type:'library',name:c.name,licenses:[{license:{name:'See exact bundled Chromium credits',text:{contentType:'text/plain',encoding:'base64',content:Buffer.from(c.license).toString('base64')}}}],...(c.homepage?{externalReferences:[{type:'website',url:c.homepage}]}:{})}));}finally{await browser.close();}
  const pythonComponents=JSON.parse(readFileSync(join(output,'python-components.json'))).map(c=>({type:c.type,name:c.name,version:c.version,purl:c.purl,licenses:[{license:{name:c.licenseDeclaration||c.licenseClassifiers.join('; ')||'See included upstream notices'}}],properties:[{name:'homer:notice-files',value:JSON.stringify(c.noticeFiles)},{name:'homer:requires',value:JSON.stringify(c.requires)}]}));
  const npmComponents=[];
  function npmInventory(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){if(!entry.isDirectory())continue;const path=join(directory,entry.name);if(entry.name.startsWith('@')){npmInventory(path);continue;}if(existsSync(join(path,'package.json'))){const p=JSON.parse(readFileSync(join(path,'package.json')));if(p.name&&p.version)npmComponents.push({type:'library',name:p.name,version:p.version,purl:`pkg:npm/${p.name.replace('@','%40')}@${p.version}`,licenses:[{license:{name:typeof p.license==='string'?p.license:p.license?.type??'See included package license'}}]});}if(existsSync(join(path,'node_modules')))npmInventory(join(path,'node_modules'));}}
  npmInventory(join(output,'node/lib/node_modules'));
  const vendor=readFileSync(join(output,'python/lib/python3.12/site-packages/pip/_vendor/vendor.txt'),'utf8').split('\n').map(line=>line.trim()).filter(line=>/^[A-Za-z0-9_-]+==/.test(line)).map(line=>{const[name,version]=line.split('==');return {type:'library',name,version,properties:[{name:'homer:embedded-in',value:'pip'},{name:'homer:license-location',value:'python/lib/python3.12/site-packages/pip-25.2.dist-info/licenses/'}]};});
  const runtimeMetadata=JSON.parse(readFileSync(join(output,'notices/python-runtime/PYTHON.json')));
  const runtimeExtensions=Object.entries(runtimeMetadata.build_info.extensions).flatMap(([name,variants])=>variants.filter(v=>v.license_paths).map(v=>({type:'library',name:'cpython-extension:'+name,properties:[{name:'homer:license-files',value:JSON.stringify(v.license_paths)},{name:'homer:linked-libraries',value:JSON.stringify(v.links)}],licenses:[{license:{name:v.licenses?.join(' AND ')||'Public domain; see runtime source metadata'}}]})));
  const components=[...pythonComponents,...vendor,...npmComponents,...runtimeExtensions,...browserComponents,...Object.entries(lock).filter(([,v])=>v&&typeof v==='object'&&v.version&&v.sha256).map(([name,v])=>({type:'application',name,version:v.version,hashes:[{alg:'SHA-256',content:v.sha256}],externalReferences:[{type:'distribution',url:v.url}]})),...Object.entries(JSON.parse(readFileSync(join(source,'package-lock.json'))).packages).filter(([name])=>name&&!name.includes('fsevents')).map(([name,v])=>({type:'library',name:name.replace('node_modules/',''),version:v.version,licenses:[{license:{id:v.license}}],externalReferences:[{type:'distribution',url:v.resolved}],properties:[{name:'npm:integrity',value:v.integrity}]}))];
  writeFileSync(join(output,'SBOM.json'),JSON.stringify({bomFormat:'CycloneDX',specVersion:'1.6',version:1,components},null,2)+'\n');
  const files=inventory(output),manifest={schema:1,platform:lock.platform,codexVersion:lock.codexVersion,files,bytes:files.reduce((sum,file)=>sum+(file.bytes??0),0)};
  writeFileSync(join(output,'resource-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  verifyBuiltinResources(output);
  return {output,files:files.length,bytes:manifest.bytes,platform:lock.platform};
 }catch(error){rmSync(output,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[mode,first,second]=process.argv.slice(2);
 if(mode==='verify')console.log(JSON.stringify({verified:true,bytes:verifyBuiltinResources(first).manifest.bytes}));
 else if(mode==='build'&&first&&second)console.log(JSON.stringify(await buildBuiltinResources(first,second)));
 else throw Error('usage: builtin-build.mjs build <download-cache> <new-output> | verify <resources>');
}
