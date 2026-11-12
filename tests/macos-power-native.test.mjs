import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';

test('native macOS owner lifecycle and validation run against an in-memory power store only',{timeout:120000},()=>{
 assert.equal(process.platform,'darwin','explicit macOS native acceptance requires macOS + Xcode SDK');
 const parent=resolve('.codex/scratch/macos-power-tests');mkdirSync(parent,{recursive:true});
 const scratch=mkdtempSync(join(parent,'native-'));
 try{
  const executable=join(scratch,'native-contract');
  execFileSync('/usr/bin/xcrun',['swiftc','-parse-as-library','-module-cache-path',join(scratch,'cache'),resolve('packaging/macos/PowerShared.swift'),resolve('packaging/macos/PowerEvents.swift'),resolve('tests/fixtures/macos-power.test.swift'),'-o',executable],{timeout:90000,stdio:'pipe'});
  assert.equal(execFileSync(executable,[],{encoding:'utf8',timeout:5000}).trim(),'macos_power_native_contract_passed');
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

test('native helper/client compile and ad-hoc builds cannot register or claim authorization',{timeout:120000},async()=>{
 assert.equal(process.platform,'darwin','explicit macOS native acceptance requires macOS + Xcode SDK');
 const {buildMacPower}=await import('../scripts/build-macos-power.mjs');
 const parent=resolve('.codex/scratch/macos-power-tests');mkdirSync(parent,{recursive:true});
 const scratch=mkdtempSync(join(parent,'build-'));
 try{
  buildMacPower({root:resolve('.'),output:scratch,arch:process.arch,minimumMacOS:'13.0',run:(bin,args)=>execFileSync(bin,args,{timeout:90000,stdio:'pipe'})});
  const plist=JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',join(scratch,'app.homer.desktop.power.plist')],{encoding:'utf8'}));
  assert.equal(plist.BundleProgram,'Contents/MacOS/homer-power-helper');
  assert.deepEqual(plist.MachServices,{'app.homer.desktop.power':true});
  assert.equal(plist.StartCalendarInterval,undefined);
  for(const [name,identifier]of [['homer-power-client','app.homer.desktop.power.client'],['homer-power-helper','app.homer.desktop.power.helper']]){
   execFileSync('/usr/bin/codesign',['--verify','--strict','-R',`=identifier "${identifier}"`,join(scratch,name)],{stdio:'pipe'});
  }
  const stdout=execFileSync(join(scratch,'homer-power-client'),['--instance','a'.repeat(64)],{encoding:'utf8',timeout:10000,input:'{"requestId":1,"op":"status"}\n{"requestId":2,"op":"close"}\n'});
  const results=stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(results,[{ok:true,requestId:1,result:{supported:false,authorization:'unavailable',reason:'macos_power_developer_signature_required'}},{ok:true,requestId:2,result:null}]);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
