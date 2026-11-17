import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
const require=createRequire(new URL('../../package.json',import.meta.url));
const result=buildSync({entryPoints:[fileURLToPath(new URL('../../ui/process-nodes.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
const exports=module.exports;
export const {ProcessNodeView,ProcessMessageContent}=exports;
export function ProcessDetailHarness({node,viewOnly=false,...props}){
 return React.createElement(viewOnly?ProcessNodeView:ProcessMessageContent,{...props,node});
}
