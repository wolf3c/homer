// Exercise the actual in-file interaction owner without mounting HomerApp or
// changing its production exports. Transport is the only injected dependency.
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
export function interactionComponent(post){
 const app=readFileSync(new URL('../../ui/homer-app.tsx',import.meta.url),'utf8');
 const imports=['import {useState,useEffect,useLayoutEffect,useRef} from "react";', 'import {QuestionFlow} from "./vendor/assistant-ui/question-flow";', 'import {prepareInteractionResponse} from "./conversation-client";', 'import {ElicitationForm} from "./vendor/assistant-ui/elicitation-form";', 'import {questionReply} from "../src/question-schema";', 'const fetch=globalThis.fetch;'];
 if(app.includes('import {ApprovalCard}'))imports.push('import {ApprovalCard} from "./vendor/assistant-ui/approval-card";');
 const source=imports.join('\n')+'\nexport function create(post){'+app.slice(app.indexOf('const storage ='),app.indexOf('async function post('))+app.slice(app.indexOf('function InteractionCard('),app.indexOf('function HomerApp('))+';return InteractionCard;}';
 const result=buildSync({stdin:{contents:source,resolveDir:fileURLToPath(new URL('../../ui/',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
 const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 return module.exports.create(post);
}
