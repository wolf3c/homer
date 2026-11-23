import {captureTextAnchor,previewTextFlow,restoreTextRange} from './preview-text-anchor';
import {previewSelectionText} from './preview-selection';
import type {MessageQuote} from '../src/web-history';
export function resolveSourceQuote(selection:Selection|null,onReject?:(message:string)=>void){
 if(!selection||selection.isCollapsed||selection.rangeCount!==1)return;
 const raw=selection.getRangeAt(0),element=(node:Node)=>node.nodeType===1?node as Element:node.parentElement;
 const start=element(raw.startContainer),end=element(raw.endContainer);
 const root=start?.closest<HTMLElement>('[data-conversation-message]');
 const body=start?.closest('[data-aui-quote-selectable]');
 if(!root||!body||body.getAttribute('data-aui-quote-selectable')==='false')return;
 const reject=(message:string)=>{onReject?.(message);return undefined;};
 const outside=()=>reject('请在同一条消息的正文内选择。');
 if(root!==end?.closest('[data-conversation-message]'))return outside();
 let range=raw;
 if(body!==end?.closest('[data-aui-quote-selectable]')){
   const time=body.nextSibling;
   if(!(time instanceof HTMLElement)||!time.matches('time.message-timestamp')||raw.endOffset!==0||
      (raw.endContainer!==time&&raw.endContainer!==time.firstChild))return outside();
   range=raw.cloneRange();
   range.setEnd(body,body.childNodes.length);
 }
 if(!body.contains(range.commonAncestorContainer)||
    [...body.querySelectorAll('[data-aui-quote-selectable="false"]')].some(item=>range.intersectsNode(item)))return outside();
 // The permitted boundary adds no characters. Keep native paragraph breaks.
 const text=previewSelectionText({range,text:selection.toString()},body);if(!text)return;
 const itemIds=sourceItemIds(root,range);
 if(itemIds.length>200)return reject('所选内容包含过多来源，请缩小选区。');
 if(root.dataset.messageSource==='model'&&!itemIds.length)return reject('这段回复的来源暂无法核验。');
 const quote:MessageQuote={messageId:root.dataset.conversationMessage!,text,...(itemIds.length?{itemIds}:{})};
 return {quote,range,body,root,backward:selection.focusNode===raw.startContainer&&selection.focusOffset===raw.startOffset};
}

export function captureSourceQuote(selection:Selection|null):MessageQuote|undefined{
 return resolveSourceQuote(selection)?.quote;
}

export function visibleQuoteLine(range:Range,viewport:HTMLElement,backward=false):DOMRect|undefined{
 const bounds=viewport.getBoundingClientRect();
 const rects=range.getClientRects();
 for(let i=0;i<rects.length;i++){
   const rect=rects[backward?i:rects.length-1-i]!;
   const left=Math.max(rect.left,bounds.left,0),right=Math.min(rect.right,bounds.right,window.innerWidth);
   const top=Math.max(rect.top,bounds.top,0),bottom=Math.min(rect.bottom,bounds.bottom,window.innerHeight);
   if(right>left&&bottom>top)return new DOMRect(left,top,right-left,bottom-top);
 }
}

export type SourceQuoteSelection={quote:MessageQuote;range:Range;backward?:boolean;flowText?:string;anchor?:import('../src/preview-reference').PreviewTextAnchor};
export function captureSourceQuoteSelection(selection:Selection|null,resolved=resolveSourceQuote(selection)):SourceQuoteSelection|undefined{
 if(!resolved)return;
 const {quote,body,backward}=resolved,range=resolved.range.cloneRange();
 const anchor=captureTextAnchor(body,range,'markdown');
 const normalize=(text:string)=>text.replace(/\s+/gu,' ').trim();
 if(!anchor||normalize(anchor.exact)!==normalize(quote.text))return {quote,range,backward};
 return {quote:{...quote,text:anchor.exact},range,backward,anchor,flowText:previewTextFlow(body).text};
}
async function sourceHash(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function completeSourceQuote(snapshot:SourceQuoteSelection):Promise<MessageQuote>{
 if(!snapshot.anchor||snapshot.flowText===undefined)return snapshot.quote;
 return {...snapshot.quote,position:{...snapshot.anchor,sourceHash:await sourceHash(snapshot.flowText)}};
}
export async function locateSourceQuote(quote:MessageQuote):Promise<Range|undefined>{
 if(!quote.position)return;
 const root=document.getElementById('message-'+quote.messageId);if(!root||root.dataset.conversationMessage!==quote.messageId)return;
 if(quote.itemIds?.some(id=>![...root.querySelectorAll<HTMLElement>('[data-message-item-id]')].some(item=>item.dataset.messageItemId===id)))return;
 for(const body of root.querySelectorAll<HTMLElement>('[data-aui-quote-selectable]:not([data-aui-quote-selectable="false"])')){
  const text=previewTextFlow(body).text;if(await sourceHash(text)!==quote.position.sourceHash||!body.isConnected||document.getElementById('message-'+quote.messageId)!==root||root.dataset.conversationMessage!==quote.messageId||previewTextFlow(body).text!==text)continue;
  const range=restoreTextRange(body,quote.position,'markdown');if(!range)continue;
  // All selected logical items must still belong to the recorded source.
  const ids=sourceItemIds(root,range);
  if(quote.itemIds&&JSON.stringify(ids)!==JSON.stringify(quote.itemIds))continue;
  return range;
 }
}

function sourceItemIds(root:HTMLElement,range:Range):string[]{
 const itemIds:string[]=[];
 for(const item of root.querySelectorAll<HTMLElement>('[data-message-item-id]')){
   if(!range.intersectsNode(item))continue;
   const overlap=range.cloneRange(),body=root.ownerDocument.createRange();body.selectNodeContents(item);
   if(overlap.compareBoundaryPoints(0,body)<0)overlap.setStart(body.startContainer,body.startOffset);
   if(overlap.compareBoundaryPoints(2,body)>0)overlap.setEnd(body.endContainer,body.endOffset);
   if(overlap.toString().trim())itemIds.push(item.dataset.messageItemId!);
 }
 return [...new Set(itemIds)];
}
