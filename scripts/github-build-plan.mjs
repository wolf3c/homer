import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const targets={
 'macos-arm64':{runner:'macos-26',platform:'darwin',arch:'arm64'},
 'macos-x64':{runner:'macos-26-intel',platform:'darwin',arch:'x64'},
 'windows-x64':{runner:'windows-2022',platform:'win32',arch:'x64'},
 'linux-x64':{runner:'ubuntu-22.04',platform:'linux',arch:'x64'},
};

export function planBuild({kind,target,expectedSha,actualSha}){
 if(!['source','desktop'].includes(kind))throw Error('github_build_kind_invalid');
 if(target!=='all'&&!(kind==='desktop'&&target==='desktop-three')&&!Object.hasOwn(targets,target))throw Error('github_build_target_invalid');
 if(typeof expectedSha!=='string'||expectedSha.length!==40||!/^[a-f0-9]{40}$/.test(expectedSha))throw Error('github_build_full_sha_required');
 if(actualSha!==expectedSha)throw Error('github_build_source_changed');
 const selected=target==='all'?Object.keys(targets):target==='desktop-three'?['macos-arm64','macos-x64','windows-x64']:[target];
 const unsupported=kind==='desktop'?selected.filter(name=>name==='linux-x64'):[];
 if(unsupported.length)throw Error('github_desktop_target_not_ready: '+unsupported.join(', '));
 return {include:selected.map(name=>({target:name,...targets[name],...(kind==='desktop'&&name==='macos-arm64'?{runner:'xcode-27'}:{})}))};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const matrix=planBuild({kind:process.env.HOMER_BUILD_KIND,target:process.env.HOMER_BUILD_TARGET,expectedSha:process.env.HOMER_EXPECTED_SHA,actualSha:process.env.GITHUB_SHA});
  console.log('matrix='+JSON.stringify(matrix));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
