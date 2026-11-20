import { fromMarkdown } from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {mathFromMarkdown} from 'mdast-util-math';
import {gfm} from 'micromark-extension-gfm';
import {math} from 'micromark-extension-math';
import {webSourceUrl} from './preview-reference.js';
import {webMediaRoute} from './web-contract.js';
export type MessageSource = { id: string; url: string; title: string; kind: 'reply-link' };
type Node = { type: string; url?: string; identifier?: string; value?: string; children?: Node[];position?:{start:{offset:number};end:{offset:number}} };
const walk = (node:Node,visit:(node:Node)=>void) => {visit(node);node.children?.forEach(child=>walk(child,visit));};
const parse=(markdown:string)=>fromMarkdown(markdown,{extensions:[gfm(),math()],mdastExtensions:[gfmFromMarkdown(),mathFromMarkdown()]}) as Node;
const label=(node:Node):string=>node.value??node.children?.map(label).join('')??'';

// Reserve the loopback server's routes. An explicit file URL disambiguates
// a disk file with the same spelling.
export function isMessageFileLink(destination:string){
  if(/^(?:file:|[a-z]:(?:[\\/]|%5c))/i.test(destination))return true;
  if(!/^\/(?![\\/])/.test(destination))return false;
  const path=new URL('http://localhost'+destination).pathname;
  return !/^(?:\/$|\/(?:api|assets|ui)\/|\/(?:connect|settings\/update|update-review\.(?:js|css)|preview\/interactive|branding\/homer\.png)$)/.test(path);
}
export function messageAttachmentDestination(destination:string){
  if(!/^\/api\/media\/[\w:-]+\/[\w-]+\/[1-9]\d*$/.test(destination))return;
  return webMediaRoute('GET',new URL('http://localhost'+destination))?.attachment;
}

// Markdown's rendered href URI-encodes whitespace, Unicode and bare percent
// signs. Accept those spellings and decode percent escapes exactly once.
export function decodeMessageLink(destination:string){
  try{return decodeURIComponent(destination.replace(/%(?![\da-f]{2})/gi,'%25'));}
  catch{return undefined;}
}

function fileLinks(root:Node){
  const definitions=new Map<string,Node>();
  walk(root,node=>{if(node.type==='definition'&&node.identifier&&!definitions.has(node.identifier))definitions.set(node.identifier,node);});
  const links:{node:Node;destination:string;definition?:Node}[]=[];
  walk(root,node=>{
    const definition=node.type==='linkReference'?definitions.get(node.identifier??''):undefined;
    const destination=node.type==='link'?node.url:definition?.url;
    if(destination&&(isMessageFileLink(destination)||messageAttachmentDestination(destination)))links.push({node,destination,definition});
  });
  return links;
}

export function messageFileDestinations(markdown:string){
  return [...new Set(fileLinks(parse(markdown)).map(link=>link.destination))];
}

export function messageFileDestination(markdown:string,destination:string){
  const decoded=decodeMessageLink(destination);
  if(decoded!==undefined)return messageFileDestinations(markdown).find(raw=>decodeMessageLink(raw)===decoded);
}

export function externalFileMessage(markdown:string,stripLocalLinks:boolean){
  if(!stripLocalLinks)return hasNonWebMessageLink(markdown)?undefined:markdown;
  let links:ReturnType<typeof fileLinks>;
  try{links=fileLinks(parse(markdown));}catch{return;}
  const edits=new Map<number,{end:number;text:string}>();
  for(const {node,definition} of links){
    if(!node.position)continue;
    const name=label(node).trim();
    edits.set(node.position.start.offset,{end:node.position.end.offset,text:!name||/[\\/]/.test(name)?'附件':name});
    if(definition?.position)edits.set(definition.position.start.offset,{end:definition.position.end.offset,text:''});
  }
  let text=markdown;
  for(const [start,edit] of [...edits].sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+edit.text+text.slice(edit.end);
  for(const {destination} of links){
    const path=decodeMessageLink(destination);
    if(path)text=text.replaceAll(path.replace(/^file:\/\//i,''),'附件');
    if(path!==destination)text=text.replaceAll(destination,'附件');
  }
  return hasNonWebMessageLink(text)?undefined:text.trim();
}

export function hasNonWebMessageLink(markdown:string){
  if(/\bfile:/i.test(markdown))return true;
  try{
    const root=parse(markdown);
    let found=false;
    walk(root,node=>{
      if(node.url&&['link','image','definition'].includes(node.type)&&!/^https?:\/\//i.test(node.url))found=true;
    });
    return found;
  }catch{return true;} // Unverifiable Markdown stays in the main chat.
}

export function messageLinks(markdown: string): MessageSource[] {
  const root = fromMarkdown(markdown) as Node;
  const definitions = new Map<string, string>(), links: MessageSource[] = [], seen = new Set<string>();
  walk(root, n => { if (n.type === 'definition' && n.identifier && n.url) definitions.set(n.identifier, n.url); });
  const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? '';
  walk(root, n => {
    if (!['link', 'linkReference'].includes(n.type)) return;
    const raw = n.url ?? definitions.get(n.identifier ?? '');
    if (!raw) return;
    const target = webSourceUrl(raw);
    if (!target) return;
    const url = target.href;
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ id: `link-${links.length + 1}`, url, title: text(n).trim() || target.hostname, kind: 'reply-link' });
  });
  return links;
}
