import type{PreviewAnnotation,PreviewSource}from'./preview-reference.js';

// Page state is owned by Electron, annotation notes by the existing composer.
export type BrowserPage={id:string;threadId:string;owner:string;url:string;title:string;document:number;control:'user'|'agent';agentAssigned?:boolean;source:PreviewSource;loading?:boolean;error?:string};
export type BrowserAnnotationState={document:number;active:boolean;revision:number;epoch:number;notes:PreviewAnnotation[];focusId?:string;focusRequest?:string;historyNote?:PreviewAnnotation};
export type BrowserAnnotationChange={pageId:string;document:number;baseRevision:number;epoch:number;changeId:string;notes:PreviewAnnotation[]};
export type BrowserAnnotationReply=BrowserAnnotationState&{changeId?:string;error?:string};
export type BrowserPreviewBridge={
 list(threadId:string):Promise<BrowserPage[]>;
 present(input:{pageId:string;threadId:string;bounds:{x:number;y:number;width:number;height:number}|null}):Promise<void>;
 control(input:{pageId:string;threadId:string;action:'takeover'|'resume'|'close'|'back'|'forward'|'reload'}):Promise<void>;
 annotations(input:{pageId:string;threadId:string;state:BrowserAnnotationState}):Promise<void>;
 reply(input:{pageId:string;changeId:string;state:BrowserAnnotationReply}):Promise<void>;
 onChanged(listener:()=>void):()=>void;
 onAnnotation(listener:(change:BrowserAnnotationChange)=>void):()=>void;
 onShow(listener:(page:BrowserPage)=>void):()=>void;
};
export type BrowserOwner={threadId:string;owner:string;requestId?:string};
export type BrowserTransport=(owner:BrowserOwner,action:string,input:Record<string,unknown>)=>Promise<unknown>;
