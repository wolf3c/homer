import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {mkdirSync,mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';

test('native client services main run-loop notifications while its protocol remains responsive',{timeout:120000},async()=>{
 assert.equal(process.platform,'darwin');
 const parent=resolve('.codex/scratch/macos-power-tests');mkdirSync(parent,{recursive:true});
 const scratch=mkdtempSync(join(parent,'wake-'));let child;
 try{
  // Only this compiled fixture posts a notification; product code has no test command or bypass.
  const source=readFileSync('packaging/macos/PowerClient.swift','utf8'),marker='        DispatchQueue.global(qos: .utility).async {';
  assert.equal(source.split(marker).length,2);
  const injected=`        let timer = CFRunLoopTimerCreateWithHandler(nil, CFAbsoluteTimeGetCurrent() + 0.1, 0, 0, 0) { _ in
            NSWorkspace.shared.notificationCenter.post(name: NSWorkspace.didWakeNotification, object: nil)
        }
        CFRunLoopAddTimer(CFRunLoopGetMain(), timer, .defaultMode)
`;
  const path=join(scratch,'PowerClient.swift'),binary=join(scratch,'client');writeFileSync(path,source.replace(marker,injected+marker));
  execFileSync('/usr/bin/xcrun',['swiftc','-parse-as-library','-module-cache-path',join(scratch,'cache'),resolve('packaging/macos/PowerShared.swift'),resolve('packaging/macos/PowerEvents.swift'),path,'-o',binary],{timeout:90000,stdio:'pipe'});
  const messages=[];child=spawn(binary,['--instance','e'.repeat(64)],{stdio:['pipe','pipe','ignore']});
  const exited=once(child,'exit');const reader=createInterface({input:child.stdout});
  const ready=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('native_wake_notification_not_received')),3000);
   reader.on('line',line=>{messages.push(JSON.parse(line));if(messages.some(x=>x.kind==='wake')&&messages.some(x=>x.requestId===1)){clearTimeout(timeout);resolve();}});
   child.once('exit',()=>{clearTimeout(timeout);reject(Error('client_exited_before_notification'));});
  });
  child.stdin.write('{"requestId":1,"op":"status"}\n');await ready;
  assert.deepEqual(messages.find(x=>x.requestId===1).result,{supported:false,authorization:'unavailable',reason:'macos_power_developer_signature_required'});
  assert.deepEqual(messages.filter(x=>x.kind==='wake'),[{kind:'wake'}]);
  child.stdin.end('{"requestId":2,"op":"close"}\n');assert.deepEqual(await exited,[0,null]);reader.close();
  assert.ok(messages.some(x=>x.requestId===2&&x.ok&&x.result==='owner-empty'));
 }finally{if(child&&child.exitCode===null)child.kill();rmSync(scratch,{recursive:true,force:true});}
});

test('native macOS owner lifecycle and validation run against an in-memory power store only',{timeout:120000},()=>{
 assert.equal(process.platform,'darwin','explicit macOS native acceptance requires macOS + Xcode SDK');
 const parent=resolve('.codex/scratch/macos-power-tests');mkdirSync(parent,{recursive:true});
 const scratch=mkdtempSync(join(parent,'native-'));
 try{
  const executable=join(scratch,'native-contract');
  execFileSync('/usr/bin/xcrun',['swiftc','-parse-as-library','-module-cache-path',join(scratch,'cache'),resolve('packaging/macos/PowerShared.swift'),resolve('packaging/macos/PowerEvents.swift'),resolve('tests/fixtures/macos-power.test.swift'),'-o',executable],{timeout:90000,stdio:'pipe'});
  assert.equal(execFileSync(executable,[scratch],{encoding:'utf8',timeout:5000}).trim(),'macos_power_native_contract_passed');
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
  assert.deepEqual(results,[{ok:true,requestId:1,result:{supported:false,authorization:'unavailable',reason:'macos_power_developer_signature_required'}},{ok:true,requestId:2,result:'owner-empty'}]);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});
