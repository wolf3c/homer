// Offline build only. Never registers assets in a live launcher or edits a
// frozen build. This patch applies solely to the verified daily UI baseline.
import {resolve,join,dirname} from 'node:path';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {sourceSnapshot,buildUiCandidate,dependencyHash,uiHash} from './dev-build.mjs';
const original=process.argv[2];if(!original)throw Error('frozen_ui_source_argument_required');
const expected={ui:'6bb20b7f14f5d1d372c70c31f919a256fa4e0a1b0b61fc641a8d32bbf48100d5',gateway:'98a8d410b28ce10eeca8434238355a878cd983868294abcb07da46ca365c2b4a',deps:'6ec82c3861e35ea215327c670026ca067320f4f5602a70bc38b93e198ba8a712'};
const before=sourceSnapshot(resolve(original));const gatewayHash=createHash('sha256').update(Buffer.concat(['src/web-server.ts','src/web-contract.ts'].map(p=>before.files.get(p)))).digest('hex');
if(uiHash(before)!==expected.ui||gatewayHash!==expected.gateway||dependencyHash(before)!==expected.deps)throw Error('frozen_daily_ui_baseline_mismatch');
const scratch=resolve('.codex/scratch/native-capabilities-implementation');mkdirSync(scratch,{recursive:true});const root=mkdtempSync(join(scratch,'stop-icon-rebuild-'));
for(const [p,b]of before.files){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),b);}symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
const path=join(root,'ui/homer-app.tsx'),content=readFileSync(path,'utf8');
const old=`className="stop-button" aria-label="停止当前回复" disabled={!!stopping||!connected} onClick={onStop}>{stopping?'停止待确认…':'■ 停止回复'}`;
const replacement=`className="stop-button" aria-label="停止回复" title="停止回复" aria-busy={!!stopping} disabled={!!stopping||!connected} onClick={onStop}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>`;
if(content.split(old).length!==2)throw Error('baseline_button_mismatch');writeFileSync(path,content.replace(old,replacement));const css=join(root,'ui/homer-styles.css');writeFileSync(css,readFileSync(css,'utf8')+'\n.stop-button{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;padding:0;flex-shrink:0}.stop-button svg{display:block}\n');
const after=sourceSnapshot(root),changed=[...after.files].filter(([p,b])=>!b.equals(before.files.get(p))).map(([p])=>p).sort();if(JSON.stringify(changed)!==JSON.stringify(['ui/homer-app.tsx','ui/homer-styles.css']))throw Error('patch_scope_mismatch');
const result=await buildUiCandidate(root,undefined,after,{deps:expected.deps,webProtocol:1,gatewayHash});
const manifest={classification:'verified baseline UI patch, offline only, not deployed',baseUiHash:expected.ui,patchUiHash:result.uiHash,gatewayHash,dependencyHash:expected.deps,webProtocol:1,changedFiles:changed,sourceRoot:root,candidate:result.directory,rollbackUiHash:expected.ui};writeFileSync(join(root,'stop-icon-patch-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));
