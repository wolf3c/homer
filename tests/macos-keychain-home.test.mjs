import {test} from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {userInfo} from 'node:os';

const base=process.env.HOMER_TEST_CHANNEL_MODULES;
assert.ok(base?.startsWith('file://'),'explicit compiled channel modules required');
for(const channel of ['wechat','telegram'])test(`${channel} Keychain lookup uses the OS user home while parent HOME/tmp stay isolated`,async()=>{
 const originalSpawn=childProcess.spawn,originalHome=process.env.HOME,originalTmp=process.env.TMPDIR,calls=[];
 process.env.HOME='/synthetic/homer-desktop/host-home';process.env.TMPDIR='/synthetic/homer-desktop/tmp';
 const credential=channel==='wechat'?{botToken:'synthetic-token',botId:'synthetic-bot',ownerId:'synthetic-owner',baseUrl:'https://synthetic.weixin.qq.com',dataKey:'a'.repeat(64)}:'12345:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
 childProcess.spawn=(command,args,options)=>{
  calls.push({command,args,options});
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.kill=()=>{throw Error('synthetic_secret_lookup_must_not_time_out');};
  child.stdin.on('finish',()=>queueMicrotask(()=>{child.stdout.end(Buffer.from(channel==='wechat'?JSON.stringify(credential):credential).toString('base64'));child.stderr.end();child.emit('close',0);}));
  return child;
 };
 syncBuiltinESMExports();
 try{
  const module=await import(new URL(channel+'-secrets.js',base));
  const owner=channel==='wechat'?new module.MacWechatSecrets():new module.MacTelegramSecrets();
  const reference=channel+'-00000000-0000-0000-0000-000000000000';
  assert.deepEqual(await owner.get(reference),credential);assert.equal(calls.length,1);
  assert.equal(calls[0].command,'/usr/bin/security');
  assert.deepEqual(calls[0].args,['find-generic-password','-s',channel==='wechat'?'Homer.Wechat.v1':'Homer.Telegram.v1','-a',reference,'-w']);
  assert.equal(calls[0].options.env?.HOME,userInfo().homedir);
  assert.equal(calls[0].options.env?.TMPDIR,'/synthetic/homer-desktop/tmp');
  assert.equal(calls[0].options.env?.PATH,process.env.PATH);
  assert.equal(process.env.HOME,'/synthetic/homer-desktop/host-home');
  assert.equal(process.env.TMPDIR,'/synthetic/homer-desktop/tmp');
 }finally{
  childProcess.spawn=originalSpawn;syncBuiltinESMExports();
  if(originalHome===undefined)delete process.env.HOME;else process.env.HOME=originalHome;
  if(originalTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=originalTmp;
 }
});
