// Real product UI and SQLite projection on the isolated status browser fixture.
import assert from 'node:assert/strict';
import {join} from 'node:path';
export default async function flatStatus(page,{destination}={}){
 const panel=page.locator('#task-status-panel'),trigger=page.locator('#task-status-trigger'),checks=[];
 const capture=async name=>{if(destination)await page.screenshot({path:join(destination,name+'.png'),animations:'disabled'});};
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  await page.waitForFunction(w=>document.querySelector('#task-status-trigger')?.hasAttribute('aria-haspopup')===(w<1120),width);
  if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();
  const purchase=panel.getByRole('button',{name:/采购选型方案/});await purchase.waitFor();
  assert.equal(await purchase.innerText(),'采购选型方案');
  assert.equal(await page.locator('#task-interaction-status-approval').getByRole('button',{name:'允许本次操作'}).count(),1);
  const ordinary=panel.getByRole('button',{name:'活动资料整理',exact:true});assert.equal(await ordinary.innerText(),'活动资料整理');
  if(await purchase.getAttribute('aria-expanded')!=='true')await purchase.click();
  for(const name of ['资料整理 Worker','收费数据 Worker','成本分析 Worker','税费资料 Worker'])assert.equal(await panel.getByRole('button',{name:new RegExp(name)}).count(),1);
  assert.ok(await panel.getByText('执行状态待核实',{exact:true}).isVisible());
  assert.equal(await panel.getByRole('button',{name:/九月供应商比较报告/}).count(),0);
  const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('#task-status-panel [data-worker-id]:not([data-merged])')].map(el=>Math.round(el.getBoundingClientRect().left))}));
  assert.equal(geometry.scrollWidth,width);assert.equal(new Set(geometry.rows.slice(0,4)).size,1);
  assert.equal(await panel.getByRole('button',{name:/待我处理|前往原待答卡/}).count(),0);
  await panel.getByRole('button',{name:'已归档',exact:true}).click();assert.equal(await purchase.getAttribute('aria-expanded'),'true');
  const archive=panel.getByRole('button',{name:'九月供应商比较报告',exact:true});await archive.click();
  await panel.getByText('Worker 本轮：已回复',{exact:true}).waitFor();
  await panel.getByRole('region',{name:'已归档事项',exact:true}).getByRole('button',{name:'执行记录'}).click();await panel.getByText('会话原文',{exact:true}).click();
  await panel.getByText('合成报告已核对',{exact:true}).waitFor();
  await panel.getByText('交办与答复原文',{exact:true}).click();await panel.getByRole('button',{name:/九月供应商比较报告已发送/}).waitFor();
  const file=panel.getByText('九月供应商比较报告.md',{exact:true});await file.waitFor();
  await capture('archived-status-'+width);checks.push({width,geometry});
  if(width===320){await file.click();await page.locator('#canvas-panel').waitFor();}
  else if(width!==1440){await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.id==='task-status-trigger');}
 }
 await page.locator('#canvas-panel').getByText('合成报告，当前版本已完成。',{exact:true}).waitFor();await capture('archived-file-320');
 return {checksPassed:4,checks,archivedFileVerified:true};
}
