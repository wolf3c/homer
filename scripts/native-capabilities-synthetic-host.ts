// Explicit synthetic candidate. Native protocol/MCP/files are real; Agent
// decisions below are scripted. No provider turn, account or real channel.
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {handleMcp} from '../tests/fixtures/native-capability-mcp.mjs';
import {Homer} from '../src/service.js';
import {CodexEngine,type EngineOptions,type ToolCall,type TurnResult} from '../src/engine.js';
import {createWebServer} from '../src/web-server.js';
import {homerWebBridge} from '../src/web-homer.js';
const root=resolve('.codex/scratch/native-capabilities-implementation');mkdirSync(root,{recursive:true});
const data=process.argv[2]?resolve(process.argv[2]):mkdtempSync(join(root,'synthetic-host-'));if(!data.startsWith(root+'/synthetic-host-'))throw Error('synthetic_data_path_required');
const config={appData:data,codexHome:join(data,'codex'),codexBin:resolve('.codex/private/engines/codex-0.163.0/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'),workspace:join(data,'workspace'),runtime:join(data,'runtime'),model:'gpt-6.1-sol',effort:'medium' as const,requiresOpenaiAuth:false,timeoutMs:3000,mainTimeoutMs:30000,stopGraceMs:1000};mkdirSync(config.workspace,{recursive:true});mkdirSync(config.runtime,{recursive:true});
let seq=0;
class SyntheticEngine extends CodexEngine{
 async start(){const id=await super.start();if(!this.resumable){await this.request('thread/inject_items',{threadId:id,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Homer synthetic capabilities UI candidate only. No model execution.'}]}]});this.resumable=true;}return id;}
 async turn(text:string,options?:{onStarted?:(id:string)=>void;skills?:{name:string;path:string}[]}):Promise<TurnResult>{
  this.turnId='synthetic-capability-turn-'+ ++seq;options?.onStarted?.(this.turnId);
  const tool=async(input:any)=>{const result=await this.request('mcpServer/tool/call',{threadId:this.threadId,server:'homer_interactions',tool:'capabilities',arguments:input});if(result.isError)throw Error(result.content[0].text);return JSON.parse(result.content[0].text);};
  let usage:TurnResult['usage'];
  let reply='这是合成验收入口，不调用真实模型或账号。可发送“保存示例 Skill”“修正示例 Skill”“停用示例 Skill”“启用示例 Skill”“查看 MCP”。';
  if(text.startsWith('保存示例 Skill')){await tool({action:'skill_save',name:'meeting-actions',description:'整理行动清单，保留未知日期',body:'未给日期须标待确认。',expectedHash:null});reply='示例 Skill 已通过同一个 Homer 对话写入专属 SKILL.md，并经原生发现。';}
  else if(text.startsWith('修正示例 Skill')){const old=await tool({action:'skill_read',name:'meeting-actions'});await tool({action:'skill_save',name:'meeting-actions',description:'整理行动清单，保留未知负责人和日期',body:'未给日期及负责人须标待确认。',expectedHash:old.hash});reply='示例 Skill 已修正；原生文件为唯一正文。';}
  else if(/^(停用|启用)示例 Skill/.test(text)){const state=await tool({action:'state'});await tool({action:'skill_toggle',name:'meeting-actions',enabled:text.startsWith('启用'),expectedVersion:state.version});reply='示例 Skill 启停已由原生配置确认。';}
  else if(text.startsWith('查看 MCP')){const state=await tool({action:'state'});reply='当前已配置：'+(state.servers.map((s:any)=>s.name).join('、')||'尚无 MCP')+'。可在同一对话交办能力操作';}
  else if(/^调用合成 MCP (stdio|http)$/.test(text)){const server=text.split(' ').at(-1)!;const called=await this.request('mcpServer/tool/call',{threadId:this.threadId,server,tool:'echo',arguments:{text:'homer-conversation'}});if(called.isError)throw Error('synthetic_mcp_call_failed');reply=called.content[0].text;}
  else if(text==='演示用量'){usage={total:{totalTokens:120,inputTokens:100,cachedInputTokens:40,outputTokens:20,reasoningOutputTokens:10},last:{totalTokens:12,inputTokens:10,outputTokens:2}};this.emit('usage',usage);reply='这是脚本生成的合成用量，用于核对网页展示；未调用模型，不是实际消耗。';}
  else if(options?.skills?.length)reply='合成主轮已通过原生 UserInput.skill 选择：'+options.skills.map(s=>s.name).join('、')+'。模型理解需另行验收。';
  return {status:'completed',text:reply,usage};
 }
}
const mockOrigin='http://127.0.0.1:4798';
const mock=createServer(async(req,res)=>{
 const u=new URL(req.url!,mockOrigin),json=(v:any)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
 if(u.pathname==='/.well-known/oauth-protected-resource')return json({resource:mockOrigin+'/protected',authorization_servers:[mockOrigin],scopes_supported:['echo']});
 if(u.pathname==='/.well-known/oauth-authorization-server')return json({issuer:mockOrigin,authorization_endpoint:mockOrigin+'/authorize',token_endpoint:mockOrigin+'/token',registration_endpoint:mockOrigin+'/register',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none']});
 if(u.pathname==='/register'){let raw='';for await(const c of req)raw+=c;return json({...JSON.parse(raw),client_id:'homer-synthetic-ui',token_endpoint_auth_method:'none'});}
 if(u.pathname==='/authorize'){const target=new URL(u.searchParams.get('redirect_uri')!);if(target.hostname!=='127.0.0.1'&&target.hostname!=='localhost'){res.writeHead(400);return res.end();}target.searchParams.set('code','synthetic-ui-code');target.searchParams.set('state',u.searchParams.get('state')!);res.writeHead(302,{Location:target.toString()});return res.end();}
 if(u.pathname==='/token')return json({access_token:'synthetic-ui-local-only-token',token_type:'Bearer',expires_in:3600,scope:'echo'});
 if(u.pathname==='/protected'&&req.headers.authorization!=='Bearer synthetic-ui-local-only-token'){res.writeHead(401,{'WWW-Authenticate':`Bearer resource_metadata="${mockOrigin}/.well-known/oauth-protected-resource"`});return res.end();}
 if(req.method==='GET'){res.writeHead(405);return res.end();}if(req.method==='DELETE'){res.writeHead(200);return res.end();}
 let raw='';for await(const c of req)raw+=c;try{const m=JSON.parse(raw);if(m.id===undefined){res.writeHead(202);return res.end();}json({jsonrpc:'2.0',id:m.id,result:handleMcp(m)});}catch{res.writeHead(400);res.end();}
});await new Promise<void>(r=>mock.listen(4798,'127.0.0.1',r));
let web:Awaited<ReturnType<typeof createWebServer>>|undefined;
const app=new Homer(config,async()=>{await web?.publish();},(options:EngineOptions,handler:(call:ToolCall)=>Promise<unknown>)=>new SyntheticEngine(config,options,handler));await app.start();
web=await createWebServer({bridge:homerWebBridge(app),port:4797,uiDirectory:resolve('dist/web'),logoPath:resolve('assets/branding/homer-hippo-cool-icon-256.png')});const timer=setInterval(()=>web?.publish(),250);
writeFileSync(join(root,'synthetic-candidate-location.json'),JSON.stringify({url:web.url,data,classification:'native protocol with scripted Agent; no real model or account'},null,2));console.log(web.url+' · 合成验收入口');for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{clearInterval(timer);await web?.close();await app.close();await new Promise<void>(r=>mock.close(()=>r()));process.exit(0);});
