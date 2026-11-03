import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const result=buildSync({stdin:{contents:'export * from "./process-message"; export * from "./process-details";',resolveDir:fileURLToPath(new URL('../../ui/',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime','@assistant-ui/react'],loader:{'.css':'empty'},logLevel:'silent'});
const module={exports:{}};Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
export const {projectProcessMessage,toolPartStatus,useProcessDetails,useProcessParts}=module.exports;
