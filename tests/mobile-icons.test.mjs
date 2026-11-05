import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import sharp from 'sharp';

const config=JSON.parse(readFileSync('mobile/app.json')).expo;
const path=value=>resolve('mobile',value);
test('mobile launcher assets fill their canvas without changing desktop branding',async()=>{
 const icon=path(config.icon),adaptive=path(config.android.adaptiveIcon.foregroundImage);
 assert.equal(dirname(icon),resolve('assets/branding/mobile'));
 assert.equal(config.android.adaptiveIcon.backgroundColor,'#0645AD');
 for(const [file,size] of [[icon,1024],[adaptive,1080]]){
  const metadata=await sharp(file).metadata();
  assert.equal(metadata.width,size);assert.equal(metadata.height,size);
  assert.equal(metadata.hasAlpha,false,'launcher artwork must not expose a white matte');
 }
 // Android exposes the central 72 of 108 dp; the extra pixels cover mask motion.
 const expected=await sharp(icon).resize(720,720).raw().toBuffer();
 const actual=await sharp(adaptive).extract({left:180,top:180,width:720,height:720}).raw().toBuffer();
 assert.deepEqual(actual,expected);
 const desktop='assets/branding/odysseus-20261030/homer-odysseus-1024.png';
 assert.notEqual(icon,resolve(desktop));
 assert.equal((await sharp(desktop).metadata()).hasAlpha,true);
});
