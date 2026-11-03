// Test build only: observe the real public composer API; never replace its store.
import {resolve} from 'node:path';
import ts from 'typescript';
import {build,mergeConfig} from 'vite';
import config from '../../ui/vite.config.ts';
const outDir=resolve(process.env.HOMER_COMPONENT_BUILD??'.codex/scratch/ui-component-simplification/batch-observer-web');
await build(mergeConfig(config,{root:resolve('ui'),configFile:false,plugins:[{
 name:'synthetic-readonly-composer-observer',
 transform(code,id){
  if(!id.endsWith('/ui/homer-app.tsx'))return;
  const source=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const composer=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='MainComposer');
  const aui=composer?.body?.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(source)==='aui'&&d.initializer?.getText(source)==='useAui()'));
  if(!aui)throw Error('MainComposer public API observation point missing');
  return {code:code.slice(0,aui.end)+';globalThis.__homerTestGetComposer=()=>aui.composer().getState();'+code.slice(aui.end),map:null};
 },
}],build:{outDir,emptyOutDir:true}}));
