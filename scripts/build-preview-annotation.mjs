import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {verifyVendor} from './patch-preview-agentation.mjs';
import{createRequire}from'node:module';
import{mkdirSync,writeFileSync}from'node:fs';

verifyVendor();

// A self-contained script is passed through the existing sandboxed HTML shell.
// It makes no external module/network requests from the opaque-origin document.
await build({configFile:false,root:fileURLToPath(new URL('../ui/',import.meta.url)),logLevel:'warn',define:{'process.env.NODE_ENV':'"production"'},build:{
 outDir:fileURLToPath(new URL('../dist/preview-annotation/',import.meta.url)),emptyOutDir:true,
 lib:{entry:fileURLToPath(new URL('../ui/annotation-frame.tsx',import.meta.url)),name:'HomerPreviewAnnotation',formats:['iife'],fileName:()=> 'runtime.js'},
 rolldownOptions:{onwarn(warning,forward){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')forward(warning);}},
}});

// Same fixed Playwright engine used by its own dom.js; no browser endpoint.
const browserOutput=fileURLToPath(new URL('../dist/browser-preview/',import.meta.url));
await build({configFile:false,root:fileURLToPath(new URL('../ui/',import.meta.url)),logLevel:'warn',resolve:{dedupe:['react','react-dom']},define:{'process.env.NODE_ENV':'"production"'},build:{outDir:browserOutput,emptyOutDir:true,lib:{entry:fileURLToPath(new URL('../ui/browser-annotation.tsx',import.meta.url)),name:'HomerBrowserAnnotation',formats:['iife'],fileName:()=> 'runtime.js',cssFileName:'runtime'},rolldownOptions:{onwarn(warning,forward){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')forward(warning);}}}});
const require=createRequire(import.meta.url),{source}=require('../node_modules/playwright-core/lib/generated/injectedScriptSource.js');
mkdirSync(browserOutput,{recursive:true});writeFileSync(browserOutput+'/automation.js',source);
