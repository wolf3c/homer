import React,{useState}from'react';
import{createRoot}from'react-dom/client';
import{createAnnotationDraft}from'../../ui/annotation-draft';
import{parseResourceReference,parseResourceReferences,referenceKey,referencesOf,resourceReferenceText}from'../../src/preview-reference';
const draft=createAnnotationDraft();
globalThis.demoCommit=input=>{
 const current=draft.read();if(input.baseRevision!==current.revision||input.epoch!==current.epoch)throw Error('draft_changed');
 const key=referenceKey({kind:'web',source:input.source}),refs=referencesOf(current).filter(r=>referenceKey(r)!==key);
 const reference=input.notes.length?parseResourceReference({kind:'web',source:input.source,annotations:input.notes}):undefined;
 const next=reference?[...refs,reference]:refs;if(next.length)parseResourceReferences(next);
 draft.replace(next);render();return{notes:reference?.annotations??[],revision:draft.read().revision,epoch:draft.read().epoch,changeId:input.changeId};
};
let pages=[];let output='';
globalThis.demoHost.onState(value=>{pages=value;render();});
globalThis.demoReadDraft=()=>draft.read();
globalThis.demoBumpRevision=()=>draft.replace(referencesOf(draft.read()));
function Shell(){
 const [error,setError]=useState('');
 async function action(a,id){try{await globalThis.demoHost.action(a,id);setError('');}catch(e){setError(e.message);}}
 return <aside><h1>网页内容 Demo</h1><p>React Grab · Homer 备注与草稿</p><small>隔离合成页面 · 模拟任务 · 非安装版</small>{pages.map(p=><section key={p.id}><h2>页面 {p.id.toUpperCase()} · {p.owner==='user'?'用户接手':'模拟 '+p.task}</h2><div>{['show','annotate','browse','takeover','resume'].map((a,i)=><button key={a} onClick={()=>action(a,p.id)} aria-label={a+'-'+p.id}>{['查看','批注','浏览','接手','继续'][i]}</button>)}</div><small>文档 {p.version} · {p.url}</small></section>)}<h2>原对话草稿</h2>{referencesOf(draft.read()).flatMap(r=>(r.annotations??[]).map((n,i)=><p key={n.id} className="note">{i+1}. {n.element}<br/>{n.comment.slice(0,110)}{n.comment.length>110?'…':''}</p>))}<button onClick={()=>{output=referencesOf(draft.read()).map(resourceReferenceText).join('\n\n');render();}}>发送为引用（Demo）</button><pre data-testid="sent-reference">{output}</pre>{error&&<p role="alert">{error}</p>}</aside>;
}
const root=createRoot(document.getElementById('app')!);function render(){root.render(<Shell/>);}render();
