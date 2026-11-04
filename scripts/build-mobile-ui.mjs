import {build} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Inline the same Vite entry so neither platform needs a file-origin server.
export async function buildMobileUi(output='mobile/.generated'){
 await import('./build-preview-annotation.mjs');
 const root=fileURLToPath(new URL('../',import.meta.url)),out=resolve(root,output);
 await build({root:resolve(root,'ui'),configFile:resolve(root,'ui/vite.config.ts'),configLoader:'runner',logLevel:'warn',
  plugins:[{name:'mobile-without-live-debugger',transformIndexHtml:{order:'pre',handler:html=>html.replace(/<!-- impeccable-live-start -->[\s\S]*?<!-- impeccable-live-end -->/g,'')}},viteSingleFile()],base:'./',build:{outDir:out,emptyOutDir:true,assetsInlineLimit:Number.MAX_SAFE_INTEGER}});
 let html=readFileSync(resolve(out,'index.html'),'utf8');
 // Only chat.mjs enters the native bundle; keep emitted license notices inside it.
 const notices=JSON.stringify(readFileSync(resolve(out,'assets/task-status-NOTICES.txt'),'utf8')).replace(/</g,'\\u003c');
 html=html.replace('</head>','<script type="application/json" id="homer-third-party-notices">'+notices+'</script></head>');
 html=html.replace('<head>','<head><meta name="homer-mobile" content="true">').replace(/<link[^>]+rel="icon"[^>]*>/g,'');
 if(/<script[^>]+src=|<link[^>]+(?:stylesheet|modulepreload)/i.test(html))throw Error('mobile_ui_external_asset');
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'index.html'),html);writeFileSync(resolve(out,'chat.mjs'),'export default '+JSON.stringify(html)+';\n');
 writeFileSync(resolve(out,'chat.d.mts'),'declare const html:string; export default html;\n');
 return {html};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildMobileUi(process.argv[2]);
