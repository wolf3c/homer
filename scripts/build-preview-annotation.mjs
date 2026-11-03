import {build} from 'vite';
import {fileURLToPath} from 'node:url';
import {verifyVendor} from './patch-preview-agentation.mjs';

verifyVendor();

// A self-contained script is passed through the existing sandboxed HTML shell.
// It makes no external module/network requests from the opaque-origin document.
await build({configFile:false,root:fileURLToPath(new URL('../ui/',import.meta.url)),logLevel:'warn',define:{'process.env.NODE_ENV':'"production"'},build:{
 outDir:fileURLToPath(new URL('../dist/preview-annotation/',import.meta.url)),emptyOutDir:true,
 lib:{entry:fileURLToPath(new URL('../ui/annotation-frame.tsx',import.meta.url)),name:'HomerPreviewAnnotation',formats:['iife'],fileName:()=> 'runtime.js'},
 rolldownOptions:{onwarn(warning,forward){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')forward(warning);}},
}});
