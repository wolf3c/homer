#!/usr/bin/env node
// Synthetic account lifecycle, no OAuth network, real credentials or model turn.
import{createInterface}from'node:readline';import{existsSync,readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
const home=process.env.CODEX_HOME,file=join(home,'synthetic-account-state.json'),send=value=>process.stdout.write(JSON.stringify(value)+'\n');let login;
const account=()=>existsSync(file)&&JSON.parse(readFileSync(file)).connected?{type:'chatgpt',email:'SYNTHETIC_PRIVATE_EMAIL',planType:'plus'}:null;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==='initialize')result={userAgent:'homer-fixture/0.163.0 ',codexHome:home};
else if(m.method==='config/read')result={config:{mcp_servers:{}},layers:[{name:{type:'user',file:join(home,'config.toml')},version:'synthetic-version',config:{}}]};
else if(m.method==='skills/list')result={data:[]};
else if(m.method==='account/read')result={account:account(),requiresOpenaiAuth:true};
else if(m.method==='account/login/start'){login='synthetic-login';result={type:'chatgpt',loginId:login,authUrl:'http://127.0.0.1:4807/synthetic-account-authorize'};}
else if(m.method==='account/login/cancel'){result={status:login===m.params.loginId?'canceled':'notFound'};login=undefined;}
else if(m.method==='account/logout'){writeFileSync(file,JSON.stringify({connected:false}));}
else if(m.method==='synthetic/complete'){writeFileSync(file,JSON.stringify({connected:m.params.success}));send({method:'account/login/completed',params:{loginId:login??'stale',success:m.params.success,error:'SYNTHETIC_PRIVATE_SERVER_BODY'}});login=undefined;}
else if(m.method==='synthetic/status')result={loginPending:!!login};
else return send({id:m.id,error:{code:-32601,message:'synthetic_unsupported'}});
send({id:m.id,result});});
