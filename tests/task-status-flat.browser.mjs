// Complete product UI and SQLite projection on the isolated status browser fixture.
import assert from 'node:assert/strict';
import {join} from 'node:path';

export default async function flatStatus(page,{destination}={}){
 const panel=page.locator('#task-status-panel'),trigger=page.locator('#task-status-trigger'),checks=[];
 const detailReads=[];
 const observe=request=>{if(/^\/api\/tasks\/(?!list\/)/.test(new URL(request.url()).pathname))detailReads.push(request.url());};
 page.on('request',observe);
 try{
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:width===1440?900:844});
   await page.waitForFunction(w=>document.querySelector('#task-status-trigger')?.hasAttribute('aria-haspopup')===(w<1120),width);
   if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
   const current=panel.getByRole('region',{name:'当前事项',exact:true});
   const purchase=current.getByRole('region',{name:'采购选型方案',exact:true});
   await purchase.getByText('采购选型方案',{exact:true}).click();
   assert.equal(await purchase.locator('.status-task-title').innerText(),'采购选型方案');
   assert.equal(await purchase.getByRole('button',{name:'采购选型方案'}).getAttribute('aria-pressed'),'true');
   assert.ok(await purchase.getByRole('img',{name:'4 个 Worker'}).isVisible());
   const uncertain=current.getByRole('region',{name:'活动资料整理',exact:true});
   assert.equal(await uncertain.locator('.status-task-title').innerText(),'活动资料整理');
   assert.equal(await uncertain.getByRole('img',{name:'运行中'}).count(),0);
   assert.equal(await page.locator('#task-interaction-status-approval').getByRole('button',{name:'允许本次操作'}).count(),1);
   assert.equal(await panel.getByText('九月供应商比较报告',{exact:true}).count(),0);
   const archiveToggle=panel.getByRole('button',{name:'已归档',exact:true});
   await archiveToggle.press('Enter');
   const archive=panel.getByRole('region',{name:'已归档事项',exact:true});
   const report=archive.getByRole('region',{name:'九月供应商比较报告',exact:true});
   await report.getByText('九月供应商比较报告',{exact:true}).click();
   assert.ok(await purchase.isVisible());
   assert.equal(await report.locator('.status-task-title').innerText(),'九月供应商比较报告');
   assert.ok(await report.getByRole('img',{name:'1 个 Worker'}).isVisible());
   assert.equal(await archive.locator('[data-todo-id] :is(button, [aria-expanded], details)').count(),0);
   assert.equal(await panel.getByText(/执行记录|会话原文|资料整理 Worker|九月供应商比较报告\.md/).count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(destination)await page.screenshot({path:join(destination,'archived-status-'+width+'.png'),animations:'disabled'});
   if(width!==1440){
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement?.id==='task-status-trigger');
   }
   checks.push({width});
  }
  assert.deepEqual(detailReads,[]);
 }finally{page.off('request',observe);}
 // The already delivered attachment remains accessible from its main conversation entry.
 await page.getByRole('button',{name:/九月供应商比较报告\.md/}).click();
 const preview=page.locator('#canvas-panel');
 await preview.getByText('合成报告，当前版本已完成。',{exact:true}).waitFor();
 return {checksPassed:4,checks,conversationFileVerified:true};
}
