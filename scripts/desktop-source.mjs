// Uncommitted inputs require an explicit mode and are never publishable.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,cpSync,lstatSync,realpathSync,rmSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {sourceSnapshot} from './dev-build.mjs';
export const DESKTOP_CANDIDATE_PATHS=[
 'packaging/electron/main.mjs','packaging/electron/preload.cjs','packaging/electron/forge.config.mjs','packaging/electron/node-entitlements.plist',
 'packaging/electron/capture-panel-preload.cjs','ui/capture-panel.html','ui/capture-panel.tsx','ui/capture-panel.css','ui/capture-panel-vite.config.mjs','ui/screenshot-dialog.tsx',
 'scripts/pinned-build.mjs','scripts/trusted-build.mjs','scripts/windows-security.mjs','scripts/windows-security.d.mts','packaging/windows/image-decoder.mjs','src/processes.ts','src/desktop-resources.ts','src/media-decode.ts','src/homer-account.ts','ui/desktop-permissions.tsx',
 'packaging/windows/CuaWindows.cs','packaging/macos/ChromeViewport.swift','src/desktop-cua.ts','src/cua-processes.ts',
 'src/mobile-turn.ts','src/mobile-gateway.ts','src/mobile-rtc.ts','ui/mobile-devices.tsx',
 'scripts/prepare-desktop-dependencies.mjs','packaging/macos/WindowCapture.swift','packaging/macos/dependencies-lock.json','packaging/macos/codex-license/LICENSE','packaging/macos/codex-license/NOTICE',
 'package.json','package-lock.json','scripts/build-desktop.mjs','scripts/desktop-source.mjs','scripts/desktop-profile.mjs','src/web-server.ts',
 'scripts/desktop-runtime.mjs','scripts/dev-build.mjs','scripts/dev.mjs','scripts/dev-ingress.mjs','src/dev-host.ts',
 'src/service.ts','src/config.ts','src/engine.ts','src/native-history-bridge.ts','src/recursive-main-inputs.ts',
];
const retired=['packaging/macos/HomerApplication.swift','packaging/macos/Info.plist','packaging/macos/distribution-policy.json','packaging/macos/node-distribution-entitlements.plist','scripts/build-macos-desktop.mjs','scripts/macos-distribution.mjs','tests/desktop-termination.test.mjs','scripts/desktop-deepseek.mjs','scripts/deepseek-desktop.mjs','tests/desktop-deepseek.test.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function prepareDesktopSource({root,sourceSha,stage,prepareCandidate=false,localWorkingTree=false}){
 if(prepareCandidate&&localWorkingTree)throw Error('desktop_source_mode_conflict');
 root=realpathSync(root);stage=resolve(stage);
 if(!/^[a-f0-9]{40}$/.test(sourceSha??''))throw Error('desktop_full_git_sha_required');
 if(!stage.startsWith(join(root,'.codex/scratch/'))||existsSync(stage))throw Error('desktop_fresh_source_stage_required');
 mkdirSync(dirname(stage),{recursive:true});
 if(realpathSync(dirname(stage))!==dirname(stage))throw Error('desktop_source_symlink_denied');
 const commit=execFileSync(process.platform==='win32'?'git.exe':'/usr/bin/git',['rev-parse',sourceSha+'^{commit}'],{cwd:root,encoding:'utf8'}).trim();
 if(commit!==sourceSha)throw Error('desktop_full_git_sha_required');
 if(localWorkingTree){
   const {files}=sourceSnapshot(root);
   function visit(path){
     const source=join(root,path),stat=lstatSync(source);
     if(stat.isSymbolicLink())throw Error('desktop_source_symlink_denied');
     if(stat.isDirectory())for(const name of readdirSync(source).sort())visit(join(path,name));
     else if(stat.isFile())files.set(path,readFileSync(source));
     else throw Error('desktop_source_type_invalid');
   }
   visit('packaging');mkdirSync(stage);
   const candidateInputs=[];
   for(const [path,bytes]of files){
     const target=join(stage,path);mkdirSync(dirname(target),{recursive:true});
     writeFileSync(target,bytes,{mode:lstatSync(join(root,path)).mode});candidateInputs.push({path,sha256:sha(bytes)});
   }
   const provenance={format:1,gitSha:sourceSha,localWorkingTree:true,preparation:true,publishable:false,candidateInputs,removedInputs:[]};
   writeFileSync(join(dirname(stage),'source-provenance.json'),JSON.stringify(provenance,null,2)+'\n');return provenance;
 }
 const archive=execFileSync(process.platform==='win32'?'git.exe':'/usr/bin/git',['archive','--format=tar',sourceSha],{cwd:root,maxBuffer:64*1024*1024});
 mkdirSync(stage);execFileSync(process.platform==='win32'?join(process.env.SystemRoot,'System32/tar.exe'):'/usr/bin/tar',['-xf','-','-C',stage],{input:archive});
 const candidateInputs=[];
 for(const path of DESKTOP_CANDIDATE_PATHS){
  const source=join(root,path),target=join(stage,path);
  if(prepareCandidate){
   if(!lstatSync(source).isFile()||realpathSync(source)!==source)throw Error('desktop_source_symlink_denied');
   mkdirSync(dirname(target),{recursive:true});cpSync(source,target);
   candidateInputs.push({path,sha256:sha(readFileSync(target))});
  }else if(!existsSync(target)||sha(readFileSync(source))!==sha(readFileSync(target))){
   throw Error('desktop_build_entry_not_committed:'+path);
  }
 }
 const removedInputs=[];
 for(const path of retired){
  if(prepareCandidate&&!existsSync(join(root,path))){rmSync(join(stage,path),{force:true});removedInputs.push(path);}
  else if(existsSync(join(stage,path)))throw Error('desktop_retired_entry_present:'+path);
 }
 const provenance={format:1,gitSha:sourceSha,preparation:prepareCandidate,publishable:!prepareCandidate,candidateInputs,removedInputs};
 writeFileSync(join(dirname(stage),'source-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
 return provenance;
}
