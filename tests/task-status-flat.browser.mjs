// Requirements-derived synthetic UI regression for the 2026-10-24 approved
// single business layer. Uses the real product build and read-only fixture.
import assert from 'node:assert/strict';
import {join} from 'node:path';
export default async function flatStatus(page,{destination}={}){
 const errors=[],checks=[],onError=error=>errors.push(error.message);page.on('pageerror',onError);
 const capture=async name=>{if(destination)await page.screenshot({path:join(destination,name+'.png'),animations:'disabled'});};
 try{
  await page.locator('#task-status-trigger').waitFor();
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?1000:844});
   const trigger=page.locator('#task-status-trigger'),panel=page.locator('#task-status-panel');
   await page.waitForFunction(()=>document.querySelector('#task-status-trigger')?.title.includes('工作中'));
   if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();await panel.waitFor();
   const root=panel.getByRole('button',{name:/采购选型方案/});if(await root.getAttribute('aria-expanded')!=='true')await root.click();
   for(const name of ['资料整理 Worker','收费数据 Worker','成本分析 Worker','税费资料 Worker'])assert.equal(await panel.getByRole('button',{name:new RegExp(name)}).count(),1);
   const research=panel.getByRole('button',{name:/资料整理 Worker/});if(await research.getAttribute('aria-expanded')!=='true')await research.click();
   await panel.getByText('核对服务条款',{exact:true}).waitFor();
   assert.equal(await panel.getByLabel('子 Worker',{exact:true}).count(),0);assert.ok(!(await panel.innerText()).includes('含子 Worker'));
   assert.match(await panel.locator('[data-count="working"]').innerText(),/^3 /);assert.match(await panel.locator('[data-count="done"]').innerText(),/^1 /);
   const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,pageScrollRange:document.documentElement.scrollHeight-document.documentElement.clientHeight,rows:[...document.querySelectorAll('#task-status-panel [data-worker-id]')].map(el=>({left:Math.round(el.getBoundingClientRect().left)}))}));
   assert.equal(geometry.scrollWidth,width);assert.equal(geometry.pageScrollRange,0);assert.equal(new Set(geometry.rows.slice(0,4).map(row=>row.left)).size,1);
   await capture('flat-status-'+width);checks.push({width,directWorkers:4,geometry});
   if(width!==1440){await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);}
  }
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'预览',exact:true}).click();await page.locator('#canvas-panel').waitFor();
  const trigger=page.locator('#task-status-trigger');if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();await page.locator('#task-status-panel').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);await capture('preview-and-status-1440');assert.deepEqual(errors,[]);
  return {checksPassed:4,checks,previewPreserved:true,errors};
 }finally{page.off('pageerror',onError);}
}
