import {previewMathText} from '../src/message-quote';
import type {Nodes,Root} from 'mdast';

// Keep the parser's exact formula source outside KaTeX's replaceable output,
// so successful rendering and error fallbacks share the same quote contract.
export function remarkPreviewMath(){
 return (tree:Root)=>{
  const visit=(node:Nodes):void=>{
   if(node.type==='inlineMath'||node.type==='math'){
    const data=node.data!;
    node.data={...data,hName:'span',hProperties:{'data-preview-math':previewMathText(node.value,node.type==='math')},hChildren:[{type:'element',tagName:data.hName!,properties:data.hProperties??{},children:data.hChildren!}]};
   }else if(node.type==='code'&&node.lang?.split(/\s+/)[0]==='math'){
    // Clear the inherited language class on the source wrapper: KaTeX must
    // replace only its inner code element, leaving the original TeX intact.
    node.data={...node.data,hName:'span',
     hProperties:{className:[],'data-preview-math':node.value},
     hChildren:[{type:'element',tagName:'code',properties:{className:['language-math','math-display']},children:[{type:'text',value:node.value+'\n'}]}],
    };
   }else if('children' in node)node.children.forEach(visit);
  };
  visit(tree);
 };
}

// A saved native Range survives moving keyboard focus to the selection action.
export function previewSelectionText(selection:{range:Range;text:string},body:Element):string{
 const range=selection.range.cloneRange();
 const formulas=[...body.querySelectorAll('[data-preview-math]')].filter(formula=>range.intersectsNode(formula));
 if(!formulas.length)return selection.text.trim();
 // A partial formula is quoted as one complete expression, including when
 // either selection endpoint lands inside KaTeX's visual or MathML subtree.
 for(const formula of formulas){
  if(formula.contains(range.startContainer))range.setStartBefore(formula);
  if(formula.contains(range.endContainer))range.setEndAfter(formula);
 }
 const fragment=range.cloneContents();
 for(const formula of fragment.querySelectorAll('[data-preview-math]'))formula.replaceWith(formula.getAttribute('data-preview-math')!);
 // Detached fragments have no layout. Retain block and table boundaries before
 // reading textContent; source validation normalizes whitespace on both sides.
 for(const br of fragment.querySelectorAll('br'))br.replaceWith('\n');
 for(const block of fragment.querySelectorAll('p,div,pre,blockquote,li,tr,h1,h2,h3,h4,h5,h6'))block.append('\n');
 for(const cell of fragment.querySelectorAll('td,th'))cell.append('\t');
 return fragment.textContent?.trim()??'';
}
