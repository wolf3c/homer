import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {React,withDom} from './helpers/process-dom.mjs';

// Render the actual private row without adding a product export.
const require=createRequire(new URL('../package.json',import.meta.url));
const built=buildSync({stdin:{contents:readFileSync('ui/task-status.tsx','utf8')+'\nexport {TaskStatusRow};',resolveDir:resolve('ui'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','react-dom'],loader:{'.css':'empty'}});
const mod={exports:{}};Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
const {TaskStatusRow}=mod.exports;

test('work status rows show the title and status without any disclosure control',async()=>withDom(async d=>{
 await d.render(React.createElement(TaskStatusRow,{label:'合成事项',status:{state:'waiting',label:'执行状态待核实',icon:'Pause'}}));
 const row=d.find(n=>n.attrs['data-slot']==='task-status-row');
 assert.match(row.textContent,/合成事项.*执行状态待核实/);
 assert.equal(Boolean(d.find(n=>row.contains(n)&&n.attrs['aria-expanded']!==undefined)),false);
 assert.equal(Boolean(d.find(n=>row.contains(n)&&n.tagName==='BUTTON')),false);
}));
