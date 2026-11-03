import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

// Synthetic engines must not discover the host's system proxy settings.
const original=childProcess.execFileSync;
childProcess.execFileSync=function(file,args,options){
 if(file==='/usr/sbin/scutil'&&args?.length===1&&args[0]==='--proxy'){
  const output=Buffer.from('<dictionary> {\n}\n');
  const encoding=typeof options==='string'?options:options?.encoding;
  return encoding&&encoding!=='buffer'?output.toString(encoding):output;
 }
 return original.apply(this,arguments);
};
syncBuiltinESMExports();
