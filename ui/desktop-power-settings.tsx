import {useCallback,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {Button} from '@base-ui/react/button';
import {POWER_INTERVALS,type DesktopPowerState,type PowerPreferences} from '../src/desktop-power';

type PowerBridge={state:()=>Promise<DesktopPowerState>;update:(patch:Partial<PowerPreferences>)=>Promise<DesktopPowerState>;authorize:()=>Promise<DesktopPowerState>;onChanged:(callback:()=>void)=>()=>void};
declare global{interface Window{homerDesktopPower?:PowerBridge;}}

export function DesktopPowerSettings(){
 const bridge=window.homerDesktopPower,id=useId();
 const [state,setState]=useState<DesktopPowerState>(),[draft,setDraft]=useState<Partial<PowerPreferences>>({});
 const [reading,setReading]=useState(!!bridge),[busy,setBusy]=useState(false),[unconfirmed,setUnconfirmed]=useState(false);
 const [notice,setNotice]=useState<''|'saved'|'save-failed'|'authorize-failed'>('');
 const life=useRef(0),readAttempt=useRef(0),pending=useRef(false);
 const recheck=useRef<HTMLButtonElement>(null),retry=useRef<HTMLButtonElement|null>(null),restoreFocus=useRef(false);
 const retryRef=useCallback((node:HTMLButtonElement|null)=>{
  if(!node&&retry.current===document.activeElement)restoreFocus.current=true;
  retry.current=node;
 },[]);
 useLayoutEffect(()=>{if(!busy&&!reading&&restoreFocus.current){restoreFocus.current=false;recheck.current?.focus();}});
 const read=useCallback(async()=>{
  if(!bridge)return;
  const owner=life.current,attempt=++readAttempt.current,current=()=>owner===life.current&&attempt===readAttempt.current;
  setReading(true);
  try{
   const value=await bridge.state();if(!current())return;
   setState(value);setUnconfirmed(false);setNotice(old=>old==='authorize-failed'?'':old);
   if(!pending.current)setDraft(old=>Object.entries(old).every(([key,preference])=>preference===value.preferences[key as keyof PowerPreferences])?{}:old);
  }catch{if(current())setUnconfirmed(true);}
  finally{if(current())setReading(false);}
 },[bridge]);
 useEffect(()=>{
  life.current++;const unsubscribe=bridge?.onChanged(()=>void read());void read();
  return()=>{life.current++;readAttempt.current++;pending.current=false;unsubscribe?.();};
 },[bridge,read]);
 async function run(patch?:Partial<PowerPreferences>){
  if(!bridge||pending.current)return;
  if(retry.current===document.activeElement)restoreFocus.current=true;
  pending.current=true;setBusy(true);setNotice('');readAttempt.current++;
  const owner=life.current,current=()=>owner===life.current,next={...draft,...patch};
  if(patch)setDraft(next);
  try{
   const value=await (patch?bridge.update(next):bridge.authorize());if(!current())return;
   readAttempt.current++;setReading(false);setState(value);setUnconfirmed(false);
   if(patch){setDraft({});setNotice('saved');}
  }catch{if(current()){readAttempt.current++;setReading(false);setUnconfirmed(true);setNotice(patch?'save-failed':'authorize-failed');}}
  finally{if(current()){pending.current=false;setBusy(false);}}
 }
 const preferences=state?{...state.preferences,...draft}:undefined,dirty=Object.keys(draft).length>0;
 const disabled=busy||reading||unconfirmed||!state?.supported;
 const wake=state?.wake,nextAt=wake?.status==='scheduled'&&wake.nextAt!==null?new Date(wake.nextAt):undefined;
 const validNext=nextAt&&Number.isFinite(nextAt.valueOf());
 let wakeStatus='当前无需系统唤醒。';
 if(wake?.error==='wake_cleanup_unconfirmed')wakeStatus='旧系统唤醒事件的清理未能确认。请重新检查；需要时重新授权，或在下次启动时核对。';
 else if(!wake?.supported||wake.authorization==='unavailable'||wake.status==='unavailable')wakeStatus='当前环境不支持系统唤醒，已保存的自动唤醒偏好会保留。';
 else if(wake.authorization==='denied')wakeStatus='系统唤醒未获授权，不会自动重复请求；可在这里主动重试。';
 else if(wake.authorization==='required'||wake.status==='authorization-required')wakeStatus='自动唤醒需要系统授权，当前尚未生效。';
 else if(wake.status==='error'||wake.status==='scheduled'&&!validNext)wakeStatus='系统唤醒计划未能确认，请重新检查。';
 else if(!state?.runtimeAvailable)wakeStatus='运行服务未连接，自动唤醒尚未生效。';
 return <div className="desktop-permissions desktop-power-settings" aria-busy={reading||busy}>
  <h2>电源与唤醒</h2>
  <p>在需要时保持本机运行，按已保存的偏好请求系统唤醒。</p>
  {!bridge?<p role="status">请在 Homer 桌面版中管理本机电源。</p>:<>
   {unconfirmed&&<p role="status">状态未能确认，请重新检查。已保存设置及当前选择保留。</p>}
   {state?.supported===false&&<p role="status">当前环境不支持本机电源控制，已保存偏好保留。</p>}
   {!state&&reading&&<p role="status">正在读取本机电源设置…</p>}
   {state&&preferences&&<>
    <section aria-label="执行期间保持唤醒">
     <div className="desktop-permission-heading"><h3>执行期间保持唤醒</h3><span>自动</span></div>
     <p>Homer、Worker 或受管工具执行时自动防止闲置休眠，仅等待用户决定时不保持。不会阻止主动休眠或合盖，也不会自动解锁。</p>
     <p role="status">{unconfirmed?'当前保护状态未确认。':!state.supported?'当前保护不可用。':!state.runtimeAvailable?'运行服务未连接，执行保护状态未确认。':state.protectionError?'保持唤醒未能生效，请重新检查。':state.protection==='display'?'当前保持屏幕与系统唤醒。':state.protection==='system'?'当前防止系统闲置休眠，允许熄屏。':'当前未请求保持唤醒。'}</p>
    </section>
    <section>
     <div className="desktop-permission-heading"><h3 id={id+'-keep'}>Homer 运行期间始终保持唤醒</h3><Button type="button" role="switch" className="desktop-power-switch" aria-labelledby={id+'-keep'} aria-describedby={id+'-keep-help'} aria-checked={preferences.keepAwake} disabled={disabled} onClick={()=>void run({keepAwake:!preferences.keepAwake})}><span aria-hidden="true"/></Button></div>
     <p id={id+'-keep-help'}>宿主运行时持续防止闲置休眠，允许正常熄屏。隐藏窗口仍会保持，确认退出 Homer 后停止。</p>
    </section>
    <section>
     <div className="desktop-permission-heading"><h3 id={id+'-poll'}>定期唤醒检查渠道消息</h3><Button type="button" role="switch" className="desktop-power-switch" aria-labelledby={id+'-poll'} aria-describedby={id+'-poll-help'} aria-checked={preferences.pollMessages} disabled={disabled} onClick={()=>void run({pollMessages:!preferences.pollMessages})}><span aria-hidden="true"/></Button></div>
     <p id={id+'-poll-help'}>休眠时按间隔尝试唤醒补收。消息可能等待下一轮检查及网络重连，清醒时仍沿原渠道接收。较短间隔会增加唤醒次数和耗电。</p>
     <label className="desktop-power-interval">检查间隔<select value={preferences.pollIntervalMinutes} disabled={disabled||!preferences.pollMessages} onChange={event=>void run({pollIntervalMinutes:Number(event.target.value)})}>{POWER_INTERVALS.map(minutes=><option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select></label>
     <p>{state.channels.length?'支持补收的渠道：'+state.channels.join('、'):'暂无支持定期补收的渠道。偏好会保留，当前不会为渠道检查唤醒。'}</p>
    </section>
    <section>
     <div className="desktop-permission-heading"><h3 id={id+'-scheduled'}>为定时消息自动唤醒</h3><Button type="button" role="switch" className="desktop-power-switch" aria-labelledby={id+'-scheduled'} aria-describedby={id+'-scheduled-help'} aria-checked={preferences.wakeScheduled} disabled={disabled} onClick={()=>void run({wakeScheduled:!preferences.wakeScheduled})}><span aria-hidden="true"/></Button></div>
     <p id={id+'-scheduled-help'}>为未来定时消息请求系统唤醒。关闭后，清醒时仍照常投递；休眠期间到期的消息在恢复后补投。</p>
    </section>
    <section aria-label="系统唤醒状态">
     <h3>系统唤醒状态</h3>
     <p role="status">{unconfirmed?'系统唤醒状态未确认。':validNext&&state.runtimeAvailable&&wake?.supported&&wake.authorization==='authorized'?<>下次系统唤醒请求：<time dateTime={nextAt.toISOString()}>{nextAt.toLocaleString('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>。请求已确认，不代表电脑必定准时醒来。</>:wakeStatus}</p>
     {wake?.supported&&!unconfirmed&&(wake.authorization==='required'||wake.authorization==='denied')&&<div className="desktop-permission-actions"><Button type="button" disabled={disabled} onClick={()=>void run()}>{wake.authorization==='denied'?'重试授权':'授权系统唤醒'}</Button></div>}
    </section>
   </>}
   {(notice||dirty&&!busy)&&<p role="status">{notice==='authorize-failed'?'授权结果未能确认，请重新检查。':dirty?unconfirmed?'保存结果未确认，已保留所选设置。请重新检查。':'所选设置尚未保存，请重试保存。':notice==='saved'?'已保存。':'已确认所选设置。'}</p>}
   <div className="desktop-permission-actions"><Button type="button" ref={recheck} disabled={busy||reading} onClick={()=>void read()}>重新检查</Button>{dirty&&<Button type="button" ref={retryRef} focusableWhenDisabled disabled={disabled} onClick={()=>void run(draft)}>重试保存</Button>}</div>
  </>}
 </div>;
}
