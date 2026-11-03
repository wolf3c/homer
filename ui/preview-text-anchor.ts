import type {PreviewTextAnchor} from '../src/preview-reference';
type Segment={start:number;end:number;node:Node;atomic:boolean};
export function previewTextFlow(root:Element){
 let text='';const segments:Segment[]=[];
 const append=(value:string,node:Node,atomic=false)=>{const start=text.length;text+=value;segments.push({start,end:text.length,node,atomic});};
 const separator=(value:string)=>{if(text&&!text.endsWith(value))text+=value;};
 const visit=(node:Node)=>{
  if(node.nodeType===Node.TEXT_NODE){const value=node.textContent??'',parent=node.parentElement;if(/^[\t \r\n]*[\r\n][\t \r\n]*$/.test(value)&&parent?.matches('div,ul,ol,table,thead,tbody,tr,blockquote')&&!parent.closest('pre'))return;append(value,node);return;}
  if(!(node instanceof Element))return;
  if(node.matches('button,[data-preview-ignore],.code-header,[data-slot=code-header],.sr-only,script,style,svg'))return;
  if(node.hasAttribute('data-preview-math')){append(node.getAttribute('data-preview-math')!,node,true);return;}
  if(node.tagName==='BR'){text+='\n';return;}
  const block=/^(P|DIV|PRE|BLOCKQUOTE|LI|TR|H[1-6])$/.test(node.tagName);
  if(block&&node!==root)separator('\n');
  node.childNodes.forEach(visit);
  if(block&&node!==root)separator('\n');
  if(/^(TD|TH)$/.test(node.tagName))separator('\t');
 };
 visit(root);return {text,segments};
}
export function captureTextAnchor(root:Element,selection:Range,representation:PreviewTextAnchor['representation']):PreviewTextAnchor|undefined{
 const flow=previewTextFlow(root);let start=Infinity,end=-1;
 for(const s of flow.segments){
  if(!selection.intersectsNode(s.node))continue;
  if(s.atomic){start=Math.min(start,s.start);end=Math.max(end,s.end);continue;}
  const length=s.end-s.start;
  if(selection.comparePoint(s.node,0)>0||selection.comparePoint(s.node,length)<0)continue;
  const a=s.node===selection.startContainer?selection.startOffset:0,b=s.node===selection.endContainer?selection.endOffset:length;
  if(a>=b)continue;start=Math.min(start,s.start+a);end=Math.max(end,s.start+b);
 }
 if(!Number.isFinite(start)||end<=start)return;
 while(start<end&&/\s/u.test(flow.text[start]!))start++;
 while(end>start&&/\s/u.test(flow.text[end-1]!))end--;
 if(end<=start)return;
 return {format:'preview-text-v1',representation,start,end,exact:flow.text.slice(start,end),prefix:flow.text.slice(Math.max(0,start-32),start),suffix:flow.text.slice(end,end+32)};
}
export function restoreTextRange(root:Element,anchor:PreviewTextAnchor|undefined,representation:PreviewTextAnchor['representation']):Range|undefined{
 if(!anchor||anchor.representation!==representation)return;
 const flow=previewTextFlow(root),{start,end}=anchor;
 if(flow.text.slice(start,end)!==anchor.exact||flow.text.slice(Math.max(0,start-anchor.prefix.length),start)!==anchor.prefix||flow.text.slice(end,end+anchor.suffix.length)!==anchor.suffix)return;
 const first=flow.segments.find(s=>s.start<=start&&s.end>start),last=flow.segments.find(s=>s.start<end&&s.end>=end);
 if(!first||!last)return;
 const range=document.createRange();
 if(first.atomic)range.setStartBefore(first.node);else range.setStart(first.node,start-first.start);
 if(last.atomic)range.setEndAfter(last.node);else range.setEnd(last.node,end-last.start);
 return range;
}
