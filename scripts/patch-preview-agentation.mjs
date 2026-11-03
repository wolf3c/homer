import {draftEdits,draftTypeEdits} from './preview-agentation-draft-patch.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const dir=fileURLToPath(new URL('../ui/vendor/agentation-3.1.2/',import.meta.url));
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const edits={
 'index.mjs':[
 ['  const activeState = useState11(false);','  const activeState = useState11(props.defaultActive ?? false);'],
 ['  activeState,\n  portalHost,','  activeState,\n  onActiveChange,\n  portalHost,'],
 ['  if (!mounted) return null;\n  if (isToolbarHidden) return null;', '  useEffect8(() => {\n    if (mounted) onActiveChange?.(isActive && !isToolbarHidden);\n  }, [isActive, isToolbarHidden, mounted, onActiveChange]);\n  if (!mounted) return null;\n  if (isToolbarHidden) return null;'],
 ['//# sourceMappingURL=index.mjs.map','// Demo-local modified source: see MODIFIED-SOURCE.md; upstream map is not used.']
 ],
 'index.d.ts':[
 ['type PageFeedbackToolbarCSSProps = {','type PageFeedbackToolbarCSSProps = {\n    /** Demo-local patch: initial selection state; defaults to false. */\n    defaultActive?: boolean;\n    /** Demo-local patch: committed initial state and native selection changes; no unmount event. */\n    onActiveChange?: (active: boolean) => void;']
 ]
};
edits['index.mjs'].push(...draftEdits);edits['index.d.ts'].push(...draftTypeEdits);
export function patched(name,source){for(const [before,after,count=1] of edits[name]){assert.equal(source.split(before).length,count+1,'exact unique patch anchor: '+name+': '+before.slice(0,70));source=source.replaceAll(before,after);}return source;}
export function verifyInputs(){const lock=JSON.parse(readFileSync(dir+'INPUT-SHA256.json'));for(const [path,expected] of Object.entries(lock.inputs))assert.equal(hash(readFileSync(resolve(dir,'../../../',path))),expected,'fixed installed input: '+path);for(const name of ['index.mjs','index.d.ts','package.json','LICENSE']){const path=name.startsWith('index.')?'dist/'+name:name;assert.equal(hash(readFileSync(dir+'upstream/'+name)),lock.inputs['node_modules/agentation/'+path]);}return lock;}
export function verifyVendor(){verifyInputs();for(const name of Object.keys(edits)){const original=readFileSync(dir+'upstream/'+name,'utf8');assert.equal(readFileSync(dir+name,'utf8'),patched(name,original),'only deterministic allowed patch: '+name);}assert.equal(readFileSync(dir+'index.d.mts','utf8'),readFileSync(dir+'index.d.ts','utf8'));assert.equal(readFileSync(dir+'LICENSE','utf8'),readFileSync(dir+'upstream/LICENSE','utf8'));}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){verifyInputs();for(const name of Object.keys(edits))writeFileSync(dir+name,patched(name,readFileSync(dir+'upstream/'+name,'utf8')));writeFileSync(dir+'index.d.mts',readFileSync(dir+'index.d.ts'));verifyVendor();console.log('Applied approved Agentation 3.1.2 patch; shared package unchanged.');}
