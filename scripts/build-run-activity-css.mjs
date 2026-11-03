import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'ui/package.json'));
const component=['tool-fallback','quote','attachment','image-file','approval-card','sources','canvas-split','question-flow'].find(name=>process.argv.includes('--'+name))??'run-activity';
const flag=component==='run-activity'?'':' --'+component;
const postcss=require('postcss'),vendor=join(root,'ui/vendor/assistant-ui'),scratch=join(root,component==='tool-fallback'?'.codex/scratch/run-activity-official-tool-implementation-20261025/css':component==='canvas-split'?'.codex/scratch/official-canvas-reuse-20261023/css':component==='sources'?'.codex/scratch/official-sources-legacy-activity-20261023/css':component==='approval-card'?'.codex/scratch/approval-card-official-20261023/css':'.codex/scratch/'+component+'-css');
await mkdir(scratch,{recursive:true});
const raw=join(scratch,'compiled.css'),cli=join(dirname(require.resolve('@tailwindcss/cli/package.json')),'dist/index.mjs');
execFileSync(process.execPath,[cli,'-i',join(vendor,component+'.source.css'),'-o',raw],{cwd:root,stdio:'pipe'});
const sheet=postcss.parse(await readFile(raw,'utf8'));
// Scope the generated rules, including preflight, to this component only.
// Unlayer utilities so global button rules cannot replace them; keep preflight
// in its base layer so it cannot override the caller's activity/card content.
sheet.walkAtRules('layer',rule=>{if(rule.params==='base')return;if(rule.nodes)rule.replaceWith(...rule.nodes);else rule.remove();});
sheet.walkRules(rule=>{
 let parent=rule.parent,base=false;while(parent){if(parent.type==='atrule'&&parent.name==='keyframes')return;if(parent.type==='atrule'&&parent.name==='layer'&&parent.params==='base')base=true;parent=parent.parent;}
 if(rule.selector.includes('&'))return;
 const scope=component==='tool-fallback'?'[data-slot="tool-fallback-root"]':component==='question-flow'?':is([data-slot="question-flow"],[data-slot="option-list"],[data-slot="elicitation-form"])':component==='canvas-split'?':is([data-slot="canvas-split-document"],[data-slot="web-preview"])':component==='sources'?'[data-slot="sources"]':component==='approval-card'?'[data-slot="approval-card"]':component==='image-file'?':is([data-slot="image-root"],[data-slot="image-zoom-overlay"],[data-slot="file-root"],[data-slot="file-list"])':component==='attachment'?':is(.aui-attachment-root,.aui-composer-attachments,.aui-attachment-surface)':component==='quote'?':is([data-slot="quote-block"],[data-slot="composer-quote"],[data-slot="selection-toolbar"])':'[data-slot="run-activity"]';
 rule.selectors=rule.selectors.flatMap(selector=>{
  if(component==='question-flow'&&/^\[data-slot="(?:question-flow|option-list|elicitation-form)"\]/.test(selector))return [selector];
  if(['approval-card','sources','tool-fallback'].includes(component)&&selector.startsWith(scope))return [selector];
  if([':root',':host','html','body'].includes(selector))return [scope];
  // Entry content belongs to its renderer, including native Markdown defaults.
  if(base&&component==='run-activity'){const at=selector.indexOf('::'),end=at<0?selector.length:at;selector=selector.slice(0,end)+':not(:where([data-activity-kind] *))'+selector.slice(end);}
  if(selector.includes('::'))return selector.startsWith('::')?[scope+' '+selector,scope+selector]:[scope+' '+selector];
  return [scope+' '+selector,scope+':is('+selector+')'];
 });
});
const css='/* Generated from pinned official utilities. Run node scripts/build-run-activity-css.mjs'+flag+'. */\n'+sheet.toString();
if(process.argv.includes('--check')){
 if(await readFile(join(vendor,component+'.css'),'utf8')!==css)throw Error(component+'_css_stale: run node scripts/build-run-activity-css.mjs'+flag);
}else await writeFile(join(vendor,component+'.css'),css);
console.log('Official '+(component==='run-activity'?'Run Activity':component)+' CSS compiled and scoped');
