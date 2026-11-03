import type {AttachmentRef} from './media-store.js';
// Local provenance only. Tool transports continue to expose fixed safe strings.
export class AttachmentInputError extends Error {}
export function parseAttachmentReference(value:unknown):AttachmentRef{
 const match=typeof value==='string'?/^(asset-[a-f0-9-]{36})@([1-9][0-9]*)$/.exec(value):null;
 if(!match||!Number.isSafeInteger(Number(match[2])))throw new AttachmentInputError('task_attachment_reference_invalid');
 return {assetId:match[1]!,revision:Number(match[2])};
}
export function attachmentReference(ref:AttachmentRef){
 const id=ref.assetId+'@'+ref.revision;parseAttachmentReference(id);
 return {type:'attachment' as const,id};
}
