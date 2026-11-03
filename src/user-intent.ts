import type {ConversationInput} from './web-history.js';

export const USER_AUTHORITY_MAX_LENGTH=24000;
type RemarkReference=
 | {kind:'text';annotations?:readonly {comment:string}[]}
 | {kind:'image';comment:string;annotations?:never}
 | {kind:'image';annotations:readonly {comment:string}[];comment?:never}
 | {kind:'web';annotations:readonly {comment:string}[]};
type UserTextInput=Pick<ConversationInput,'text'|'quotes'>&{resourceReference?:RemarkReference;resourceReferences?:readonly RemarkReference[]};

export function conversationUserText({text,quotes,resourceReference,resourceReferences}:UserTextInput):string{
 const comments=(resourceReferences??(resourceReference?[resourceReference]:[])).flatMap(r=>r.kind==='image'&&!r.annotations?[r.comment]:r.annotations?.map(n=>n.comment)??[]).join('\n');
 return (quotes?.length?text+'\n用户逐段批注：\n'+JSON.stringify(quotes.map(({messageId,annotation},index)=>({number:index+1,messageId,annotation}))):text)+(comments?'\n用户预览批注：\n'+comments:'');
}
export function userAuthorityDescription(text:string):string{
 return '用户本次实际要求：'+text;
}
export function previewIntentTooLong(input:UserTextInput):boolean{
 return (!!input.resourceReference||!!input.resourceReferences?.length)&&userAuthorityDescription(conversationUserText(input)).length>USER_AUTHORITY_MAX_LENGTH;
}
export function validatePreviewIntent(input:UserTextInput):void{
 if(previewIntentTooLong(input))throw Error('preview_intent_too_long');
}
