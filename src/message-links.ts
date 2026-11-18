import { fromMarkdown } from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {mathFromMarkdown} from 'mdast-util-math';
import {gfm} from 'micromark-extension-gfm';
import {math} from 'micromark-extension-math';
export type MessageSource = { id: string; url: string; title: string; kind: 'reply-link' };
type Node = { type: string; url?: string; identifier?: string; value?: string; children?: Node[] };
const walk = (node:Node,visit:(node:Node)=>void) => {visit(node);node.children?.forEach(child=>walk(child,visit));};

// Reserve the loopback server's routes. An explicit file URL disambiguates
// a disk file with the same spelling.
export function isMessageFileLink(destination:string){
  if(/^(?:file:|[a-z]:(?:[\\/]|%5c))/i.test(destination))return true;
  if(!/^\/(?![\\/])/.test(destination))return false;
  const path=new URL('http://localhost'+destination).pathname;
  return !/^(?:\/$|\/(?:api|assets|ui)\/|\/(?:connect|settings\/update|update-review\.(?:js|css)|preview\/interactive|branding\/homer\.png)$)/.test(path);
}

// Markdown's rendered href URI-encodes whitespace, Unicode and bare percent
// signs. Accept those spellings and decode percent escapes exactly once.
export function decodeMessageLink(destination:string){
  try{return decodeURIComponent(destination.replace(/%(?![\da-f]{2})/gi,'%25'));}
  catch{return undefined;}
}

export function messageFileDestination(markdown:string,destination:string){
  const decoded=decodeMessageLink(destination);
  if(decoded===undefined)return;
  const root=fromMarkdown(markdown,{extensions:[gfm(),math()],mdastExtensions:[gfmFromMarkdown(),mathFromMarkdown()]}) as Node;
  const definitions=new Map<string,string>();
  walk(root,node=>{if(node.type==='definition'&&node.identifier&&node.url!==undefined&&!definitions.has(node.identifier))definitions.set(node.identifier,node.url);});
  let found:string|undefined;
  walk(root,node=>{
    const raw=node.type==='link'?node.url:node.type==='linkReference'?definitions.get(node.identifier??''):undefined;
    if(raw&&isMessageFileLink(raw)&&decodeMessageLink(raw)===decoded)found=raw;
  });
  return found;
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
    let url = raw, fallback = raw;
    try { const target = new URL(raw); url = target.href; fallback = target.hostname || raw; } catch { /* Preserve page-relative destinations. */ }
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ id: `link-${links.length + 1}`, url, title: text(n).trim() || fallback, kind: 'reply-link' });
  });
  return links;
}
