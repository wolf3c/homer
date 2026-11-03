#!/usr/bin/env node
import {createInterface} from 'node:readline';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 let result={};
 if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}};
 if(m.method==='tools/list')result={tools:[{name:'synthetic_echo',description:'Echo synthetic acceptance value',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};
 if(m.method==='tools/call')result={content:[{type:'text',text:'synthetic_invoked'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
});
