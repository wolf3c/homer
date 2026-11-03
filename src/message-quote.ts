import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {gfm} from 'micromark-extension-gfm';
import {math} from 'micromark-extension-math';
import {mathFromMarkdown} from 'mdast-util-math';

type MarkdownNode={type:string;value?:string;children?:readonly MarkdownNode[]};
const inlineMarkdown=new Set(['paragraph','heading','strong','emphasis','delete','link','linkReference','tableCell']);
function visibleMarkdown(node:MarkdownNode):string{
 if(node.type==='inlineMath'||node.type==='math')return previewMathText(node.value??'',node.type==='math');
 if(['text','inlineCode','code','html'].includes(node.type))return node.value??'';
 if(node.type==='break')return '\n';
 if(['definition','image','imageReference','footnoteDefinition'].includes(node.type))return '';
 return (node.children??[]).map(visibleMarkdown).join(node.type==='tableRow'?'\t':inlineMarkdown.has(node.type)?'':'\n');
}
// Shared by whole-message quoting and source validation. Hidden destinations
// never become quoted content; block/table whitespace retains the old contract.
export function messageQuoteText(markdown:string):string{
 return visibleMarkdown(fromMarkdown(markdown,{extensions:[gfm()],mdastExtensions:[gfmFromMarkdown()]}));
}
// Preview selections preserve the formula source instead of KaTeX's duplicated
// visual/MathML text. Use the same math parser as the Markdown renderer.
export function previewMathText(value:string,display:boolean):string{
 return display?`$$\n${value}\n$$`:`$${value}$`;
}
export function previewQuoteText(markdown:string):string{
 return visibleMarkdown(fromMarkdown(markdown,{extensions:[gfm(),math()],mdastExtensions:[gfmFromMarkdown(),mathFromMarkdown()]}));
}

export type MessageSourcePart={id:string;text:string;revision:number};
// The existing answer slot is a view of these items, never the node.final
// summary. Standalone host/history messages continue to own their row text.
export function messageSourceParts(message:{id:string;text:string;process?:{sourceKind:string;final?:{id:string};items:readonly import('./main-process.js').ProcessItem[]}}):MessageSourcePart[]|undefined{
 if(message.process?.sourceKind!=='user')return;
 const parts=message.process.items.filter((item):item is Extract<import('./main-process.js').ProcessItem,{kind:'commentary'}>=>item.kind==='commentary'&&item.phase==='final_answer').map(item=>({id:item.id,text:item.text,revision:item.revision}));
 // The existing self-ID pointer positively identifies a host row. Absence of
 // native items alone cannot establish provenance for a historical summary.
 return !parts.length&&message.process.final?.id===message.id?undefined:parts;
}
// Short-lived page-local caches can reuse an unchanged item revision. Never
// persist the converted text or share an ID cache across thread/epoch scopes.
export function sourceQuoteText(parts:readonly MessageSourcePart[]):string{
 return parts.map(part=>previewQuoteText(part.text)).join('\n\n');
}
export function sourceMessageText(message:Parameters<typeof messageSourceParts>[0]):string{
 const parts=messageSourceParts(message);return parts?parts.map(part=>part.text).join('\n\n'):message.text;
}

// Bound the identity list to exactly the prefix offered by the whole-message
// action. Empty fragments retain their position between nonempty fragments.
export function sourceQuote(parts:readonly MessageSourcePart[],limit=16000,maxItems=200){
 let text='';const itemIds:string[]=[];
 for(const part of parts){
   if(text.length>=limit||itemIds.length>=maxItems)break;
   const visible=previewQuoteText(part.text),separator=itemIds.length?'\n\n':'';
   text+=(separator+visible).slice(0,limit-text.length);itemIds.push(part.id);
 }
 return {text,itemIds};
}
