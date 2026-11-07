import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnnotationDraft,annotationValidationReferences} from '../ui/annotation-draft.js';
import {referenceKey,referencesOf,parseResourceReferences,type ResourceReference} from '../src/preview-reference.js';
const source={kind:'attachment' as const,messageId:'message-synthetic-draft',assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1,sha256:'a'.repeat(64),title:'Synthetic.png'};
const notes=[{id:'one',region:{x:1,y:1,width:3,height:3},comment:'First'},{id:'two',region:{x:5,y:1,width:3,height:3},comment:'Second'}];
const image={kind:'image' as const,source,width:10,height:10,annotations:notes};
const asset={assetId:'asset-00000000-0000-4000-8000-000000000001',revision:1};

test('preparing original, independent note removal, confirmation and discard share the draft lifecycle',()=>{
 const draft=createAnnotationDraft(),key=referenceKey(image),file=new File(['synthetic'],'Synthetic.png');
 assert.equal(draft.imageFile(key,file),file);assert.equal(draft.imageFile(key,new File(['other'],'Synthetic.png')),file);
 draft.prepareImage(image);assert.equal(referencesOf(draft.read()).length,0);
 assert.equal(parseResourceReferences(annotationValidationReferences(draft.read()))[0]!.annotations!.length,2);
 draft.remove(key,'one');draft.confirmImage(key,asset);
 const ref=referencesOf(draft.read())[0]!;assert.equal(ref.annotations![0]!.id,'two');assert.equal(draft.read().preparingImages?.[key],undefined);
 draft.remove(key,'two');assert.equal(referencesOf(draft.read()).length,0);assert.deepEqual(draft.read().imageAssets?.[key],asset);
 draft.forgetImage(asset,[key]);assert.equal(draft.read().imageAssets?.[key],undefined);
});
test('late upload after delete or new draft cannot recreate notes; freeze preserves the ordinary draft',()=>{
 const draft=createAnnotationDraft(),key=referenceKey(image);
 draft.prepareImage({...image,annotations:notes.slice(0,1)});draft.remove(key,'one');draft.confirmImage(key,asset);assert.equal(referencesOf(draft.read()).length,0);
 draft.prepareImage(image);const epoch=draft.read().epoch;draft.clear();draft.confirmImage(key,asset);
 assert.ok(draft.read().epoch>epoch);assert.equal(referencesOf(draft.read()).length,0);
 draft.replace([{...image,image:asset}]);draft.freeze(true);assert.equal(draft.remove(key,'one'),false);assert.equal(referencesOf(draft.read())[0]!.annotations!.length,2);
 draft.freeze(false);draft.remove(key,'one');assert.equal(referencesOf(draft.read())[0]!.annotations!.length,1);
});
test('restore keeps the exact legacy wire and only confirmed renderer metadata; source hashes remain isolated',()=>{
 const draft=createAnnotationDraft(),legacy:ResourceReference={kind:'text',source:{...source,title:'Synthetic.txt'},text:'Legacy excerpt'};
 draft.restore({resourceReference:legacy});assert.deepEqual(draft.read().resourceReference,legacy);assert.equal(draft.read().resourceReferences,undefined);
 const second=createAnnotationDraft();assert.equal(referencesOf(second.read()).length,0);
 assert.notEqual(referenceKey(legacy),referenceKey({...legacy,source:{...source,title:'Synthetic.txt',sha256:'b'.repeat(64)}}));
 const serialized=JSON.parse(JSON.stringify(draft.read()));assert.equal('file' in serialized,false);assert.deepEqual(serialized.resourceReference,legacy);
});
