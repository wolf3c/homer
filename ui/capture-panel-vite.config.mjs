import {defineConfig} from 'vite';

export default defineConfig({
 base:'./',
 publicDir:false,
 build:{outDir:'../dist/capture-panel',emptyOutDir:true,rollupOptions:{input:'capture-panel.html'}},
});
