import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readDesktopPowerConfig,saveDesktopPowerConfig} from '../scripts/desktop-profile.mjs';

test('power preferences reuse the private desktop profile atomic update without losing other fields',t=>{
 const scratch=resolve('.codex/scratch/power-implementation/profile-tests');mkdirSync(scratch,{recursive:true});
 const root=mkdtempSync(join(scratch,'case-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'desktop-profile.json'),before={format:2,modelSource:'codex',captureShortcut:'Control+1'};
 writeFileSync(path,JSON.stringify(before),{mode:0o600});assert.equal(readDesktopPowerConfig(root),undefined);
 const power={instanceId:'a'.repeat(64),preferences:{keepAwake:false,pollMessages:true,wakeScheduled:true,pollIntervalMinutes:15}};
 saveDesktopPowerConfig(root,power);assert.deepEqual(readDesktopPowerConfig(root),power);
 assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{...before,power});
 const other=join(root,'other.json');writeFileSync(other,'{}',{mode:0o600});rmSync(path);symlinkSync(other,path);
 assert.throws(()=>saveDesktopPowerConfig(root,power),/private_file/);assert.equal(readFileSync(other,'utf8'),'{}');
});
