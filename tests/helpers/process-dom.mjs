// Real React DOM reconciliation and delegated events, without layout or browser defaults.
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
class DomNode {
 constructor(type,name,doc,text=''){Object.assign(this,{nodeType:type,nodeName:name,tagName:type===1?name:undefined,ownerDocument:doc,parentNode:null,childNodes:[],attrs:{},listeners:{},style:{setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}},namespaceURI:'http://www.w3.org/1999/xhtml',_text:text});}
 appendChild(child){if(child.parentNode)child.parentNode.removeChild(child);child.parentNode=this;this.childNodes.push(child);return child;}
 removeChild(child){this.childNodes.splice(this.childNodes.indexOf(child),1);child.parentNode=null;return child;}
 insertBefore(child,before){if(child.parentNode)child.parentNode.removeChild(child);child.parentNode=this;this.childNodes.splice(this.childNodes.indexOf(before),0,child);return child;}
 setAttribute(name,value){this.attrs[name]=String(value);} removeAttribute(name){delete this.attrs[name];} getAttribute(name){return this.attrs[name]??null;} hasAttribute(name){return name in this.attrs;}
 addEventListener(name,handler,options){(this.listeners[name]??=[]).push({handler,capture:options===true});} removeEventListener(){}
 get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');} set textContent(value){this._text=String(value);this.childNodes=[];}
 get nodeValue(){return this.nodeType===3?this._text:null;} set nodeValue(value){this._text=String(value);}
 get firstChild(){return this.childNodes[0]??null;} get lastChild(){return this.childNodes.at(-1)??null;} get nextSibling(){return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]??null;}
 get hidden(){return 'hidden' in this.attrs;} contains(node){return node===this||this.childNodes.some(child=>child.contains(node));}
 getBoundingClientRect(){return {width:0,height:0};}
 focus(){this.ownerDocument.activeElement=this;} scrollIntoView(){throw Error('Unexpected scrolling');}
}
export const descendants=n=>[n,...n.childNodes.flatMap(descendants)];
export function visibleText(n){if(n.hidden)return '';return n._text+n.childNodes.filter((_,index)=>n.tagName!=='DETAILS'||'open' in n.attrs||index===0).map(visibleText).join('');}
export async function withDom(run){
 const doc=new DomNode(9,'#document');doc.ownerDocument=doc;doc.createElement=name=>new DomNode(1,name.toUpperCase(),doc);doc.createElementNS=(_,name)=>doc.createElement(name);doc.createTextNode=text=>new DomNode(3,'#text',doc,text);doc.activeElement=null;
 const win={setInterval:(...args)=>globalThis.setInterval(...args),clearInterval:id=>globalThis.clearInterval(id),document:doc,HTMLIFrameElement:class{},HTMLElement:DomNode,Node:DomNode,addEventListener(){},removeEventListener(){},getComputedStyle:()=>({animationName:'none',animationDuration:'0s',transitionDuration:'0s'})};doc.defaultView=win;
 const old={HTMLElement:globalThis.HTMLElement,Element:globalThis.Element,window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT,storage:globalThis.sessionStorage,raf:globalThis.requestAnimationFrame,caf:globalThis.cancelAnimationFrame,computed:globalThis.getComputedStyle};
 const storage=new Map();globalThis.sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 globalThis.getComputedStyle=win.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;
 globalThis.HTMLElement=DomNode;globalThis.Element=DomNode;globalThis.window=win;globalThis.document=doc;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const container=doc.createElement('div');let root=createRoot(container);
 const api={container,doc,all:()=>descendants(container),find:fn=>descendants(container).find(fn),render:async value=>act(async()=>root.render(value)),remount:async()=>{await act(async()=>root.unmount());root=createRoot(container);},click:async button=>act(async()=>{if(!button||!container.contains(button))throw Error('process_test_click_target_missing');const event={type:'click',target:button,button:0,bubbles:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};for(const listener of container.listeners.click??[])if(!listener.capture)listener.handler(event);})};
 try{await run(api);}finally{await act(async()=>root.unmount());globalThis.getComputedStyle=old.computed;globalThis.requestAnimationFrame=old.raf;globalThis.cancelAnimationFrame=old.caf;globalThis.HTMLElement=old.HTMLElement;globalThis.Element=old.Element;globalThis.window=old.window;globalThis.document=old.document;globalThis.IS_REACT_ACT_ENVIRONMENT=old.act;if(old.storage===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=old.storage;}
}
export {React};
