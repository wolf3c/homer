import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {useProcessDetails} from './tool-ui-loader.mjs';
const require=createRequire(new URL('../../package.json',import.meta.url));
const result=buildSync({entryPoints:[fileURLToPath(new URL('../../ui/process-nodes.tsx',import.meta.url))],bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
const exports=module.exports;
export const {ProcessNodeView,ProcessMessageContent,ProcessObservationContext,ProcessDetailsContext}=exports;
// Exercise the migrated production owner rather than emulating a local view
// cache. Legacy synthetic rows deliberately have no new call body.
export function ProcessDetailHarness({node,load,viewOnly=false,...props}){
 const messages=React.useMemo(()=>[{id:node.messageId??node.id,role:'assistant',text:'',process:node}],[node]);
 const details=useProcessDetails(messages,node.threadId,'synthetic-epoch',load),View=viewOnly?ProcessNodeView:ProcessMessageContent;
 return React.createElement(ProcessDetailsContext.Provider,{value:details.load},React.createElement(View,{...props,node:details.messages[0].process}));
}
