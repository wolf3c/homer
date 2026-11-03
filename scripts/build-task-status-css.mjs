import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import {resolve,dirname,join} from 'node:path';
import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'ui/package.json'));
const postcss=require('postcss'),vendor=join(root,'ui/vendor/task-status'),scratch=join(root,'.codex/scratch/task-status-css');
await mkdir(scratch,{recursive:true});const raw=join(scratch,'compiled.css');
const cli=join(dirname(require.resolve('@tailwindcss/cli/package.json')),'dist/index.mjs');
execFileSync(process.execPath,[cli,'-i',join(vendor,'source.css'),'-o',raw],{cwd:root,stdio:'pipe'});
const sheet=postcss.parse(await readFile(raw,'utf8'));
sheet.walkAtRules('layer',rule=>{if(rule.nodes)rule.replaceWith(...rule.nodes);else rule.remove();});
const frames=new Map();sheet.walkAtRules('keyframes',rule=>{const old=rule.params;rule.params='homer-task-status-'+old;frames.set(old,rule.params);});
// Rename keyframe identifiers, never --animate-* variable references.
sheet.walkDecls(decl=>{if(decl.prop.includes('animation')||decl.prop.startsWith('--animate'))for(const [old,next]of frames)decl.value=decl.value.replace(new RegExp('(?<![\\w-])'+old+'(?![\\w-])','g'),next);});
sheet.walkRules(rule=>{
 let parent=rule.parent;while(parent){if(parent.type==='atrule'&&parent.name==='keyframes')return;parent=parent.parent;}
 if(rule.selector.includes('&'))return;
 rule.selectors=rule.selectors.flatMap(selector=>{
  if(selector===':root'||selector===':host'||selector==='html'||selector==='body'){
   // Homer header currently has a fixed light surface. Only the floating
   // component adopts the official dark palette; do not paint a dark rectangle
   // over the existing header when the OS changes appearance.
   let dark=false,ancestor=rule.parent;while(ancestor){if(ancestor.type==='atrule'&&ancestor.name==='media'&&/prefers-color-scheme:\s*dark/.test(ancestor.params))dark=true;ancestor=ancestor.parent;}
   return [dark?'.homer-task-status:not(.header-brand-status)':'.homer-task-status'];
  }
  // Pseudo-elements are invalid inside :is().
  if(selector.includes('::'))return selector.startsWith('::')?['.homer-task-status '+selector,'.homer-task-status'+selector]:['.homer-task-status '+selector];
  return ['.homer-task-status '+selector,'.homer-task-status:is('+selector+')'];
 });
});
await writeFile(join(vendor,'components.css'),'/* Generated from pinned official utilities. Run node scripts/build-task-status-css.mjs. */\n'+sheet.toString());
console.log('Official task status CSS compiled and scoped');
