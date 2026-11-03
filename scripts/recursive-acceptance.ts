// Explicit synthetic acceptance entry: one real Homer and HTTP host, no account,
// no Codex process, no native tools or channel clients. Business state is local.
import {resolve,join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {syntheticHost} from './recursive-synthetic-host.js';
import {homerWebBridge} from '../src/web-homer.js';
import {createWebServer} from '../src/web-server.js';
const partial=process.argv.includes('--partial'),port=Number(process.env.HOMER_SYNTHETIC_PORT??4788);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('synthetic_port_invalid');
const fixture=syntheticHost(partial,true);fixture.app.config.mainTimeoutMs=600000;
await fixture.app.start();
fixture.app.history.add(fixture.app.store.meta('mainThread')!,'这是独立的合成验收服务，不连接日常聊天、Codex 账号或微信。\n\n发送“运行递归合成案例”查看 A/B/C 协作及正式成果；发送“开始长回复合成验收”后，可连续排队、编辑、撤回、停止或打断并发送。\n\n合成引擎用于检查宿主流程，不代表真实模型验收通过。','completed');
const server=await createWebServer({bridge:homerWebBridge(fixture.app),port,uiDirectory:resolve('.codex/scratch/recursive-agent-implementation/acceptance-web'),logoPath:resolve('assets/branding/homer-hippo-cool-icon-256.png')});
const timer=setInterval(()=>void server.publish(),100);timer.unref();
const receipt={synthetic:true,url:server.url,pid:process.pid,runtime:fixture.root,realModel:false,channels:false};
writeFileSync(join(fixture.root,'synthetic-service-receipt.json'),JSON.stringify(receipt,null,2));
process.stdout.write(JSON.stringify(receipt)+'\n');
let closing=false;async function close(){if(closing)return;closing=true;clearInterval(timer);await server.close();await fixture.close();process.exitCode=0;}
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
// Only this explicit synthetic process exposes a local signal for SSE reconnect checks.
process.on('SIGUSR1',()=>server.disconnectClients());
