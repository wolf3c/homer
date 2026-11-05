import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real development bridge object without starting Homer or loading config.
const source=readFileSync(new URL('../scripts/dev.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile('dev.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let initializer;
function visit(node){
 if(ts.isPropertyAssignment(node)&&node.name.getText(ast)==='taskOverview'){
  assert.equal(initializer,undefined,'one development task bridge');
  initializer=node.initializer.getText(ast);
 }
 ts.forEachChild(node,visit);
}
visit(ast);
assert.ok(initializer,'development bridge declares task overview');
for(const [name,args,input] of [
 ['list',[],undefined],
 ['progress',['synthetic-root'],{id:'synthetic-root'}],
 ['detail',['synthetic-root'],{id:'synthetic-root'}],
 ['detail',['synthetic-task',{workerId:'synthetic-worker',after:20}],{id:'synthetic-task',workerId:'synthetic-worker',after:20}],
 ['summary',['synthetic-root'],{id:'synthetic-root'}],
 ['origin',['synthetic-root','synthetic-message'],{id:'synthetic-root',messageId:'synthetic-message'}],
])test('development task overview '+name+' passes its exact read request',()=>{
 const calls=[];
 const bridge=vm.runInNewContext('('+initializer+')',{invokeWeb:(...args)=>{calls.push(args);return 'synthetic-read';}});
 assert.equal(bridge[name](...args),'synthetic-read');
 assert.equal(calls.length,1);
 const expected=input===undefined?['taskOverview.'+name]:['taskOverview.'+name,input];
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),expected);
});
