// Open only an explicitly selected local candidate; never replace the daily app.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDeepSeekProfile,assertDeepSeekProfile} from './desktop-deepseek.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try{
 const args=process.argv.slice(2);
 if(![2,4].includes(args.length)||args[0]!=='--app'||!args[1]||args.length===4&&(args[2]!=='--profile'||!args[3]))throw Error('deepseek_desktop_usage');
 const app=resolve(args[1]),bin=join(app,'Contents/MacOS/Homer');
 if(realpathSync(app)!==app||!lstatSync(bin).isFile())throw Error('deepseek_desktop_app_required');
 let profile;
 if(args.length===4){profile=resolve(args[3]);assertDeepSeekProfile(profile);}
 else{
  const parent=join(root,'.codex/scratch/homer-deepseek-desktop');mkdirSync(parent,{recursive:true,mode:0o700});
  profile=join(realpathSync(mkdtempSync(join(parent,'session-'))),'profile');createDeepSeekProfile(profile);
 }
 console.log('DeepSeek 桌面隔离目录：'+profile);
 console.log('Token 请在随后出现的 macOS 隐藏输入框中输入；不会保存。');
 const child=spawn(bin,['--deepseek-profile',profile],{cwd:profile,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'zh_CN.UTF-8'},stdio:'ignore',detached:true});
 child.once('error',()=>{console.error('DeepSeek 桌面启动未完成。请核对本机候选路径。');process.exitCode=1;});
 child.unref();
}catch(error){
 const code=/^deepseek_[a-z_]+$/.test(error?.message??'')?error.message:'deepseek_desktop_start_failed';
 console.error('启动未完成：'+code+'。用法：node scripts/deepseek-desktop.mjs --app /绝对路径/Homer.app [--profile /此前隔离目录]');process.exitCode=1;
}
