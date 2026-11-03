import {build} from 'vite';
import {resolve,join} from 'node:path';
export async function buildApprovalUI(destination){
 const root=resolve('ui');
 await build({root,configFile:join(root,'vite.config.ts'),configLoader:'runner',logLevel:'warn',build:{outDir:resolve(destination),emptyOutDir:true}});
 return resolve(destination);
}
