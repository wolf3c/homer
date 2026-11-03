import {useSyncExternalStore} from 'react';
import {referenceKey,referencesOf,type ResourceReferences,type ResourceReference,type PreviewRequest} from '../src/preview-reference.js';
import type {AttachmentRef} from '../src/media-store.js';
import type {Annotation} from './vendor/agentation-3.1.2/index.mjs';

// The original composer draft's saved context, shared with its preview sibling.
// Native selections, unsaved text and geometry never enter this owner.
type HtmlMetadata=Pick<Annotation,'isFixed'|'selectedText'|'isMultiSelect'|'elementBoundingBoxes'>;
export type AnnotationDraftState=ResourceReferences&{revision:number;epoch:number;frozen?:boolean;htmlMetadata:Record<string,Record<string,HtmlMetadata>>;preparingImages?:Record<string,Extract<PreviewRequest,{kind:'image'}>>;imageAssets?:Record<string,AttachmentRef>};
export function createAnnotationDraft(){
 let state:AnnotationDraftState={revision:0,epoch:0,htmlMetadata:{}};
 const listeners=new Set<()=>void>();
 const imageFiles=new Map<string,File>();
 const publish=(next:Omit<AnnotationDraftState,'revision'>)=>{state={...next,revision:state.revision+1};listeners.forEach(fn=>fn());};
 return {
  read:()=>state,
  freeze:(frozen:boolean)=>{if(!!state.frozen!==frozen)publish({...state,frozen});},
  imageFile:(key:string,file:File)=>{const previous=imageFiles.get(key);if(previous)return previous;imageFiles.set(key,file);return file;},
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  restore:(value:ResourceReferences&{htmlMetadata?:Record<string,Record<string,HtmlMetadata>>;imageAssets?:Record<string,AttachmentRef>;preparingImages?:AnnotationDraftState['preparingImages']})=>publish({resourceReference:value.resourceReference,resourceReferences:value.resourceReferences,htmlMetadata:value.htmlMetadata??{},preparingImages:value.preparingImages,imageAssets:value.imageAssets??Object.fromEntries(referencesOf(value).flatMap(r=>r.kind==='image'?[[referenceKey(r),r.image]]:[])),epoch:state.epoch+1}),
  replace:(refs:ResourceReference[],htmlMetadata=state.htmlMetadata)=>publish({...state,resourceReference:undefined,resourceReferences:refs.length?refs:undefined,htmlMetadata}),
  prepareImage:(reference:Extract<PreviewRequest,{kind:'image'}>)=>publish({...state,preparingImages:{...state.preparingImages,[referenceKey(reference)]:structuredClone(reference)}}),
  confirmImage:(key:string,asset:AttachmentRef)=>{
   const reference=state.preparingImages?.[key];if(!reference)return;
   const refs=referencesOf(state),next={...reference,image:asset} as ResourceReference,at=refs.findIndex(r=>referenceKey(r)===key);
   const preparingImages={...state.preparingImages};delete preparingImages[key];
   publish({...state,resourceReference:undefined,resourceReferences:at<0?[...refs,next]:refs.map((r,i)=>i===at?next:r),preparingImages,imageAssets:{...state.imageAssets,[key]:asset}});
  },
  imageKeys:(file:File)=>[...imageFiles].filter(([,value])=>value===file).map(([key])=>key),
  forgetImage:(asset:AttachmentRef|undefined,keys:string[]=[])=>{
   const imageAssets={...state.imageAssets};for(const [key,value] of Object.entries(imageAssets))if(keys.includes(key)||asset&&value.assetId===asset.assetId&&value.revision===asset.revision)delete imageAssets[key];
   const preparingImages={...state.preparingImages};for(const key of keys)delete preparingImages[key];
   publish({...state,resourceReference:undefined,resourceReferences:referencesOf(state).filter(r=>!keys.includes(referenceKey(r))&&(!asset||r.kind!=='image'||r.image.assetId!==asset.assetId||r.image.revision!==asset.revision)),imageAssets,preparingImages});
  },
  clear:()=>{imageFiles.clear();publish({htmlMetadata:{},epoch:state.epoch+1});},
  remove:(key:string,id:string)=>{
   if(state.frozen)return false;
   const refs=referencesOf(state).flatMap(r=>{
    if(referenceKey(r)!==key)return [r];
    if(!r.annotations)return [];
    const annotations=r.annotations.filter(n=>n.id!==id);
    return annotations.length?[{...r,annotations} as ResourceReference]:[];
   });
   const htmlMetadata={...state.htmlMetadata};if(htmlMetadata[key]){const sourceMetadata={...htmlMetadata[key]};delete sourceMetadata[id];if(Object.keys(sourceMetadata).length)htmlMetadata[key]=sourceMetadata;else delete htmlMetadata[key];}
   const preparingImages={...state.preparingImages},pending=preparingImages[key];
   if(pending?.annotations){const annotations=pending.annotations.filter(n=>n.id!==id);if(annotations.length)preparingImages[key]={...pending,annotations};else delete preparingImages[key];}
   publish({...state,resourceReference:undefined,resourceReferences:refs.length?refs:undefined,htmlMetadata,preparingImages});return true;
  },
 };
}
export type AnnotationDraft=ReturnType<typeof createAnnotationDraft>;
export const useAnnotationDraft=(draft:AnnotationDraft)=>useSyncExternalStore(draft.subscribe,draft.read,draft.read);

// Use the existing strict image parser before its upload has an asset identity.
// This local-only sentinel is never stored, rendered as an attachment or sent.
export function annotationValidationReferences(state:AnnotationDraftState):ResourceReference[]{
 const pending=state.preparingImages??{};
 return [...referencesOf(state).filter(r=>!pending[referenceKey(r)]),...Object.values(pending).map(r=>({...r,image:{assetId:'asset-00000000-0000-4000-8000-000000000000',revision:1}} as ResourceReference))];
}
