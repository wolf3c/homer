import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { builtinEnvironment } from './builtin-bootstrap.mjs';

const resources=resolve(process.argv[2]??'.codex/scratch/builtin-capabilities-implementation/runtime');
const base=resolve('.codex/scratch/builtin-capabilities-implementation/browser');mkdirSync(base,{recursive:true});
const directory=mkdtempSync(join(base,'cold-'));
Object.assign(process.env,builtinEnvironment(resources,join(directory,'Homer/codex')));
mkdirSync(process.env.HOME,{recursive:true});
const {chromium}=createRequire(join(resources,'package.json'))('playwright');
let requests=0;
const server=createServer((req,res)=>{requests++;res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="en"><title>Homer controlled fixture</title><style>body{font:22px system-ui;max-width:650px;margin:80px auto}input,button{font:inherit;padding:12px}</style><h1>Homer local browser acceptance</h1><form><label>Note <input name="note" required></label><button>Save locally</button></form><output aria-live="polite"></output><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("output").textContent="Saved: "+document.querySelector("input").value}</script>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({channel:'chromium',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:650}});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByRole('textbox',{name:'Note'}).fill('cold HOME verified');
 await page.getByRole('button',{name:'Save locally'}).click();
 assert.equal(await page.locator('output').textContent(),'Saved: cold HOME verified');
 await page.screenshot({path:join(directory,'local-browser-interaction.png')});
 await page.goto('chrome://credits');
 const credits=await page.content();assert.ok(credits.length>10000);
 writeFileSync(join(directory,'Chromium-THIRD-PARTY-NOTICES.html'),credits);
 const receipt={passed:true,browser:browser.version(),coldHome:true,onlyControlledLoopbackRequests:true,requests,actualFillClickAndStateVerified:true,screenshot:join(directory,'local-browser-interaction.png'),model:false,realAccount:false};
 writeFileSync(join(directory,'browser-verification.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
