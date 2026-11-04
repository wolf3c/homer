import {readFileSync,existsSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname,join} from "node:path";
import { defineConfig } from "vite";

const statusRequire=createRequire(import.meta.url);
function taskStatusNotices(){
 const files=['LICENSE-assistant-ui','LICENSE-shadcn','LICENSE-tw-animate'];
 const notices=files.map(name=>name+'\n'+readFileSync(new URL('./vendor/task-status/'+name,import.meta.url),'utf8'));
 notices.push('Locally modified Agentation 3.1.2\n'+readFileSync(new URL('./vendor/agentation-3.1.2/MODIFIED-SOURCE.md',import.meta.url),'utf8'));
 notices.push('@annotorious/react, @annotorious/annotorious, @annotorious/core\n'+readFileSync(new URL('./vendor/assistant-ui/LICENSE-annotorious',import.meta.url),'utf8'));
 for(const name of ['@radix-ui/react-popover','lucide-react','diff','parse-diff','class-variance-authority','clsx','tailwind-merge','tailwindcss','@base-ui/react','@base-ui/utils','reselect','use-sync-external-store','react','react-dom','scheduler','@dnd-kit/abstract','@dnd-kit/collision','@dnd-kit/dom','@dnd-kit/geometry','@dnd-kit/react','@dnd-kit/state','@preact/signals-core','tslib','agentation','@mantine/hooks','react-resizable-panels']){
  let base=dirname(statusRequire.resolve(name==='@base-ui/utils'?name+'/package.json':name));
  while(!existsSync(join(base,'package.json'))||JSON.parse(readFileSync(join(base,'package.json'),'utf8')).name!==name){const parent=dirname(base);if(parent===base)throw Error('task_status_package_missing: '+name);base=parent;}
  const license=['LICENSE','LICENSE.md','LICENSE.txt','license'].find(file=>existsSync(join(base,file)));if(!license)throw Error('task_status_license_missing: '+name);
  notices.push(name+'\n'+readFileSync(join(base,license),'utf8'));
 }
 return notices.join('\n\n');
}
export default defineConfig({
  plugins:[{name:'task-status-notices',apply:'build',generateBundle(){this.emitFile({type:'asset',fileName:'assets/task-status-NOTICES.txt',source:taskStatusNotices()});}}],
  build: { assetsInlineLimit: 0, outDir: "../dist/web", emptyOutDir: true, sourcemap: false,
    rolldownOptions: { onwarn(warning, forward) {
      // This SPA has no React Server Components boundary. Library directives
      // are irrelevant to the browser bundle; retain every other warning.
      if (warning.code === "MODULE_LEVEL_DIRECTIVE" && warning.message.includes("use client")) return;
      forward(warning);
    } },
  },
  server: { proxy: { "/api": "http://127.0.0.1:4780", "/branding": "http://127.0.0.1:4780" } },
});
