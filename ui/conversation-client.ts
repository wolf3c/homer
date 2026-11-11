import {resourceHasComment,referencesOf,type ResourceReference} from '../src/preview-reference.js';
import {previewIntentTooLong} from '../src/user-intent.js';
import type { ConversationInput, MessageQuote, AnnotatedQuote } from "../src/web-history.js";

// Keep a request's identity through an uncertain network receipt. Editing either
// the text or its source quote is a new user request, never an automatic replay.
export function draftQuotes(value: { quote?: MessageQuote; quotes?: AnnotatedQuote[] }): AnnotatedQuote[] {
  return value.quotes ?? (value.quote ? [{ ...value.quote, annotation: "" }] : []);
}
export type ComposerDraft = { text: string; quotes: AnnotatedQuote[]; resourceReference?:ResourceReference; resourceReferences?:ResourceReference[]; requestId?:string; attachments?:import('../src/media-store.js').MediaView[] };
export type QuoteDraft=AnnotatedQuote&{draftId:string};
export function quoteDrafts(quotes:readonly AnnotatedQuote[],newId:()=>string):QuoteDraft[]{
 const used=new Set<string>();return quotes.map(q=>{let id=(q as QuoteDraft).draftId;if(typeof id!=='string'||!id||used.has(id))id=newId();used.add(id);return {...q,draftId:id};});
}
export function protocolQuote({messageId,text,itemIds,position}:MessageQuote):MessageQuote{
 return {messageId,text,...(itemIds?{itemIds:[...itemIds]}:{}),...(position?{position:(( {format,representation,start,end,exact,prefix,suffix,sourceHash})=>({format,representation,start,end,exact,prefix,suffix,sourceHash}))(position)}:{})};
}
export function protocolQuotes(quotes:readonly AnnotatedQuote[]):AnnotatedQuote[]{return quotes.map(q=>({...protocolQuote(q),annotation:q.annotation}));}
export function singleComposerDraft(draft:ComposerDraft):ComposerDraft&{notice?:string}{return draft;}
export type UnconfirmedInput={input:ConversationInput;target?:{messageId:string;generationId:string};draft?:{
  clearedRequestId:string;attachments:NonNullable<ComposerDraft['attachments']>;quotes:QuoteDraft[];contextOrder:string[];
  resources:Pick<import('./annotation-draft.js').AnnotationDraftState,'htmlMetadata'|'imageAssets'>;
}};
export function unconfirmedInputs(items:readonly UnconfirmedInput[],accepted:readonly (string|{role:string;requestId?:string|null})[]):UnconfirmedInput[]{
  const ids=new Set(accepted.flatMap(item=>typeof item==='string'?[item]:item.role==='user'&&item.requestId?[item.requestId]:[]));
  return items.filter(item=>!ids.has(item.input.requestId));
}
export function restoreComposerDraft(draft: { text: string; quote?: MessageQuote; quotes?: AnnotatedQuote[];resourceReference?:ResourceReference; resourceReferences?:ResourceReference[];requestId?:string;attachments?:ComposerDraft['attachments'] } | undefined, pending: ConversationInput | undefined, accepted: boolean): ComposerDraft | undefined {
  const current = draft ? { text: draft.text, quotes: draftQuotes(draft),...(draft.resourceReference?{resourceReference:draft.resourceReference}:{}),...(draft.resourceReferences?{resourceReferences:draft.resourceReferences}:{}),...(draft.requestId?{requestId:draft.requestId}:{}),...(draft.attachments?.length?{attachments:draft.attachments}:{}) } : undefined;
  if (!pending) return current;
  const previous = { text: pending.text, quotes: draftQuotes(pending),...(pending.resourceReference?{resourceReference:pending.resourceReference}:{}),...(pending.resourceReferences?{resourceReferences:pending.resourceReferences}:{}) };
  const same = current && (!current.requestId||current.requestId===pending.requestId)&&JSON.stringify(current.resourceReference)===JSON.stringify(pending.resourceReference)&&JSON.stringify(current.resourceReferences)===JSON.stringify(pending.resourceReferences)&& current.text === previous.text && JSON.stringify(current.attachments?.map(({assetId,revision})=>({assetId,revision}))??[])===JSON.stringify(pending.attachments??[])&&JSON.stringify(protocolQuotes(current.quotes)) === JSON.stringify(protocolQuotes(previous.quotes));
  if (accepted) return same ? undefined : current;
  return current ?? previous;
}
export function canSubmitMessage(text: string, quotes: readonly AnnotatedQuote[], attachments: Readonly<NonNullable<ConversationInput['attachments']>>=[],resourceReference?:ResourceReference,resourceReferences?:ResourceReference[]): boolean {
  if(text.length>16000||previewIntentTooLong({text,quotes:[...quotes],resourceReference,resourceReferences}))return false;
  if(referencesOf({resourceReference,resourceReferences}).some(r=>r.kind==='image'&&!attachments.some(ref=>ref.assetId===r.image.assetId&&ref.revision===r.image.revision)))return false;
  return !!text.trim() || quotes.some(quote => !!quote.annotation.trim()) || attachments.length>0 || referencesOf({resourceReference,resourceReferences}).some(resourceHasComment);
}
export function prepareMessage(text: string, quote: MessageQuote | AnnotatedQuote[] | undefined, pending: ConversationInput | undefined, newId: () => string,attachments:NonNullable<ConversationInput['attachments']>=[],resourceReference?:ResourceReference,resourceReferences?:ResourceReference[]): ConversationInput {
  const quotes = Array.isArray(quote) ? protocolQuotes(quote) : undefined;
  const current = quotes ?? (quote&&!Array.isArray(quote) ? [{ ...quote, annotation: "" }] : []);
  if (pending && JSON.stringify(pending.resourceReference)===JSON.stringify(resourceReference)&&JSON.stringify(pending.resourceReferences)===JSON.stringify(resourceReferences)&& !pending.interactionId && pending.text === text && JSON.stringify(pending.attachments??[])===JSON.stringify(attachments)&&JSON.stringify(protocolQuotes(draftQuotes(pending))) === JSON.stringify(protocolQuotes(current))) return pending;
  return structuredClone({ requestId: newId(), text,...(resourceReference?{resourceReference}:{}),...(resourceReferences?.length?{resourceReferences}:{}), ...(attachments.length?{attachments:attachments.map(({assetId,revision})=>({assetId,revision}))}:{}),...(quotes?.length ? { quotes: quotes.map(item => ({ ...item })) } : quote && !Array.isArray(quote) ? { quote: protocolQuote(quote) } : {}) });
}

export function prepareInteractionResponse(text: string, interactionId: string, pending: ConversationInput | undefined, newId: () => string,questionAnswers?:ConversationInput['questionAnswers']): ConversationInput {
  const canonical=(answers:ConversationInput['questionAnswers'])=>answers?Object.fromEntries(Object.entries(answers).sort(([a],[b])=>a<b?-1:a>b?1:0)):undefined;
  if (pending?.text === text && pending.interactionId === interactionId && !pending.quote && !pending.quotes?.length&&JSON.stringify(canonical(pending.questionAnswers))===JSON.stringify(canonical(questionAnswers))) return pending;
  return { requestId: newId(), text, interactionId,...(questionAnswers?{questionAnswers:canonical(questionAnswers)}:{}) };
}

// New gateways explicitly advertise durable transport acceptance. Older hosts
// keep their existing running-only behavior.
export function canAcceptInput(connected: boolean, upgrade: {phase: string; accepting?: boolean}): boolean {
  return connected && (upgrade.accepting ?? upgrade.phase === 'running');
}

// A definitive source rejection may restore the optimistically cleared editor.
// Its original payload also remains in pending storage; never replace newer work.
export function restoreRejectedSourceDraft(current:{text:string;quotes:readonly AnnotatedQuote[];requestId:string;attachments?:readonly unknown[];uploading?:boolean;resourceReference?:ResourceReference;resourceReferences?:ResourceReference[]},input:ConversationInput,clearedRequestId:string){
 if(current.requestId!==clearedRequestId||current.text||current.quotes.length||current.uploading||current.attachments?.length||referencesOf(current).length)return;
 return {text:input.text,quotes:draftQuotes(input),requestId:input.requestId,...(input.attachments?{attachments:input.attachments}:{}),...(input.resourceReference?{resourceReference:input.resourceReference}:{}),...(input.resourceReferences?{resourceReferences:input.resourceReferences}:{})};
}
