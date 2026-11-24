import type {RootContent} from 'mdast';
import {decodeMessageLink,parseMessageMarkdown} from './message-links.js';
import {webSourceUrl} from './preview-reference.js';

type MarkdownNode=RootContent;
type Entity={offset:number;length:number} & (
  {type:'bold'|'italic'|'code'|'pre'} | {type:'text_link';url:string}
);

const telegramTextLimit=4096;
const unavailable='此回复没有可发送的正文。';
const attachment='附件';

function webUrl(value:string){
  if(!/^https?:\/\/[^/\\?#\s]/i.test(value)||/[\p{Cc}\\]/u.test(value))return;
  const url=webSourceUrl(value);
  if(url?.hostname)return url.href;
}

// Match self-identifying paths in prose and code, including quoted paths
// with spaces. Keep complete web URLs intact.
const localStart=/(?:file:|[a-z]:(?:[/\\]|%5c|%2f)|\\\\|~(?:[/\\]|%2f)|%2f|\/)/.source;
const localBoundary=/(?<![\w/@\\])/.source;
const unescapedUnc=/(?<![\w/@\\])\\[^\s<>"'\x60()[\]{},;，。；！？\\]+\\/g;
// CommonMark unescapes a doubled backslash in text and image labels.
const restoreUnc=(value:string)=>value.replace(unescapedUnc,match=>'\\'+match);

function children(node:MarkdownNode){
  return 'children' in node?node.children:[];
}
function label(node:MarkdownNode):string{
  if('value' in node)return node.value;
  if('alt' in node)return node.alt??'';
  return children(node).map(label).join('');
}

function render(markdown:string){
  const root=parseMessageMarkdown(markdown);
  const definitions=new Map<string,string>();
  const fileTargets=new Set<string>();
  function collect(node:MarkdownNode){
    if(node.type==='definition'&&!definitions.has(node.identifier))definitions.set(node.identifier,node.url);
    if('url' in node&&!webUrl(node.url)){
      const decoded=decodeMessageLink(node.url)??node.url;
      // Standalone filenames remain usable as attachment labels.
      if(/^(?:file:|[a-z]:[/\\])/i.test(decoded)||(!/^[\w+.-]+:/.test(decoded)&&/[/\\]/.test(decoded))){
        fileTargets.add(node.url);
        fileTargets.add(decoded);
        fileTargets.add(decoded.replace(/^file:\/\/(?:localhost)?(?=\/)/i,''));
      }
    }
    children(node).forEach(collect);
  }
  root.children.forEach(collect);
  const knownPaths=fileTargets.size?
    [...fileTargets].filter(Boolean).sort((a,b)=>b.length-a.length)
      .map(target=>target.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&')).join('|'):'';
  const paths=new RegExp([
    /(?<![\w+.-])https?:[^\s<>"'\x60]+/.source,
    localBoundary+'(["\'])'+localStart+'(?=[^\\s"\'<>])[^\\r\\n]*?\\1',
    // A known target may be the prefix of a longer bare path.
    localBoundary+localStart+/(?=\S)[^\r\n\u2028\u2029]*/.source,
    ...(knownPaths?[localBoundary+'(?:'+knownPaths+')'+/(?=$|[\s<>"'\x60()[\]{},;，。；！？]|\.(?:$|\s))/.source]:[]),
  ].join('|'),'giu');
  const safeText=(value:string)=>value.replace(paths,(match,quote:string|undefined)=>{
    if(webUrl(match))return match;
    return quote?quote+attachment+quote:attachment;
  });
  const safeLabel=(value:string)=>/^(?:\.{1,2}[/\\]|~[/\\])|^\S+[/\\]\S+$/u.test(value.trim())&&!webUrl(value.trim())
    ?attachment:safeText(restoreUnc(value));

  let text='',visible='';
  const entities:Entity[]=[];
  const codeRanges:{start:number;end:number}[]=[];
  function withQuote(value:string,quote:string,previous:string){
    if(!quote)return value;
    let output='';
    let lineStart=!previous||previous.endsWith('\n');
    for(const line of value.split(/(?<=\n)/)){
      if(line&&line!=='\n'&&lineStart)output+=quote;
      output+=line;
      lineStart=line.endsWith('\n');
    }
    return output;
  }
  function append(value:string,quote:string,original=value){
    text+=withQuote(value,quote,text);
    visible+=withQuote(original,quote,visible);
  }
  function add(type:Entity['type'],start:number,end:number,url?:string){
    const length=text.slice(start,end).trimEnd().length;
    if(length)entities.push(type==='text_link'?{type,offset:start,length,url:url!}:{type,offset:start,length});
  }
  function formatted(type:Entity['type'],quote:string,write:()=>void,url?:string){
    let start=text.length;
    const firstCode=codeRanges.length;
    const startsLine=!text||text.endsWith('\n');
    write();
    if(quote&&startsLine&&text.startsWith(quote,start))start+=quote.length;
    if(type==='code'||type==='pre'){
      add(type,start,text.length);
      codeRanges.push({start,end:text.length});
    }else if(type!=='text_link'){
      // Telegram forbids overlap with code. Other spans follow the tree and
      // are disjoint or fully nested.
      for(let i=firstCode;i<codeRanges.length;i++){
        const code=codeRanges[i]!;
        add(type,start,code.start);
        start=code.end;
      }
      add(type,start,text.length);
    }else if(firstCode===codeRanges.length){
      add(type,start,text.length,url);
    }
  }
  function blocks(nodes:MarkdownNode[],quote:string,indent:string,separator:string){
    let end=text.length;
    for(const node of nodes){
      if(node.type==='definition')continue;
      if(text.length!==end)append(separator,quote);
      end=text.length;
      visit(node,quote,indent,true);
    }
  }
  function visit(node:MarkdownNode,quote:string,indent:string,block=false){
    const inline=()=>children(node).forEach(child=>visit(child,quote,indent));
    switch(node.type){
      case 'heading':
      case 'strong': formatted('bold',quote,inline);break;
      case 'emphasis': formatted('italic',quote,inline);break;
      case 'inlineCode': formatted('code',quote,()=>append(safeText(node.value),quote,node.value));break;
      case 'code': {
        const write=()=>append(safeText(node.value),quote,node.value);
        if(quote)write();
        else formatted('pre',quote,write);
        break;
      }
      case 'link':
      case 'linkReference': {
        const target=node.type==='link'?node.url:definitions.get(node.identifier)??'';
        const url=webUrl(target);
        const explicit=node.type==='linkReference'||markdown[node.position?.start.offset??-1]==='[';
        const name=label(node);
        if(!url&&name!==attachment&&safeLabel(name)===attachment)append(attachment,quote);
        else if(url&&safeText(url)===url&&explicit)formatted('text_link',quote,inline,url);
        else inline();
        break;
      }
      case 'blockquote': blocks(node.children,quote+'› ',indent,'\n\n');break;
      case 'list':
        node.children.forEach((item,index)=>{
          if(index)append('\n',quote);
          append(indent+(node.ordered?((node.start??1)+index)+'. ':'• '),quote);
          item.children.forEach((child,i)=>{
            if(i)append('\n',quote);
            if(i&&child.type!=='list')append(indent+'  ',quote);
            visit(child,quote,indent+'  ',true);
          });
        });
        break;
      case 'table': blocks(node.children,quote,indent,'\n');break;
      case 'tableRow':
        node.children.forEach((cell,index)=>{
          if(index)append(' ｜ ',quote);
          visit(cell,quote,indent);
        });
        break;
      case 'image':
      case 'imageReference': append(safeLabel(node.alt??''),quote);break;
      case 'text': {
        const value=restoreUnc(node.value);
        append(safeText(value),quote,value);
        break;
      }
      case 'inlineMath':
      case 'math': append(safeText(node.value),quote,node.value);break;
      case 'html':
        if(block)append('HTML 内容已省略',quote);
        break;
      case 'break': append('\n',quote);break;
      case 'thematicBreak': append('—',quote);break;
      default: inline();break;
    }
  }
  blocks(root.children,'','','\n\n');
  // Formatting can join fragments into a path, so also check the final text.
  if(!text.trim()||safeText(visible)!==text)return;
  const seen=new Set<string>();
  return {text,entities:entities.sort((a,b)=>a.offset-b.offset||b.length-a.length).filter(entity=>{
    const key=JSON.stringify(entity);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  })};
}

export function telegramMarkdown(markdown:string):{text:string;entities:Entity[]}|{file:string}{
  try{
    const rendered=render(markdown);
    if(rendered){
      if(markdown.length<=telegramTextLimit&&rendered.text.length<=telegramTextLimit)return rendered;
      const {text,entities}=rendered;
      let file='',start=0;
      for(const entity of entities){
        if(entity.type!=='text_link')continue;
        const end=entity.offset+entity.length;
        file+=text.slice(start,end);
        if(webUrl(text.slice(entity.offset,end))!==entity.url)file+=' ('+entity.url+')';
        start=end;
      }
      return {file:file+text.slice(start)};
    }
  }catch{
    // An unrenderable body must never fall back to the raw Markdown.
  }
  return {text:unavailable,entities:[]};
}
