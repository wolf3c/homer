import './fixtures/synthetic-home.mjs';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {isAbsolute, join, resolve} from 'node:path';
import {test} from 'node:test';
import sharp from 'sharp';
import {CodexEngine, codexVersion} from '../src/engine.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('fixed engine delivers local images from private storage and recovers their history', {timeout: 60000}, async t => {
  const binary = process.env.HOMER_TEST_CODEX_BIN;
  assert.ok(binary && isAbsolute(binary), 'set HOMER_TEST_CODEX_BIN to the pinned executable');
  assert.equal(codexVersion(binary), 'codex-cli 0.171.0-alpha.7');
  const root = mkdtempSync(resolve('.codex/scratch/attachment-native-'));
  const cwd = join(root, 'workspace'), home = join(root, 'codex'), media = join(root, 'runtime/media');
  for (const dir of [cwd, home, media]) mkdirSync(dir, {recursive: true, mode: 0o700});
  writeFileSync(join(home, 'config.toml'), '[features]\napps=false\nplugins=false\nskip_host_skill_discovery=true\n[memories]\ngenerate_memories=false\nuse_memories=false\n');

  const requests: {hashes: string[]; texts: string[]}[] = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/v1/responses' || req.method !== 'POST') { res.writeHead(403).end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const data = JSON.parse(Buffer.concat(chunks).toString());
    if (data.client_metadata?.['x-openai-subagent']) { res.writeHead(403).end(); return; }
    const hashes: string[] = [], texts: string[] = [];
    for (const message of data.input) {
      if (message.role !== 'user' || !Array.isArray(message.content)) continue;
      for (const item of message.content) {
        if (item.type === 'input_image') hashes.push(digest(Buffer.from(item.image_url.split(',')[1], 'base64')));
        if (item.type === 'input_text') texts.push(item.text);
      }
    }
    requests.push({hashes, texts});
    const n = requests.length;
    const item = {type:'message', id:'msg-'+n, role:'assistant', phase:'final_answer', content:[{type:'output_text',text:'Synthetic reply.',annotations:[]}]};
    const response = {id:'resp-'+n,object:'response',status:'completed',model:data.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
    res.setHeader('Content-Type', 'text/event-stream');
    for (const event of [
      {type:'response.created',response:{...response,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:{...item,content:[]}},
      {type:'response.output_item.done',output_index:0,item}, {type:'response.completed',response},
    ]) res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
    res.end();
  });
  server.on('connect', (_request, socket) => socket.destroy());
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:'+(server.address() as {port:number}).port;
  const proxies = ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','NO_PROXY','no_proxy'];
  const saved = proxies.map(key => process.env[key]);
  for (const key of proxies) process.env[key] = key.toLowerCase() === 'no_proxy' ? '127.0.0.1,localhost' : origin;
  let engine: CodexEngine;
  t.after(async () => {
    const stopped = !engine || await engine.close();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    proxies.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    assert.ok(stopped);
    rmSync(root, {recursive:true,force:true});
  });

  const open = async (threadId?: string) => {
    engine = new CodexEngine({workspace:cwd,runtime:join(root,'runtime'),codexHome:home,nativeCodexHome:home,codexBin:binary,baseUrl:origin+'/v1',model:'gpt-6.1-sol',requiresOpenaiAuth:false,stopGraceMs:1500},
      {cwd,threadId,role:'main',nativeTools:'main',readRoots:[cwd],instructions:'Synthetic attachment check.',tools:[]}, async () => { throw Error('unexpected tool'); });
    return engine.start();
  };
  const threadId = await open();
  async function turn(marker: string, paths: string[] = []) {
    const result = await engine.turn(marker,{images:paths.map(path=>({path}))});
    assert.equal(result.status,'completed');
    const {thread} = await engine.request('thread/read',{threadId,includeTurns:true});
    assert.equal(thread.turns.at(-1)?.status,'completed');
    const request=requests.findLast(request=>request.texts.includes(marker));
    assert.ok(request,'loopback provider must receive this user input');
    return request;
  }

  const jpeg = await sharp({create:{width:31,height:19,channels:3,background:'red'}}).jpeg().toBuffer();
  const png = await sharp({create:{width:19,height:31,channels:3,background:'blue'}}).png().toBuffer();
  const paths = [join(media,'asset-合成 1'),join(media,'asset-2')];
  writeFileSync(paths[0]!,jpeg); writeFileSync(paths[1]!,png);
  const first = await turn('ordered private images',paths);
  assert.deepEqual(first.hashes,[digest(jpeg),digest(png)]);
  assert.ok(await engine!.close());
  assert.equal(await open(threadId),threadId);
  assert.deepEqual((await turn('resume retained')).hashes,first.hashes);
  assert.ok(await engine!.close());
  for (const path of paths) rmSync(path);
  assert.equal(await open(threadId),threadId);
  assert.deepEqual((await turn('resume after removal')).hashes,first.hashes);

  const gif = await sharp(randomBytes(16*32*3),{raw:{width:16,height:32,channels:3,pageHeight:16}}).gif().toBuffer();
  assert.equal((await sharp(gif,{animated:true}).metadata()).pages,2);
  writeFileSync(paths[0]!,gif);
  const gifRequest = await turn('gif fixture',[paths[0]!]);
  assert.equal(gifRequest.hashes.length,first.hashes.length+1);
  const broken = join(media,'broken');
  const unsupported=join(media,'unsupported');
  writeFileSync(unsupported,await sharp(png).tiff().toBuffer());
  writeFileSync(broken,Buffer.from([137,80,78,71,13,10,26,10]));
  const deniedPaths=[broken,unsupported,join(media,'missing')];
  if(process.platform!=='win32'&&process.getuid?.()!==0){
    const unreadable=join(media,'unreadable');writeFileSync(unreadable,jpeg);chmodSync(unreadable,0);
    deniedPaths.push(unreadable);
  }
  const unavailable = await turn('unavailable image fixtures',deniedPaths);
  assert.deepEqual(unavailable.hashes,gifRequest.hashes);
  const large = await sharp(randomBytes(1024*1024*3), {raw:{width:1024,height:1024,channels:3}}).png().toBuffer();
  assert.ok(large.length>2*1024*1024);
  writeFileSync(paths[0]!,large);
  const orderedLarge=Array<string>(11).fill(paths[0]!);
  const last = await turn('large images and thread history',orderedLarge);
  assert.deepEqual(last.hashes.slice(gifRequest.hashes.length),orderedLarge.map(()=>digest(large)));
  assert.ok(await engine!.close());
  assert.equal(await open(threadId),threadId);
  assert.deepEqual((await turn('recover large image')).hashes,last.hashes);
});
