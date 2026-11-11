import {randomUUID} from 'node:crypto';
import {mkdtempSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertWindowsPrivate,secureWindowsDirectory} from '../scripts/windows-security.mjs';

// Callers must own the Homer runtime lock.
export function writeChannelConfig(runtime:string, file:string, accounts:readonly unknown[], maxBytes:number){
  const content=JSON.stringify(accounts)+'\n';
  if(Buffer.byteLength(content)>maxBytes)throw Error('channel_config_invalid');
  const directory=process.platform==='win32'?mkdtempSync(join(runtime,'.channel-')):undefined;
  const path=join(directory??runtime,'.channel-'+randomUUID()+'.tmp');
  try{
    if(directory)secureWindowsDirectory(directory);
    writeFileSync(path,content,{mode:0o600,flag:'wx',flush:true});
    if(directory)assertWindowsPrivate(path);
    renameSync(path,join(runtime,file));
  }finally{
    try{rmSync(directory??path,{force:true,recursive:!!directory});}catch{/* Cleanup cannot change the result of the rename. */}
  }
}
