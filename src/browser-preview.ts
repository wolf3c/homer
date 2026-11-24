import type{PreviewAnnotation,PreviewSource}from'./preview-reference.js';

// Page state is owned by Electron, annotation notes by the existing composer.
export type BrowserPage={id:string;threadId:string;owner:string;url:string;title:string;document:number;control:'user'|'agent';agentAssigned?:boolean;source:PreviewSource;resource?:string;loading?:boolean;error?:string;locationDenied?:true;locationApproval?:string};
export type PreviewLinkResult={page:BrowserPage}|{messageId:string;destination:string;title:string}|{attachment:{messageId:string;assetId:string;revision:number;resource?:string;sha256?:string;title:string}};
export type BrowserAnnotationState={document:number;active:boolean;revision:number;epoch:number;notes:PreviewAnnotation[];focusId?:string;focusRequest?:string;historyNote?:PreviewAnnotation};
export type BrowserAnnotationChange={pageId:string;document:number;baseRevision:number;epoch:number;changeId:string;notes:PreviewAnnotation[]};
export type BrowserAnnotationReply=BrowserAnnotationState&{changeId?:string;error?:string};
type PreviewDocument={pageId:string;document:number};
export type PreviewMoreAction={threadId:string}&(
 {action:'browser';page:PreviewDocument}|
 {action:'reveal'|'open';file:{messageId:string;destination:string};page?:PreviewDocument}|
 {action:'download'|'open';attachment:Extract<PreviewSource,{kind:'attachment'}>;page?:PreviewDocument}
);
export type PreviewMoreResult={requested:true}|{download:{filename:string;mime:string;bytes:ArrayBuffer}};
export type MessageFileOperation=boolean|'open';

export function previewFileCanOpen(filename:string){
 return /\.(?:txt|md|markdown|csv|tsv|json|pdf|html?|png|jpe?g|gif|webp|bmp|tiff?|mp3|wav|m4a|ogg|mp4|m4v|mov|webm)$/i.test(filename);
}
export type BrowserPreviewBridge={
 platform?:string;
 more?(input:PreviewMoreAction):Promise<PreviewMoreResult>;
 onNativePointer?(listener:(pageId:string)=>void):()=>void;
 list(threadId:string):Promise<BrowserPage[]>;
 locationGrants?():Promise<string[]>;
 revokeLocation?(key:string):Promise<string[]>;
 present(input:{pageId:string;threadId:string;bounds:{x:number;y:number;width:number;height:number}|null}):Promise<void>;
 control(input:{pageId:string;threadId:string;action:'takeover'|'resume'|'close'|'back'|'forward'|'reload'}):Promise<void>;
 annotations(input:{pageId:string;threadId:string;state:BrowserAnnotationState}):Promise<void>;
 reply(input:{pageId:string;changeId:string;state:BrowserAnnotationReply}):Promise<void>;
 onChanged(listener:()=>void):()=>void;
 onAnnotation(listener:(change:BrowserAnnotationChange)=>void):()=>void;
 onShow(listener:(page:BrowserPage,origin?:{pageId:string;document:number})=>void):()=>void;
 onLink?(listener:(link:{page:BrowserPage;href:string})=>void):()=>void;
};
export type BrowserOwner={threadId:string;owner:string;requestId?:string;runId?:string;turnId?:string};
export type BrowserTransport=(owner:BrowserOwner,action:string,input:Record<string,unknown>)=>Promise<unknown>;
