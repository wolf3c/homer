// Inspect and point at the actual opaque iframe; never activates native Start.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function actualClick(p,rect){const {x,y,width,height}=rect;for(const type of ['mouseMoved','mousePressed','mouseReleased'])await p.command('Input.dispatchMouseEvent',{type,x:x+width/2,y:y+height/2,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})});}
export async function inspectHtmlFrame(chrome,p,test){
 for(let n=0;n<150;n++){
  const {targetInfos}=await chrome.command('Target.getTargets');
  for(const target of targetInfos.filter(t=>t.type==='iframe'&&t.browserContextId===p.browserContextId)){
   const {sessionId}=await chrome.command('Target.attachToTarget',{targetId:target.targetId,flatten:true});let keep=false;
   try{
    const {frameTree}=await chrome.command('Page.getFrameTree',{},sessionId),frames=[];const walk=n=>{frames.push(n.frame);for(const c of n.childFrames??[])walk(c);};walk(frameTree);
    for(const item of frames.filter(x=>x.url==='about:srcdoc')){
     const {executionContextId}=await chrome.command('Page.createIsolatedWorld',{frameId:item.id,worldName:'html-preview-inspection'},sessionId);
     const evaluate=async expression=>{const r=await chrome.command('Runtime.evaluate',{contextId:executionContextId,expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
     if(!await evaluate(test))continue;keep=true;
     await evaluate('window.__all=(s,r=document)=>[...r.querySelectorAll(s),...[...r.querySelectorAll("*")].flatMap(e=>e.shadowRoot?window.__all(s,e.shadowRoot):[])];window.__q=s=>window.__all(s)[0]');
     const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await sleep(40);}throw Error('frame_condition_timeout: '+expression);};
     return {evaluate,until,sessionId,close:async()=>{try{await chrome.command('Target.detachFromTarget',{sessionId});}catch(error){if(!/No session with given id|Session with given id not found/.test(String(error)))throw error;}}};
    }
   }finally{if(!keep)await chrome.command('Target.detachFromTarget',{sessionId});}
  }
  await sleep(40);
 }
 throw Error('html_preview_frame_missing: '+test);
}
