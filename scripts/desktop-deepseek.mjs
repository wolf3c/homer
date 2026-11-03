// Fixed BYOK desktop connection. Credentials never pass through web IPC.
import {execFile} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,lstatSync,realpathSync,linkSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {prepareDesktopProfile} from './desktop-profile.mjs';

export const DEEPSEEK_KEY_ENV='HOMER_DEEPSEEK_TOKEN';
export function validateDeepSeekToken(token){
 if(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token))throw Error('deepseek_token_invalid');
 return token;
}
export function createDeepSeekProfile(root){
 root=resolve(root);
 // Never bless an existing directory or account. A failed creation is retained
 // for inspection; the next launch can create a different fresh directory.
 mkdirSync(root,{mode:0o700});
 if(realpathSync(root)!==root)throw Error('deepseek_profile_invalid');
 mkdirSync(join(root,'app-data'),{mode:0o700});
 for(const name of ['.homer-desktop-deepseek','.homer-desktop-new'])writeFileSync(join(root,name),'{"format":1}\n',{flag:'wx',mode:0o600});
}
export function prepareDeepSeekProfile(root,version,options){
 assertDeepSeekProfile(root);
 const paths=prepareDesktopProfile(root,version,options);
 // No automatic background memory model requests in this initial experiment.
 // An interruption after profile registration must still seed on retry. Link a
 // completed private file atomically, so a crash cannot leave a partial config.
 const config=join(paths.codexHome,'config.toml');
 if(!lstatSync(config,{throwIfNoEntry:false})){
  const staging=mkdtempSync(join(paths.root,'tmp/deepseek-config-'));
  try{
   const seed=join(staging,'config.toml');
   writeFileSync(seed,'[memories]\ngenerate_memories = false\nuse_memories = false\n',{flag:'wx',mode:0o600});
   try{linkSync(seed,config);}catch(error){if(error.code!=='EEXIST')throw error;}
  }finally{rmSync(staging,{recursive:true,force:true});}
 }
 const stat=lstatSync(config);
 if(!stat.isFile()||realpathSync(config)!==config||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw Error('deepseek_profile_invalid');
 return paths;
}
export function assertDeepSeekProfile(root){
 root=resolve(root);
 const privateOwned=(path,directory)=>{
  const stat=lstatSync(path,{throwIfNoEntry:false});
  return stat&&(directory?stat.isDirectory():stat.isFile())&&!stat.isSymbolicLink()
   &&realpathSync(path)===path&&stat.uid===process.getuid()&&(stat.mode&0o077)===0;
 };
 try{
  const marker=join(root,'.homer-desktop-deepseek');
  if(!privateOwned(root,true)||!privateOwned(marker,false)||lstatSync(join(root,'desktop-adoption.json'),{throwIfNoEntry:false})
   ||readFileSync(marker,'utf8')!=='{"format":1}\n')throw Error();
 }catch{throw Error('deepseek_profile_invalid');}
}
export function deepSeekConfig(paths){
 return {appData:paths.adoption?.appData??join(paths.root,'app-data'),nativeCodexHome:paths.adoption?.nativeCodexHome??paths.codexHome,
  workspace:paths.workspace,runtime:paths.runtime,codexHome:paths.codexHome,
  model:'deepseek-flash',effort:'high',fast:false,baseUrl:'https://models.super-tree.com/v1',
  keyEnv:DEEPSEEK_KEY_ENV,requiresOpenaiAuth:false};
}
export async function promptDeepSeekToken({signal,execFile:execute=execFile}={}){
 // The script is constant: never interpolate a secret into code, argv or env.
 const script='text returned of (display dialog "主 Agent / Worker：deepseek-flash · high · Fast 关闭。\\nToken 仅用于本次启动，不保存；发送消息才调用模型。" default answer "" with hidden answer buttons {"取消", "连接"} default button "连接" cancel button "取消" with title "荷马 · DeepSeek")';
 return new Promise((accept,reject)=>execute('/usr/bin/osascript',['-e',script],
  {encoding:'utf8',maxBuffer:8192,timeout:300000,signal,env:{PATH:'/usr/bin:/bin',LANG:'zh_CN.UTF-8'}},
  (error,stdout)=>{
   if(error){reject(Error('deepseek_token_input_cancelled'));return;}
   try{accept(validateDeepSeekToken(stdout.replace(/\r?\n$/,'')));}
   catch{reject(Error('deepseek_token_invalid'));}
  }));
}
