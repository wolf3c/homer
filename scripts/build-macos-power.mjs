import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';

// Build/sign artifacts only. Registration is an explicit desktop action, never a build step.
export function buildMacPower({root,output,arch,minimumMacOS,identity='-',run=(bin,args)=>execFileSync(bin,args,{stdio:'inherit',timeout:180000})}){
 if(process.platform!=='darwin'||typeof root!=='string'||!root||typeof output!=='string'||!output||!['arm64','x64'].includes(arch)||!/^\d+\.\d+$/.test(minimumMacOS??'')||Number(minimumMacOS)<13||identity!=='-'&&!/^[a-f0-9]{40}$/i.test(identity))throw Error('macos_power_build_inputs_invalid');
 root=resolve(root);output=resolve(output);mkdirSync(output,{recursive:true});
 const native=join(root,'packaging/macos'),temporary=mkdtempSync(join(output,'.macos-power-compile-'));
 try{
  for(const [name,source,identifier]of [['homer-power-client','PowerClient.swift','app.homer.desktop.power.client'],['homer-power-helper','PowerHelper.swift','app.homer.desktop.power.helper']]){
   const executable=join(output,name);
   run('/usr/bin/xcrun',['swiftc','-O','-parse-as-library','-target',`${arch==='x64'?'x86_64':'arm64'}-apple-macos${minimumMacOS}`,'-module-cache-path',join(temporary,'module-cache'),join(native,'PowerShared.swift'),join(native,'PowerEvents.swift'),join(native,source),'-o',executable]);
   run('/usr/bin/codesign',['--force','--sign',identity,'--identifier',identifier,...(identity==='-'?['--timestamp=none']:['--options','runtime','--timestamp=http://timestamp.apple.com/ts01']),executable]);
   run('/usr/bin/codesign',['--verify','--strict',executable]);
  }
  cpSync(join(native,'app.homer.desktop.power.plist'),join(output,'app.homer.desktop.power.plist'));
 }finally{rmSync(temporary,{recursive:true,force:true});}
 return {binaries:['homer-power-client','homer-power-helper'],plist:'app.homer.desktop.power.plist'};
}
