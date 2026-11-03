// Explicit test/demo workspace. Never used by the product launcher by default.
import {mkdirSync,mkdtempSync,cpSync,symlinkSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
export function seamlessFixture(withUi=false){
 const root=resolve('.'),parent=join(root,'.codex/scratch/seamless-update');mkdirSync(parent,{recursive:true});
 const base=mkdtempSync(join(parent,'gateway-e2e-'));
 for(const name of ['src','scripts','prompts','assets',...(withUi?['ui']:[]),'package.json','package-lock.json','tsconfig.json'])cpSync(join(root,name),join(base,name),{recursive:true,filter:path=>!/(?:^|\/)(?:node_modules|dist|\.vite)(?:\/|$)/.test(path)});
 symlinkSync(join(root,'node_modules'),join(base,'node_modules'),'dir');
 for(const name of ['home','runtime','workspace/materials'])mkdirSync(join(base,name),{recursive:true});
 writeFileSync(join(base,'src/synthetic-engine.ts'),readFileSync(join(root,'tests/fixtures/seamless-engine.ts'),'utf8').replace('../../src/engine.js','./engine.js'));
 const host=join(base,'src/dev-host.ts');
 writeFileSync(host,'import {syntheticEngine} from "./synthetic-engine.js";\n'+readFileSync(host,'utf8').replace('engineError, codexVersion','engineError').replace('await output(message);\n    });','await output(message);\n    }, syntheticEngine);').replaceAll(/codexVersion\([^()]*\)/g,'"synthetic-injected-engine"'));
 const config=join(base,'synthetic.config.json');writeFileSync(config,JSON.stringify({workspace:'workspace',runtime:'runtime',codexHome:join(base,'home'),codexBin:'/usr/bin/false',model:'synthetic-only',requiresOpenaiAuth:false,mainTimeoutMs:600000,stopGraceMs:100}));
 return {root:base,configPath:config,base};
}
