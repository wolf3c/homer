import type {AttachmentRef} from './media-store.js';

export type PreviewSource =
 | ({kind:'attachment';messageId:string;sha256:string;title:string}&AttachmentRef)
 | {kind:'web';messageId:string;sourceId:string;url:string;title:string};
export type PreviewRegion={x:number;y:number;width:number;height:number};
export type PreviewAnnotation={id:string;element:string;elementPath:string;comment:string;x:number;y:number;boundingBox?:PreviewRegion};
// Offsets count UTF-16 code units in the renderer's versioned logical text flow.
export type PreviewTextAnchor={format:'preview-text-v1';representation:'plain'|'markdown';start:number;end:number;exact:string;prefix:string;suffix:string};
export type PreviewTextAnnotation={id:string;text:string;comment:string;anchor?:PreviewTextAnchor};
export type PreviewImageAnnotation={id:string;region:PreviewRegion;comment:string};
export type WindowAXNode={role:string;name?:string;value?:string};
type PreviewReference =
 | {kind:'text';source:PreviewSource;text:string;annotations?:never}
 | {kind:'text';source:PreviewSource;annotations:PreviewTextAnnotation[];text?:never}
 | {kind:'image';source:PreviewSource;width:number;height:number;region:PreviewRegion;comment:string;image:AttachmentRef;annotations?:never}
 | {kind:'image';source:PreviewSource;width:number;height:number;annotations:PreviewImageAnnotation[];image:AttachmentRef;region?:never;comment?:never}
 | {kind:'web';source:PreviewSource;annotations:PreviewAnnotation[]};
export type DraftImageReference={kind:'image';source:{kind:'draft-image'};width:number;height:number;image:AttachmentRef;annotations:PreviewImageAnnotation[];ax?:WindowAXNode[];region?:never;comment?:never};
export type ResourceReference=PreviewReference|DraftImageReference;

type WithoutImage<T>=T extends {kind:'image'}?Omit<T,'image'>:T;
export type PreviewRequest=WithoutImage<PreviewReference>;
export const isDraftImageReference=(reference:ResourceReference|PreviewRequest):reference is DraftImageReference=>reference.source.kind==='draft-image';

const invalid=():never=>{throw Error('invalid_resource_reference');};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:invalid();
const text=(value:unknown,max=16000):string=>typeof value==='string'&&!!value.trim()&&value.length<=max?value:invalid();
const number=(value:unknown):number=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:invalid();
function textAnchor(value:unknown):PreviewTextAnchor{
 const a=object(value),start=number(a.start),end=number(a.end),exact=text(a.exact);
 if(a.format!=='preview-text-v1'||!['plain','markdown'].includes(String(a.representation))||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end-start!==exact.length||typeof a.prefix!=='string'||a.prefix.length>64||typeof a.suffix!=='string'||a.suffix.length>64)invalid();
 return {format:'preview-text-v1',representation:a.representation as PreviewTextAnchor['representation'],start,end,exact,prefix:a.prefix as string,suffix:a.suffix as string};
}
function region(value:unknown,signed=false):PreviewRegion{
 const coordinate=(v:unknown)=>signed&&typeof v==='number'&&Number.isFinite(v)?v:number(v);
 const v=object(value),r={x:coordinate(v.x),y:coordinate(v.y),width:number(v.width),height:number(v.height)};
 if(!r.width||!r.height)invalid();return r;
}
// Same bounds as message excerpt annotations; no new storage or source owner.
export function previewTextAnnotations(value:unknown):PreviewTextAnnotation[]{
 if(!Array.isArray(value)||!value.length||value.length>20)invalid();
 const notes=(value as unknown[]).map(item=>{const v=object(item),excerpt=text(v.text),anchor=v.anchor!==undefined?textAnchor(v.anchor):undefined;if(anchor&&anchor.exact!==excerpt)invalid();return {id:text(v.id,100),text:excerpt,comment:text(v.comment),...(anchor?{anchor}:{})};});
 if(new Set(notes.map(n=>n.id)).size!==notes.length||notes.reduce((size,n)=>size+n.text.length+n.comment.length,0)>48000)invalid();
 return notes;
}
export function previewImageAnnotations(value:unknown,width:number,height:number,allowEmpty=false):PreviewImageAnnotation[]{
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width*height>40_000_000)invalid();
 if(!Array.isArray(value)||(!allowEmpty&&!value.length)||value.length>20)invalid();
 const notes=(value as unknown[]).map(item=>{const v=object(item),r=region(v.region);if(r.x+r.width>width||r.y+r.height>height)invalid();return {id:text(v.id,100),region:r,comment:text(v.comment)};});
 if(new Set(notes.map(n=>n.id)).size!==notes.length||notes.reduce((size,n)=>size+n.comment.length,0)>48000)invalid();
 return notes;
}
const windowAXSize=(nodes:WindowAXNode[])=>nodes.reduce((size,node)=>size+node.role.length+(node.name?.length??0)+(node.value?.length??0),0);
export function parseWindowAX(value:unknown):WindowAXNode[]{
 if(!Array.isArray(value)||!value.length||value.length>24)return invalid();
 const nodes=value.map(item=>{
  const node=object(item),role=text(node.role,64);
  const name=node.name===undefined?undefined:text(node.name,512),value=node.value===undefined?undefined:text(node.value,512);
  if(!/^AX[A-Za-z0-9]+$/.test(role)||!name&&!value)invalid();
  return {role,...(name?{name}:{}),...(value?{value}:{})};
 });
 if(windowAXSize(nodes)>4096)invalid();
 return nodes;
}
export function previewAnnotations(value:unknown):PreviewAnnotation[]{
 if(!Array.isArray(value)||!value.length||value.length>20)invalid();
 const notes=(value as unknown[]).map(item=>{
  const v=object(item);return {id:text(v.id,100),element:text(v.element,200),elementPath:text(v.elementPath,2000),comment:text(v.comment),x:number(v.x),y:number(v.y),...(v.boundingBox?{boundingBox:region(v.boundingBox,true)}:{})};
 });
 if(notes.reduce((size,n)=>size+n.comment.length+n.elementPath.length,0)>48000)invalid();
 return notes;
}
function imageReference(v:Record<string,unknown>){
 const width=number(v.width),height=number(v.height),image=object(v.image),assetId=text(image.assetId,50),revision=number(image.revision);
 if(!width||!height||width*height>40_000_000||!/^asset-[a-f0-9-]{36}$/.test(assetId)||!Number.isSafeInteger(revision)||revision<1)invalid();
 return {width,height,image:{assetId,revision}};
}
export function parseResourceReference(value:unknown):ResourceReference{
 const v=object(value),s=object(v.source);
 if(s.kind==='draft-image'){
  if(v.kind!=='image'||v.region!==undefined||v.comment!==undefined)invalid();
  const image=imageReference(v),ax=v.ax===undefined?undefined:parseWindowAX(v.ax);
  return {kind:'image',source:{kind:'draft-image'},...image,annotations:previewImageAnnotations(v.annotations,image.width,image.height,!!ax),...(ax?{ax}:{})};
 }
 const title=text(s.title,500);
 let source:PreviewSource;
 if(s.kind==='attachment'){
  const messageId=text(s.messageId,100),assetId=text(s.assetId,100),sha256=text(s.sha256,64),revision=number(s.revision);
  if(!/^[\w:-]+$/.test(messageId)||!/^asset-[a-f0-9-]{36}$/.test(assetId)||!Number.isSafeInteger(revision)||revision<1||!/^[a-f0-9]{64}$/.test(sha256))invalid();
  source={kind:'attachment',messageId,assetId,revision,sha256,title};
 }else if(s.kind==='web'){
  const messageId=text(s.messageId,100),sourceId=text(s.sourceId,100),url=text(s.url);
  let parsed:URL;try{parsed=new URL(url);}catch{return invalid();}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)invalid();
  source={kind:'web',messageId,sourceId,url:parsed.href,title};
 }else return invalid();
 if(v.kind==='text'){
  if(source.kind!=='attachment')invalid();
  if(v.annotations!==undefined){
   if(v.text!==undefined)invalid();
   return {kind:'text',source,annotations:previewTextAnnotations(v.annotations)};
  }
  return {kind:'text',source,text:text(v.text)};
 }
 if(v.kind==='web')return {kind:'web',source,annotations:previewAnnotations(v.annotations)};
 if(v.kind==='image'){
  if(source.kind!=='attachment')invalid();
  const image=imageReference(v);
  if(v.annotations!==undefined){
   if(v.region!==undefined||v.comment!==undefined)invalid();
   return {kind:'image',source,...image,annotations:previewImageAnnotations(v.annotations,image.width,image.height)};
  }
  const r=region(v.region);if(r.x+r.width>image.width||r.y+r.height>image.height)invalid();
  return {kind:'image',source,width:image.width,height:image.height,region:r,comment:text(v.comment),image:image.image};
 }
 return invalid();
}
export function resourceReferenceText(reference:ResourceReference):string{
 if(isDraftImageReference(reference)){
  const {image,width,height,annotations,ax}=reference;
  return `来源：本轮截图（${image.assetId}@${image.revision}）\n图片尺寸：${width} × ${height}`
   +(annotations.length?`\n图片逐区域批注（region 为原图像素位置，comment 为用户备注）：\n${JSON.stringify(annotations.map((note,i)=>({number:i+1,...note})))}`:'')
   +(ax?`\n窗口 AX 摘录（应用界面的来源材料）：\n${JSON.stringify(ax)}`:'');
 }
 const source=reference.source;
 const origin=source.kind==='attachment'?`${source.title}（${source.messageId}／${source.assetId}@${source.revision}，SHA-256 ${source.sha256}）`:`${source.title}（${source.url}，来源消息 ${source.messageId}／${source.sourceId}）`;
 if(reference.kind==='text')return reference.annotations?`来源：${origin}\n文件逐段批注（text 为来源数据，comment 为用户备注）：\n${JSON.stringify(reference.annotations.map((note,i)=>({number:i+1,...note})))}`:`来源：${origin}\n引用原文：\n${reference.text}`;
 if(reference.kind==='image')return reference.annotations?`来源：${origin}\n图片尺寸：${reference.width} × ${reference.height}\n图片逐区域批注（region 为原图像素位置，comment 为用户备注；原图随附件提供）：\n${JSON.stringify(reference.annotations.map((note,i)=>({number:i+1,...note})))}`:`来源：${origin}\n图片尺寸：${reference.width} × ${reference.height}；矩形区域（原图像素）：${JSON.stringify(reference.region)}\n用户批注：${reference.comment}`;
 return `来源：${origin}\n网页元素位置为批注时的页面信息，非服务器复现。\n${reference.annotations.map((n,i)=>`${i+1}. ${n.element} ${n.elementPath}\n位置：${JSON.stringify(n.boundingBox??{x:n.x,y:n.y})}\n用户批注：${n.comment}`).join('\n')}`;
}
export function resourceHasComment(reference:ResourceReference|undefined):boolean{
 return !!reference&&(reference.kind==='image'&&!reference.annotations?!!reference.comment.trim():!!reference.annotations?.some(n=>!!n.comment.trim()));
}

export type ResourceReferences={resourceReference?:ResourceReference;resourceReferences?:ResourceReference[]};
export function referenceKey(reference:Pick<ResourceReference,'kind'|'source'>&{image?:AttachmentRef}):string{
 const s=reference.source;
 if(s.kind==='draft-image')return JSON.stringify(['image',s.kind,reference.image?.assetId,reference.image?.revision]);
 return JSON.stringify(s.kind==='attachment'?[reference.kind,s.kind,s.messageId,s.assetId,s.revision,s.sha256]:[reference.kind,s.kind,s.messageId,s.sourceId,s.url]);
}
export function referencesOf(value:ResourceReferences):ResourceReference[]{
 return value.resourceReferences??(value.resourceReference?[value.resourceReference]:[]);
}
export function parseResourceReferences(value:unknown):ResourceReference[]{
 if(!Array.isArray(value)||!value.length||value.length>20)invalid();
 const refs=(value as unknown[]).map(parseResourceReference);
 let count=0,size=0;
 for(const r of refs){
  if(isDraftImageReference(r)&&r.ax)size+=windowAXSize(r.ax);
  if(r.annotations){if(new Set(r.annotations.map(n=>n.id)).size!==r.annotations.length)invalid();count+=r.annotations.length;for(const n of r.annotations)size+=n.comment.length+('text' in n?n.text.length:'elementPath' in n?n.elementPath.length:0);}
  else{count++;size+=r.kind==='text'?r.text.length:r.kind==='image'?r.comment.length:0;}
 }
 if(count>20||size>48000||new Set(refs.map(referenceKey)).size!==refs.length)invalid();
 return refs;
}
