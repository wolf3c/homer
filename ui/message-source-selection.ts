import {captureTextAnchor,previewTextFlow,restoreTextRange} from './preview-text-anchor';
import {previewSelectionText} from './preview-selection';
import type {MessageQuote} from '../src/web-history';
// Read the live selection before the official action clears it. Identity comes
// from the actual rendered item wrappers, never text matching or a part index.
export function captureSourceQuote(selection:Selection|null):MessageQuote|undefined{
 if(!selection||selection.isCollapsed||selection.rangeCount!==1)return;
 const range=selection.getRangeAt(0),element=(node:Node)=>node.nodeType===1?node as Element:node.parentElement;
 const root=element(range.startContainer)?.closest<HTMLElement>('[data-conversation-message]');
 if(!root||root!==element(range.endContainer)?.closest('[data-conversation-message]'))return;
 const marker=element(range.startContainer)?.closest('[data-aui-quote-selectable]');
 if(!marker||marker.getAttribute('data-aui-quote-selectable')==='false'||marker!==element(range.endContainer)?.closest('[data-aui-quote-selectable]')||!marker.contains(range.commonAncestorContainer))return;
 if([...marker.querySelectorAll('[data-aui-quote-selectable="false"]')].some(item=>range.intersectsNode(item)))return;
 const text=previewSelectionText({range,text:selection.toString()},marker);if(!text||text.length>16000)return;
 const itemIds=sourceItemIds(root,range);
 if(itemIds.length>200||root.dataset.messageSource==='model'&&!itemIds.length)return;
 return {messageId:root.dataset.conversationMessage!,text,...(itemIds.length?{itemIds:[...new Set(itemIds)]}:{})};
}

export type SourceQuoteSelection={quote:MessageQuote;range:Range;flowText?:string;anchor?:import('../src/preview-reference').PreviewTextAnchor};
export function captureSourceQuoteSelection(selection:Selection|null):SourceQuoteSelection|undefined{
 const quote=captureSourceQuote(selection);if(!quote||!selection)return;
 const range=selection.getRangeAt(0).cloneRange(),element=range.startContainer.nodeType===1?range.startContainer as Element:range.startContainer.parentElement;
 const body=element?.closest('[data-aui-quote-selectable]');if(!body)return;
 const anchor=captureTextAnchor(body,range,'markdown');
 const normalize=(text:string)=>text.replace(/\s+/gu,' ').trim();
 if(!anchor||normalize(anchor.exact)!==normalize(quote.text))return {quote,range};
 return {quote:{...quote,text:anchor.exact},range,anchor,flowText:previewTextFlow(body).text};
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
