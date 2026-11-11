import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createDesktopIcon} from '../scripts/desktop-icon.mjs';
const parent=resolve('.codex/scratch/desktop-icon-tests');mkdirSync(parent,{recursive:true});
const source=resolve('assets/branding/odysseus-20261030/homer-odysseus-256.png');
test('native ICNS decoding preserves every size, scale and RGBA pixel deterministically',t=>{
 const root=mkdtempSync(join(parent,'native-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const first=createDesktopIcon({source,directory:join(root,'first')}),second=createDesktopIcon({source,directory:join(root,'second')});
 assert.deepEqual(readFileSync(first),readFileSync(second));
 const extracted=join(root,'decoded.iconset');execFileSync('/usr/bin/iconutil',['-c','iconset',first,'-o',extracted]);
 for(const size of [16,32,128,256,512])for(const scale of [1,2]){
  const name=`icon_${size}x${size}${scale===2?'@2x':''}.png`,original=join(root,'first/Homer.iconset',name),decoded=join(extracted,name);
  const bmp=[];for(const [i,png]of [original,decoded].entries()){
   const path=join(root,`${size}-${scale}-${i}.bmp`);execFileSync('/usr/bin/sips',['-s','format','bmp',png,'--out',path],{stdio:'ignore'});const bytes=readFileSync(path);
   assert.equal(bytes.readInt32LE(18),size*scale);assert.equal(Math.abs(bytes.readInt32LE(22)),size*scale);bmp.push(bytes.subarray(bytes.readUInt32LE(10)));
  }
  assert.deepEqual(...bmp,`RGBA pixels ${name}`);
 }
});
test('icon generation rejects corrupt image without producing an ICNS',t=>{
 const root=mkdtempSync(join(parent,'invalid-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bad=join(root,'bad.png');writeFileSync(bad,'invalid');
 assert.throws(()=>createDesktopIcon({source:bad,directory:join(root,'output')}));
});
