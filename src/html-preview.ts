// Public static shell only: never reads files, user data or connection identity.
export const HTML_PREVIEW_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src about:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts";
export const htmlPreviewShell = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>隔离 HTML 预览</title><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><body><script>
let frame;
const childTypes=['homer-preview-ready','homer-preview-connected','homer-preview-active','homer-preview-notes','homer-preview-runtime-error','homer-preview-location-missing'];
addEventListener('message',event=>{
  if(frame&&event.source===frame.contentWindow&&childTypes.includes(event.data?.type)){
    parent.postMessage(event.data,'*');return;
  }
  if(event.source===parent&&(location.href==='about:srcdoc'||event.origin===new URL(location.href).origin)&&frame&&['homer-preview-connect','homer-preview-replace'].includes(event.data?.type)){
    frame.contentWindow.postMessage(event.data,'*');return;
  }
  if(event.source!==parent||(location.href!=='about:srcdoc'&&event.origin!==new URL(location.href).origin)||event.data?.type!=='homer-html-preview'||typeof event.data.html!=='string')return;
  frame=document.createElement('iframe');
  frame.title='隔离交互内容';frame.setAttribute('sandbox','allow-scripts');
  const runtime=typeof event.data.runtime==='string'?event.data.runtime:'';
  const script=runtime?'<script>'+runtime.replace(/<\\/script/gi,'<\\\\/script')+'<'+ '/script>':'';
  frame.srcdoc=event.data.html+script;
  document.body.replaceChildren(frame);
});
</script></body></html>`;
