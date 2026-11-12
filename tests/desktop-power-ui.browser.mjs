// Isolated rendered acceptance; no desktop runtime, account, system power or model calls.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';
import {desktopPowerSettingsBrowser} from './fixtures/desktop-power-settings-browser.mjs';

const destination=resolve(process.env.HOMER_BROWSER_EVIDENCE??'.codex/scratch/power-settings-ui');
await mkdir(destination,{recursive:true});
const fixture=await desktopPowerSettingsBrowser(),errors=[],checks=[];let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['warning','error'].includes(message.type()))errors.push(message.text());});
 await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(fixture.url).origin&&route.request().method()==='GET'?route.continue():route.abort());
 const open=async scenario=>{await page.goto(fixture.url+(scenario?'?scenario='+scenario:''));await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'电源与唤醒',exact:true}).click();await page.getByRole('button',{name:'重新检查',exact:true}).waitFor();};
 const keep=()=>page.getByRole('switch',{name:'Homer 运行期间始终保持唤醒',exact:true});
 const poll=()=>page.getByRole('switch',{name:'定期唤醒检查渠道消息',exact:true});
 const scheduled=()=>page.getByRole('switch',{name:'为定时消息自动唤醒',exact:true});
 const panel=()=>page.getByRole('tabpanel',{name:'电源与唤醒',exact:true});
 const checked=async control=>await control.getAttribute('aria-checked')==='true';
 const ok=(condition,message)=>{assert.ok(condition,message);checks.push(message);};
 for(const width of [1440,320]){
  await page.setViewportSize({width,height:900});await open('');
  ok((await page.title())==='Homer 电源设置 · 隔离验证'&&page.url().startsWith(fixture.url),'intended fixture identity '+width);
  ok(await page.getByRole('switch').count()===3&&!await checked(keep())&&await checked(poll())&&await checked(scheduled()),'three controllable preferences and correct defaults '+width);
  ok((await panel().innerText()).includes('暂无支持定期补收的渠道'),'no qualified channel claim '+width);
  ok((await page.getByRole('combobox').inputValue())==='15','default polling interval '+width);
  ok(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'page has no horizontal overflow '+width);
  ok(await page.locator('.desktop-settings-content').evaluate(node=>node.scrollWidth===node.clientWidth),'settings content has no horizontal overflow '+width);
  ok(await keep().evaluate(node=>{const box=node.getBoundingClientRect();return box.width>=44&&box.height>=44;}),'switch meets 44px target '+width);
  await page.screenshot({path:join(destination,'power-default-'+width+'.png')});
  await keep().focus();await page.keyboard.press('Space');ok(await checked(keep()),'keyboard saves keep-awake preference '+width);
  await page.getByRole('combobox').selectOption('30');ok(await page.getByRole('combobox').inputValue()==='30','interval saves '+width);
  await poll().click();ok(!await checked(poll())&&await page.getByRole('combobox').isDisabled(),'poll toggle disables interval without changing scheduled preference '+width);
  ok(await checked(scheduled()),'scheduled preference remains independent '+width);
  await page.getByRole('button',{name:'授权系统唤醒',exact:true}).click();await page.getByRole('button',{name:'重试授权',exact:true}).waitFor();
  await page.getByRole('button',{name:'重新检查',exact:true}).click();ok((await page.locator('#fixture-note').innerText()).endsWith('授权 1'),'denied authorization is not automatically retried '+width);
  await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.getByRole('dialog',{name:'设置',exact:true}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='设置');ok(true,'close restores settings trigger focus '+width);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'电源与唤醒',exact:true}).click();ok(await checked(keep())&&!await checked(poll()),'saved intentions survive closing settings '+width);
 }
 await open('save-failure');await keep().click();ok(await checked(keep())&&await page.getByRole('button',{name:'重试保存',exact:true}).isDisabled(),'failed save retains selection and requests confirmation');
 await page.getByRole('button',{name:'重新检查',exact:true}).click();ok(await checked(keep()),'read-back preserves unsaved selection');
 await page.getByRole('button',{name:'重试保存',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('已保存。',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.activeElement?.textContent==='重新检查');ok(true,'removed retry control restores focus to recheck');
 await open('read-failure');ok(await page.getByRole('switch').count()===0,'unknown state does not invent defaults');await page.getByRole('button',{name:'重新检查',exact:true}).click();ok(await page.getByRole('switch').count()===3,'manual read recovers controls');
 await open('auth-failure');await page.getByRole('button',{name:'授权系统唤醒',exact:true}).click();ok((await panel().innerText()).includes('授权结果未能确认'),'authorization failure is explicit');await page.getByRole('button',{name:'重新检查',exact:true}).click();ok(!(await panel().innerText()).includes('授权结果未能确认')&&await page.getByRole('button',{name:'授权系统唤醒',exact:true}).isEnabled(),'manual read clears the resolved authorization error');
 await open('unavailable');const unavailable=await panel().innerText();ok(await checked(poll())&&await checked(scheduled())&&unavailable.includes('不支持系统唤醒')&&unavailable.includes('运行服务未连接')&&!unavailable.includes('下次系统唤醒请求'),'unavailable wake retains preferences without scheduled claim');
 await page.getByText('当前环境不支持系统唤醒，已保存的自动唤醒偏好会保留。',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:join(destination,'power-unavailable-320.png')});
 await open('scheduled');await page.getByText(/下次系统唤醒请求/).waitFor();ok((await panel().innerText()).includes('不代表电脑必定准时醒来'),'confirmed request is distinct from real wake acceptance');await page.getByText(/下次系统唤醒请求/).scrollIntoViewIfNeeded();await page.screenshot({path:join(destination,'power-scheduled-320.png')});
 await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'电源与唤醒',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('switch').first().waitFor();ok(await page.getByRole('tab',{name:'电源与唤醒',exact:true}).getAttribute('aria-selected')==='true','keyboard opens power category');
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'设置',exact:true}).waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='设置');ok(true,'Escape restores trigger focus');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:checks.length,errors,evidence:destination},null,2));
}finally{await browser?.close();await fixture.close();}
