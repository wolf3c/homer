import {useCallback,useEffect,useImperativeHandle,useLayoutEffect,useRef,useState,type KeyboardEvent,type Ref} from 'react';
import homerLogo from '../assets/branding/odysseus-20261030/homer-odysseus-64.png';
import type {WebState} from '../src/web-contract';
import {DesktopChatApps} from './desktop-chat-apps';
import {FeatureTourDialog} from './desktop-feature-tour';
import {MobileDeviceSettings} from './mobile-devices';
import {accountErrors,useDesktopAccount,type AccountState} from './desktop-account-state';
import {Dialog} from '@base-ui/react/dialog';
import {Tabs} from '@base-ui/react/tabs';
import {Button} from '@base-ui/react/button';
import {useMediaQuery} from '@mantine/hooks';
import {Settings,X,ArrowLeft,ShieldCheck,UserRound,Smartphone,Link2,Scan,RotateCcw,Pause,Play,Info,ExternalLink,ChevronRight,Zap,Check} from 'lucide-react';
import {Menu} from '@base-ui/react/menu';
import {ModelSelectorRoot,ModelSelectorTrigger,ModelSelectorValue,ModelSelectorContent,ModelSelectorList,ModelSelectorEffort} from './vendor/assistant-ui/model-selector';
import {validateChatGPTSelection,type ChatGPTModelConfig,type ModelRole,type NativeModelSettings} from '../src/model-config';

type Accessibility='granted'|'not-granted'|'unknown';
type Screen='not-determined'|'denied'|'granted'|'restricted'|'unknown';
type PermissionState={supported:false}|{supported:true;subject:'Homer';accessibility:Accessibility;screen:Screen};
type ActionResult={supported:false}|{ok:boolean;code?:string};
type PermissionsBridge={check:()=>Promise<PermissionState>;openSystemSettings:(target?:'screen')=>Promise<ActionResult>};
type CaptureShortcutState={shortcut:string;defaultShortcut:string;active:boolean;error?:'invalid'|'reserved'|'unavailable'|'save_failed'};
export type CaptureShortcutBridge={platform?:'win32';getShortcut:()=>Promise<CaptureShortcutState>;setShortcut:(shortcut:string|null)=>Promise<CaptureShortcutState>};
type AboutLink='website'|'github';
declare global{interface Window{homerDesktopPermissions?:PermissionsBridge;homerDesktopSettings?:{onOpen:(callback:(target?:'permissions')=>void)=>()=>void;getVersion?:()=>Promise<string>;openAboutLink?:(link:AboutLink)=>Promise<void>};}}

type SettingsView='closed'|'settings'|'opening-tour'|'tour'|'returning-to-about';

export function DesktopSettings({ref,onVisibilityChange}:{ref?:Ref<{openAccount:()=>void}>;onVisibilityChange?:(open:boolean)=>void}={}){
 const [view,setView]=useState<SettingsView>('closed');
 const open=view==='settings',active=view!=='closed';
 const entry=useRef<HTMLButtonElement>(null),tab=useRef<HTMLButtonElement>(null),tourEntry=useRef<HTMLButtonElement>(null);
 const [panel,setPanel]=useState(window.homerDesktopAccount?'account':'permissions'),[narrow,setNarrow]=useState(false);
 const opener=useRef<HTMLElement|null>(null);
 const currentView=useRef(view);currentView.current=view;
 const captureAvailable=!!window.homerDesktopCapture?.getShortcut&&!!window.homerDesktopCapture.setShortcut;
 const aboutLink=window.homerDesktopFeatureTour&&window.homerDesktopSettings?.openAboutLink;
 const openSettings=useCallback((target?:'permissions')=>{
  if(currentView.current!=='closed'&&currentView.current!=='settings')return;
  opener.current=null;
  if(target==='permissions')setPanel(target);
  else if(currentView.current==='closed')setPanel(window.homerDesktopAccount?'account':'permissions');
  setView('settings');tab.current?.focus();
 },[]);
 useEffect(()=>window.homerDesktopSettings?.onOpen(openSettings),[openSettings]);
 useEffect(()=>{const q=window.matchMedia?.('(max-width:600px)');if(!q)return;const changed=()=>setNarrow(q.matches);changed();q.addEventListener('change',changed);return()=>q.removeEventListener('change',changed);},[]);
 useImperativeHandle(ref,()=>({openAccount:()=>{
  if(currentView.current!=='closed'&&currentView.current!=='settings')return;
  opener.current=document.activeElement as HTMLElement;setPanel('account');setView('settings');
 }}));
 useLayoutEffect(()=>{if(active){onVisibilityChange?.(true);return()=>onVisibilityChange?.(false);}},[active,onVisibilityChange]);
 return <><Dialog.Root open={open}
  onOpenChange={next=>{if(next)openSettings();else setView(current=>current==='settings'?'closed':current);}}
  onOpenChangeComplete={next=>{if(!next)setView(current=>current==='opening-tour'?'tour':current);}}>
  <Dialog.Trigger ref={entry} aria-label="设置" title="设置"><Settings size={18}/></Dialog.Trigger>
  <Dialog.Portal><Dialog.Backdrop className="desktop-settings-backdrop"/>
   <Dialog.Popup className="desktop-settings-popup" initialFocus={()=>panel==='about'?tourEntry.current??tab.current:tab.current}
    finalFocus={view==='opening-tour'?false:opener.current?()=>opener.current?.isConnected?opener.current:entry.current:entry}>
    <header className="desktop-settings-heading"><div><Settings size={19}/><Dialog.Title>设置</Dialog.Title></div><Dialog.Close aria-label="关闭设置"><X size={19}/></Dialog.Close></header>
    <Dialog.Description className="desktop-settings-description">{captureAvailable?'管理账号、本机权限、截图批注、移动设备与聊天应用。':'管理账号、本机权限、移动设备与聊天应用。'}</Dialog.Description>
    <Tabs.Root className="desktop-settings-layout" value={panel} orientation={narrow?'horizontal':'vertical'} onValueChange={setPanel}>
     <Tabs.List className="desktop-settings-nav" aria-label="设置分类" activateOnFocus={false}>
      {window.homerDesktopAccount&&<Tabs.Tab value="account" ref={panel==='account'?tab:undefined}><UserRound size={18}/>账号</Tabs.Tab>}
      <Tabs.Tab value="permissions" ref={panel==='permissions'?tab:undefined}><ShieldCheck size={18}/>本机权限</Tabs.Tab>
      {captureAvailable&&<Tabs.Tab value="capture" ref={panel==='capture'?tab:undefined}><Scan size={18} aria-hidden/>截图批注</Tabs.Tab>}
      <Tabs.Tab value="mobile" ref={panel==='mobile'?tab:undefined}><Smartphone size={18}/>移动设备</Tabs.Tab>
      {window.homerDesktopChatApps&&<Tabs.Tab value="chat-apps" ref={panel==='chat-apps'?tab:undefined}><Link2 size={18}/>连接聊天应用</Tabs.Tab>}
      {aboutLink&&<Tabs.Tab value="about" ref={panel==='about'?tab:undefined}><Info size={18} aria-hidden/>关于</Tabs.Tab>}
     </Tabs.List>
     <div className="desktop-settings-content">
      {window.homerDesktopAccount&&<Tabs.Panel value="account" className="desktop-account-panel">{open&&panel==='account'&&<DesktopAccount/>}</Tabs.Panel>}
      <Tabs.Panel value="permissions">{open&&panel==='permissions'&&<DesktopPermissions/>}</Tabs.Panel>
      {captureAvailable&&<Tabs.Panel value="capture">{open&&panel==='capture'&&<DesktopCaptureSettings/>}</Tabs.Panel>}
      <Tabs.Panel value="mobile">{open&&panel==='mobile'&&<MobileDeviceSettings/>}</Tabs.Panel>
      {window.homerDesktopChatApps&&<Tabs.Panel value="chat-apps">{open&&panel==='chat-apps'&&<DesktopChatApps/>}</Tabs.Panel>}
      {aboutLink&&<Tabs.Panel value="about">{open&&panel==='about'&&<DesktopAbout openLink={aboutLink}
       tourEntry={tourEntry} onTour={()=>setView('opening-tour')}/>}</Tabs.Panel>}
     </div>
    </Tabs.Root>
    <footer className="desktop-settings-footer"><Dialog.Close><ArrowLeft size={16}/>返回会话</Dialog.Close></footer>
   </Dialog.Popup>
  </Dialog.Portal>
 </Dialog.Root>
 {aboutLink&&<FeatureTourDialog open={view==='tour'} returnFocus={false}
  onDismiss={()=>setView(current=>current==='tour'?'returning-to-about':current)}
  onOpenChangeComplete={next=>{if(!next)setView(current=>current==='returning-to-about'?'settings':current);}}/>}
 </>;
}

function DesktopAbout({openLink,tourEntry,onTour}: {
 openLink:(link:AboutLink)=>Promise<void>;tourEntry:Ref<HTMLButtonElement>;onTour:()=>void;
}){
 const [notice,setNotice]=useState(''),[version,setVersion]=useState('');
 useEffect(()=>{let active=true;void window.homerDesktopSettings?.getVersion?.().then(value=>{if(active)setVersion(value);},()=>{});return()=>{active=false;};},[]);
 async function open(link:AboutLink){
  setNotice('');
  try{await openLink(link);}
  catch{setNotice('未能打开链接，请重试。');}
 }
 return <div className="desktop-about">
  <h2>关于荷马</h2>
  {version&&<p>版本 {version}</p>}
  <div className="desktop-about-links">
   <Button type="button" onClick={()=>void open('website')}>官网<ExternalLink size={16} aria-hidden/></Button>
   <Button type="button" onClick={()=>void open('github')}>GitHub<ExternalLink size={16} aria-hidden/></Button>
   <Button type="button" ref={tourEntry} onClick={onTour}>特色功能<ChevronRight size={16} aria-hidden/></Button>
  </div>
  {notice&&<p role="status">{notice}</p>}
 </div>;
}

const shortcutKeys=(shortcut:string,windows:boolean)=>windows?shortcut.replace('Control+','Ctrl+')
 :shortcut.replaceAll('Control+','⌃').replaceAll('Alt+','⌥').replaceAll('Shift+','⇧').replaceAll('Command+','⌘');
const shortcutErrors={
 reserved:'此组合键用于 macOS 系统操作，请换一组。',
 unavailable:'此组合键已被占用或系统不允许，请换一组。',
 save_failed:'快捷键未能保存，请重试。',
};
function DesktopCaptureSettings(){
 const {getShortcut,setShortcut,platform}=window.homerDesktopCapture??{},windows=platform==='win32';
 const shortcutInstruction=windows?'按 Ctrl+Shift 加字母、数字或 F1–F11。'
  :'按 Control 加数字，或用至少两枚修饰键（含 Control 或 Command）加字母或数字。';
 const [state,setState]=useState<CaptureShortcutState>(),[recording,setRecording]=useState(false);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const motion=useMediaQuery('(prefers-reduced-motion: no-preference)');
 const [paused,setPaused]=useState(false);
 const playing=motion&&!paused,playbackLabel=playing?'暂停示意动图':'播放示意动图';
 useEffect(()=>{
  let active=true;
  void getShortcut?.().then(value=>{if(active)setState(value);},()=>{if(active)setNotice('快捷键读取失败，请重新打开设置。');});
  return()=>{active=false;};
 },[getShortcut]);
 async function save(shortcut:string|null){
  if(busy||!setShortcut)return;
  setRecording(false);setBusy(true);setNotice('');
  try{
   const next=await setShortcut(shortcut);setState(next);
   if(next.error)setNotice(next.error==='invalid'?shortcutInstruction:shortcutErrors[next.error]);
  }catch{setNotice(shortcutErrors.save_failed);}
  finally{setBusy(false);}
 }
 function record(event:KeyboardEvent<HTMLButtonElement>){
  if(!recording||event.key==='Tab')return;
  event.preventDefault();event.stopPropagation();
  if(event.key==='Escape'){setRecording(false);setNotice('');return;}
  if(event.repeat||event.nativeEvent.isComposing||['Control','Alt','Shift','Meta'].includes(event.key))return;
  const pressed=event.key.toUpperCase();
  const validKey=windows?/^(?:[A-Z0-9]|F[1-9]|F1[01])$/:/^[A-Z0-9]$/;
  const key=validKey.test(pressed)?pressed:/^(?:Key|Digit)([A-Z0-9])$/.exec(event.code)?.[1];
  const modifiers=[event.ctrlKey&&'Control',event.altKey&&'Alt',event.shiftKey&&'Shift',event.metaKey&&'Command'].filter(Boolean);
  if(!key)return;
  const controlDigit=modifiers.length===1&&event.ctrlKey&&/^[0-9]$/.test(key);
  if(windows?modifiers.length!==2||!event.ctrlKey||!event.shiftKey
   :!controlDigit&&(modifiers.length<2||!event.ctrlKey&&!event.metaKey))return;
  void save([...modifiers,key].join('+'));
 }
 const hint=notice||(recording?`${shortcutInstruction} 按 Esc 取消。`:!state?'正在读取快捷键…':!state.active?'当前快捷键不可用，请更换。':'');
 return <div className="desktop-capture-settings">
  <h2>截图批注</h2>
  <div className="desktop-capture-intro">
   <Scan size={24} aria-hidden/>
   <div>
    <h3>截下当前画面，直接批注</h3>
    <p>{windows?'按全局快捷键，从列表选择窗口或拖选屏幕区域，再圈出重点、写下备注并发送。'
     :'按全局快捷键截取当前窗口，在原处圈出重点、写下备注，再发送到当前会话。'}</p>
   </div>
  </div>
  <div className="desktop-capture-layout">
   <section className="desktop-shortcut-row" aria-label="全局快捷键" aria-busy={busy}>
    <div className="desktop-permission-heading">
     <h3>全局快捷键</h3>
     <div className="desktop-shortcut-actions">
      <Button type="button" title="更改快捷键"
       aria-label={state?`更改截图批注快捷键，当前 ${(windows?shortcutKeys(state.shortcut,true):state.shortcut).split('+').join(' + ')}`:'更改截图批注快捷键'}
       aria-pressed={recording} disabled={busy||!state} focusableWhenDisabled={busy}
       onBlur={()=>setRecording(false)} onKeyDown={record} onClick={()=>{setRecording(value=>!value);setNotice('');}}>
       {recording?'按下组合键':<kbd>{state?shortcutKeys(state.shortcut,windows):'—'}</kbd>}
      </Button>
      <Button type="button" className="desktop-shortcut-restore" aria-label="恢复截图批注默认快捷键"
       title={state?`恢复默认（${shortcutKeys(state.defaultShortcut,windows)}）`:'恢复默认'}
       disabled={busy||!state} focusableWhenDisabled={busy} onClick={()=>void save(null)}><RotateCcw size={16} aria-hidden/></Button>
     </div>
    </div>
    <p>点击键帽更改。关闭设置后，可在其他 App 中使用。</p>
    {hint&&<p role="status">{hint}</p>}
   </section>
   <figure className="desktop-capture-demo">
    <div className="desktop-capture-demo-media">
     {playing?<img src={`${import.meta.env.BASE_URL}assets/desktop-feature-tour-v1-annotation.gif`} width={1200} height={614}
      alt="选取窗口，圈出要说明的位置，写下批注并发送给荷马。" onError={()=>setPaused(true)}/>
      :<svg viewBox="0 0 360 206" role="img" aria-label="操作示意，圈出连接超时提示，写下批注后点对勾发送">
       <rect width="360" height="206" fill="var(--soft)"/>
       <rect x="20" y="22" width="234" height="141" rx="9" fill="var(--surface)" stroke="var(--line)"/>
       <path d="M36 44h60m-60 17h108m-108 9h76m-76 9h51" stroke="var(--strong-line)" strokeWidth="3" strokeLinecap="round"/>
       <rect width="360" height="206" fill="var(--ink)" opacity=".5"/>
       <rect x="63" y="35" width="270" height="149" rx="9" fill="var(--surface)" stroke="var(--line)"/>
       <path d="M77 49h1m7 0h1m7 0h1m-30 13h268" stroke="var(--strong-line)" strokeWidth="2" strokeLinecap="round"/>
       <path d="M84 77h94m-94 43h154m-154 11h108m-108 11h124" stroke="var(--line)" strokeWidth="3" strokeLinecap="round"/>
       <rect x="79" y="86" width="145" height="24" rx="3" fill="var(--soft)" stroke="var(--focus)"/>
       <text x="88" y="102" fontSize="12" fill="var(--ink)">连接超时 E101</text>
       <path d="M156 116l-4-6-4 6z" fill="var(--control)"/>
       <rect x="137" y="115" width="142" height="29" rx="6" fill="var(--control)"/>
       <text x="148" y="134" fontSize="11" fill="var(--surface)">帮我看看这处报错</text>
       <rect x="271" y="153" width="52" height="22" rx="5" fill="var(--control)"/>
       <path d="M281 161l7 7m0-7l-7 7m19-4l4 4 8-8" fill="none" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>}
    </div>
    <figcaption>
     <div><strong>体验示意</strong><br/>从「显示 → 选取窗口或区域…」进入取景，{windows?'可从列表选择窗口，也可点击「框选区域」后拖选。':'可单击窗口或拖选区域。'}</div>
     {motion&&<Button type="button" aria-label={playbackLabel} title={playbackLabel} onClick={()=>setPaused(value=>!value)}>
      {playing?<Pause size={16} aria-hidden/>:<Play size={16} aria-hidden/>}
     </Button>}
    </figcaption>
   </figure>
  </div>
 </div>;
}

const labels={granted:'已允许','not-granted':'未允许','not-determined':'尚未决定',denied:'未允许',restricted:'系统限制',unknown:'无法确认'};
type Row='accessibility'|'screen';
export function DesktopPermissions(){
 const bridge=window.homerDesktopPermissions;
 const [supported,setSupported]=useState<boolean|null>(bridge?null:false);
 const [states,setStates]=useState<{accessibility:Accessibility;screen:Screen}>({accessibility:'unknown',screen:'unknown'});
 const [busy,setBusy]=useState(false),[notices,setNotices]=useState({accessibility:'',screen:''});
 const active=useRef(false),attempt=useRef(0),pending=useRef(false);
 async function run(kind:'check'|'openSystemSettings',row?:Row){
  if(!bridge||pending.current)return;
  const id=++attempt.current;pending.current=true;setBusy(true);
  const current=()=>active.current&&id===attempt.current;
  if(row)setNotices(old=>({...old,[row]:''}));else setNotices({accessibility:'',screen:''});
  try{
   if(kind==='check'){
    const value=await bridge.check();if(!current())return;
    setSupported(value.supported);
    if(value.supported)setStates({
     accessibility:value.accessibility==='granted'||value.accessibility==='not-granted'?value.accessibility:'unknown',
     screen:['not-determined','denied','granted','restricted'].includes(value.screen)?value.screen:'unknown',
    });
    else setStates({accessibility:'unknown',screen:'unknown'});
   }else{
    const value=await (kind==='openSystemSettings'&&row==='screen'?bridge.openSystemSettings('screen'):bridge[kind]());if(!current())return;
    if('supported'in value&&!value.supported){setSupported(false);setStates({accessibility:'unknown',screen:'unknown'});return;}
    if(!('ok'in value)||value.ok!==true)throw Error('action_failed');
    let notice=value.code==='manual_navigation'?'未能直接打开辅助功能页面，已打开系统设置。请按下方路径手动进入，返回后点击重新检查。':'已请求打开辅助功能设置。如未直达，请按下方路径手动进入，返回后点击重新检查。';
    if(row==='screen')notice=value.code==='manual_navigation'
     ?'未能直接打开屏幕采集页面，已打开系统设置。请按下方路径手动进入，返回后点击重新检查。'
     :'已请求打开屏幕采集设置。如未直达，请按下方路径手动进入，返回后点击重新检查。';
    setNotices(old=>({...old,[row!]:notice}));
   }
  }catch{
   if(!current())return;
   if(kind==='check'){
    setStates({accessibility:'unknown',screen:'unknown'});
    setNotices({accessibility:'检查未完成，请重新检查。',screen:'检查未完成，请重新检查。'});
   }else if(row){
    setStates(old=>({...old,[row]:'unknown'}));
    setNotices(old=>({...old,[row]:'系统设置未能打开，请按下方路径手动进入。'}));
   }
  }finally{if(current()){pending.current=false;setBusy(false);}}
 }
 useEffect(()=>{
  active.current=true;void run('check');
  return()=>{active.current=false;attempt.current++;pending.current=false;};
  // A fresh panel owns one initial check. All subsequent actions require a click.
 },[]);
 return <div className="desktop-permissions desktop-permissions-panel" aria-busy={busy}>
  <h2>本机权限</h2>
  <p className="permission-intro">这里只显示荷马本机应用的权限。开启权限不会自动开始桌面控制，具体操作仍需授权；独立工具的权限需要另行确认。</p>
  {supported===false&&<p className="permission-unavailable" role="status">当前环境不支持权限检查。请在 macOS 桌面版中查看。</p>}
  {([{id:'accessibility',name:'辅助功能',purpose:'用于点击、键入等桌面操作。',path:'辅助功能'},
    {id:'screen',name:'屏幕采集',purpose:'用于一键截取当前窗口，以及桌面操作时查看屏幕。',path:'屏幕与系统音频录制'}] as const).map(row=>{
   const status=states[row.id];
   let advice='';
   if(supported!==false){
    if(status==='unknown')advice='暂时无法确认状态，请重新检查。';
    else if(status==='restricted')advice='受系统限制，请在系统设置中查看。';
    else if(row.id==='screen'&&(status==='denied'||status==='not-determined'))advice='请在系统设置中允许荷马录屏，再回来重新检查。';
    else if(status==='not-granted')advice='未允许时，相关操作可能无法使用。';
   }
   return <section key={row.id} aria-label={row.name}>
    <div className="desktop-permission-heading"><h3>{row.name}</h3><span className={supported===true&&status==='granted'?'is-granted':''} role="status">{supported===false?'不可用':busy&&supported===null?'正在检查…':labels[status]}</span></div>
    <p className="permission-purpose">{row.purpose}</p>
    {advice&&<p className="permission-advice">{advice}</p>}
    {supported!==false&&<div className="desktop-permission-actions">
     {supported===true&&<Button disabled={busy} aria-label={'打开'+row.name+'系统设置'} onClick={()=>void run('openSystemSettings',row.id)}>打开系统设置</Button>}
     <Button className="permission-recheck" disabled={busy} aria-label={'重新检查'+row.name} onClick={()=>void run('check',row.id)}>重新检查</Button>
    </div>}
    {notices[row.id]&&<p className="permission-notice" role="status">{notices[row.id]}</p>}
    {supported!==false&&<p className="desktop-permission-path">系统设置 → 隐私与安全性 → {row.path}（名称可能随系统版本不同）{row.id==='accessibility'&&status!=='granted'&&<>。如果列表中没有荷马，可点击“＋”手动添加。</>}</p>}
   </section>;
  })}
  {supported!==false&&<p className="permission-footer">若系统提示需要重开应用，请重开后重新检查；当前进程可能仍读到旧状态。</p>}
 </div>;
}


const nativeRoleNames={main:'Homer',worker:'Worker'};
const nativeEffortNames:Record<string,string>={none:'无',minimal:'最少',low:'低',medium:'中',high:'高',xhigh:'极高',max:'Max',ultra:'Ultra'};
const nativeSpeedName=(tier:string|null)=>tier==='ultrafast'?'Ultrafast':tier===null?'标准':'Fast';
const sameNativeModels=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function NativeSpeedControl({name,value,tiers,disabled,onChange}:{name:string;value:string|null;tiers:{id:string;name:string}[];disabled:boolean;onChange:(value:string|null)=>void}){
 const label=name+' 速度：'+nativeSpeedName(value),fast=tiers.find(tier=>['priority','fast'].includes(tier.id)),ultra=tiers.some(tier=>tier.id==='ultrafast');
 const icon=value==='ultrafast'?<span className="double-bolt" aria-hidden="true"><Zap size={17}/><Zap size={17}/></span>:<Zap size={19} fill={value?'currentColor':'none'} aria-hidden="true"/>;
 if(!ultra)return <Button type="button" className="speed-button" data-speed={value??'standard'} aria-label={label} aria-pressed={value!==null} disabled={disabled||!fast} title={disabled?label:!fast?'此模型仅支持标准速度':label+'；点击切换为'+(value?'标准':'Fast（更多用量）')} onClick={()=>onChange(value?null:fast!.id)}>{icon}</Button>;
 return <Menu.Root>
  <Menu.Trigger type="button" className="speed-button" data-speed={value??'standard'} aria-label={label} disabled={disabled} title={label+'；选择速度'}>{icon}</Menu.Trigger>
  <Menu.Portal><Menu.Positioner side="bottom" align="end" sideOffset={6} className="desktop-model-speed-positioner"><Menu.Popup className="desktop-model-speed-menu" aria-label={name+' 速度'}>
   <Menu.RadioGroup value={value} onValueChange={onChange}>{[null,...tiers.map(tier=>tier.id)].map(tier=><Menu.RadioItem key={tier??'standard'} value={tier} className="desktop-model-speed-item" closeOnClick><span>{nativeSpeedName(tier)}</span><Menu.RadioItemIndicator><Check size={16}/></Menu.RadioItemIndicator></Menu.RadioItem>)}</Menu.RadioGroup>
  </Menu.Popup></Menu.Positioner></Menu.Portal>
 </Menu.Root>;
}
function DesktopChatGPTModels({connected,unconfirmed,busy,different,apply}:{connected:boolean;unconfirmed:boolean;busy:boolean;different:boolean;apply:(roles:Record<ModelRole,ChatGPTModelConfig>)=>Promise<AccountState|undefined>}){
 const bridge=window.homerDesktopAccount!;
 const [settings,setSettings]=useState<NativeModelSettings>(),[draft,setDraft]=useState<Record<ModelRole,ChatGPTModelConfig>>(),[reading,setReading]=useState(true),[retry,setRetry]=useState(0),[notice,setNotice]=useState('');
 const focus=useRef<{elements:HTMLElement[];pending:boolean}>({elements:[],pending:false});
 useEffect(()=>{
  if(busy||reading||!focus.current.pending)return;
  focus.current.pending=false;
  if(document.activeElement===document.body||document.activeElement?.matches('.desktop-settings-popup'))focus.current.elements.find(element=>element.isConnected&&!element.matches(':disabled'))?.focus();
 },[busy,reading]);
 useEffect(()=>{
  if(!connected)return;
  let live=true,request=0;
  async function read(){const id=++request;setReading(true);try{const next=await bridge.nativeModels();if(live&&id===request){setSettings(previous=>({...next,models:next.models??previous?.models}));setDraft(previous=>previous??next.current);}}catch{if(live&&id===request)setSettings(previous=>previous?{...previous,error:'native_models_unconfirmed'}:undefined);}
   finally{if(live&&id===request)setReading(false);}}
  void read();const dispose=bridge.onChange(()=>void read());return()=>{live=false;request++;dispose();};
 },[bridge,retry,connected]);
 if(!connected&&(!unconfirmed||!draft))return null;
 const disabled=!connected||busy||reading||!!settings?.error;
 let valid=false;if(draft&&settings?.models&&!disabled){try{validateChatGPTSelection(draft,settings.models);valid=true;}catch{}}
 function applyDraft(next:Record<ModelRole,ChatGPTModelConfig>){
  focus.current.pending=!different;
  setNotice('');void apply(next).then(result=>{
   if(!result){setReading(true);setRetry(value=>value+1);return;}
   if(!different){setSettings(current=>current?{...current,current:next}:current);setNotice(previous=>(previous?previous+' ':'')+'已保存，下一轮生效。');}
  });
 }
 function save(next:Record<ModelRole,ChatGPTModelConfig>){if(disabled)return;setDraft(next);setNotice('');if(!different)applyDraft(next);}
 function change(role:ModelRole,patch:Partial<ChatGPTModelConfig>){if(draft)save({...draft,[role]:{...draft[role],...patch}});}
 function chooseModel(role:ModelRole,id:string){
  const model=settings?.models?.find(model=>model.model===id);if(disabled||!model||!draft)return;
  const previous=draft[role],effort=model.supportedReasoningEfforts.some(option=>option.reasoningEffort===previous.effort)?previous.effort:model.defaultReasoningEffort;
  const serviceTier=model.serviceTiers.some(tier=>tier.id===previous.serviceTier)?previous.serviceTier:null;
  change(role,{model:id,effort,serviceTier});if(effort!==previous.effort||serviceTier!==previous.serviceTier)setNotice(nativeRoleNames[role]+'：已按所选模型调整思考深度或速度。'+(different?'请核对后应用。':''));
 }
 if(!draft||!settings)return <div className="desktop-chatgpt-models"><p role="status">{reading?'正在读取模型列表…':'模型列表读取失败。'}</p>{!reading&&<Button onClick={()=>setRetry(value=>value+1)}>重试模型列表</Button>}</div>;
 const models=(settings.models??[]).map(model=>({id:model.model,name:model.displayName,efforts:model.supportedReasoningEfforts.map(option=>({id:option.reasoningEffort,name:nativeEffortNames[option.reasoningEffort]??option.reasoningEffort}))}));
 return <div className="desktop-chatgpt-models" onFocusCapture={event=>{if(event.currentTarget.contains(event.target))focus.current.elements=[event.target,...event.currentTarget.querySelectorAll<HTMLElement>('[role="combobox"]')];}}>
  {(['main','worker'] as const).map(role=>{
   const selected=draft[role],model=settings.models?.find(model=>model.model===selected.model);
   return <section key={role} aria-labelledby={'chatgpt-'+role}>
    <h3 id={'chatgpt-'+role}>{nativeRoleNames[role]}{sameNativeModels(selected,settings.defaults[role])&&<span>默认</span>}</h3>
    <div className="desktop-model-controls"><ModelSelectorRoot models={models} value={selected.model} effort={selected.effort} onValueChange={id=>chooseModel(role,id)} onEffortChange={effort=>change(role,{effort})}>
     <ModelSelectorTrigger aria-label={nativeRoleNames[role]+' 模型'} disabled={disabled}><ModelSelectorValue placeholder={selected.model}/></ModelSelectorTrigger>
     <ModelSelectorContent searchable={false}><ModelSelectorList/><ModelSelectorEffort label="思考深度"/></ModelSelectorContent>
    </ModelSelectorRoot><NativeSpeedControl name={nativeRoleNames[role]} value={selected.serviceTier} tiers={model?.serviceTiers??[]} disabled={disabled||!model} onChange={serviceTier=>change(role,{serviceTier})}/></div>
    {settings.models&&!settings.error&&!reading&&(!model||!(model.supportedReasoningEfforts.length?model.supportedReasoningEfforts.some(option=>option.reasoningEffort===selected.effort):selected.effort===model.defaultReasoningEffort)||selected.serviceTier!==null&&!model.serviceTiers.some(tier=>tier.id===selected.serviceTier))&&<p role="status">{nativeRoleNames[role]} 的当前配置不可用，请重新选择。</p>}
   </section>;
  })}
  {settings.error&&<p role="status">模型列表读取失败，已保留当前选择。<Button disabled={!connected||busy||reading} onClick={()=>setRetry(value=>value+1)}>重试模型列表</Button></p>}
  <p className="desktop-model-hint">分别配置，{different?'切换来源后生效':'下一轮生效，不打断当前任务'}。闪电调整速度，加速会消耗更多用量。</p>
  <div className="desktop-permission-actions">{(different||!busy&&!sameNativeModels(draft,settings.current))&&<Button type="button" className="primary-button" onClick={()=>{if(valid)applyDraft(draft);}} disabled={!valid}>{different?'应用并重启':'重试保存'}</Button>}<Button className="desktop-model-restore" type="button" disabled={!connected||busy||reading||sameNativeModels(draft,settings.defaults)} onClick={()=>save(settings.defaults)}>恢复默认</Button></div>
  {notice&&<p role="status">{notice}</p>}
 </div>;
}

export function DesktopAccount({onboarding=false}:{onboarding?:boolean}={}){
 const bridge=window.homerDesktopAccount;
 const {state,busy,notice,run}=useDesktopAccount();
 const [source,setSource]=useState<'chatgpt'|'website'>();
 const selectedSource=source??(!onboarding&&state?.source==='codex'?'chatgpt':'website');
 const error=(value?:string)=>value?(accountErrors[value]??'状态未能确认，请联系维护方。'):'';
 const connected=state?.active==='website',saved=state?.connection==='website';
 const expired=(connected||saved)&&(state?.error==='TOKEN_UNAVAILABLE'||state?.walletError==='TOKEN_UNAVAILABLE'||!!state?.wallet?.expiresAt&&state.wallet.expiresAt<=Date.now()/1000);
 const native=state?.native;
 const nativeLabel=state?.nativeError?'状态未确认':!native?'状态未确认':native.connected?'已登录':native.account==='other'?'API Key 登录':native.pending?'登录待完成':({cancelled:'登录已取消',failed:'登录失败',timed_out:'登录已超时',cancel_unconfirmed:'取消结果待确认',unconfirmed:'授权结果待确认'}[native.phase]??(native.account==='none'?'未登录':'状态未确认'));
 const websiteStatus=!state?'正在读取…':state.pending?'请在浏览器完成登录。':expired?'登录已失效':state.needsRestart?(connected?'配置已更新，重启后生效。':'登录信息已保存，重启后生效。'):!connected&&saved?'登录信息已保存，应用后生效。':!connected?'未登录':'';
 const viewingCodex=selectedSource==='chatgpt',different=!!state&&(state.source==='codex')!==viewingCodex;
 const walletKnown=!!state?.wallet&&!state.stale&&!state.walletError&&!expired;
 const sourceEntry=<Button className="desktop-account-source-entry" disabled={!state} onClick={()=>setSource(viewingCodex?'website':'chatgpt')}>
     {viewingCodex?<img src={homerLogo} alt="" width={16} height={16}/>:<svg viewBox="130 210 300 300" width={16} height={16} aria-hidden="true"><path fill="currentColor" d="M249.176 323.434V298.276C249.176 296.158 249.971 294.569 251.825 293.509L302.406 264.381C309.29 260.409 317.5 258.555 325.973 258.555C357.75 258.555 377.877 283.185 377.877 309.399C377.877 311.253 377.877 313.371 377.611 315.49L325.178 284.771C322.001 282.919 318.822 282.919 315.645 284.771L249.176 323.434ZM367.283 421.415V361.301C367.283 357.592 365.694 354.945 362.516 353.092L296.048 314.43L317.763 301.982C319.617 300.925 321.206 300.925 323.058 301.982L373.639 331.112C388.205 339.586 398.003 357.592 398.003 375.069C398.003 395.195 386.087 413.733 367.283 421.412V421.415ZM233.553 368.452L211.838 355.742C209.986 354.684 209.19 353.095 209.19 350.975V292.718C209.19 264.383 230.905 242.932 260.301 242.932C271.423 242.932 281.748 246.641 290.49 253.26L238.321 283.449C235.146 285.303 233.555 287.951 233.555 291.659V368.455L233.553 368.452ZM280.292 395.462L249.176 377.985V340.913L280.292 323.436L311.407 340.913V377.985L280.292 395.462ZM300.286 475.968C289.163 475.968 278.837 472.259 270.097 465.64L322.264 435.449C325.441 433.597 327.03 430.949 327.03 427.239V350.445L349.011 363.155C350.865 364.213 351.66 365.802 351.66 367.922V426.179C351.66 454.514 329.679 475.965 300.286 475.965V475.968ZM237.525 416.915L186.944 387.785C172.378 379.31 162.582 361.305 162.582 343.827C162.582 323.436 174.763 305.164 193.563 297.485V357.861C193.563 361.571 195.154 364.217 198.33 366.071L264.535 404.467L242.82 416.915C240.967 417.972 239.377 417.972 237.525 416.915ZM234.614 460.343C204.689 460.343 182.71 437.833 182.71 410.028C182.71 407.91 182.976 405.792 183.238 403.672L235.405 433.863C238.582 435.715 241.763 435.715 244.938 433.863L311.407 395.466V420.622C311.407 422.742 310.612 424.331 308.758 425.389L258.179 454.519C251.293 458.491 243.083 460.343 234.611 460.343H234.614ZM300.286 491.854C332.329 491.854 359.073 469.082 365.167 438.892C394.825 431.211 413.892 403.406 413.892 375.073C413.892 356.535 405.948 338.529 391.648 325.552C392.972 319.991 393.766 314.43 393.766 308.87C393.766 271.003 363.048 242.666 327.562 242.666C320.413 242.666 313.528 243.723 306.644 246.109C294.725 234.457 278.307 227.042 260.301 227.042C228.258 227.042 201.513 249.815 195.42 280.004C165.761 287.685 146.694 315.49 146.694 343.824C146.694 362.362 154.638 380.368 168.938 393.344C167.613 398.906 166.819 404.467 166.819 410.027C166.819 447.894 197.538 476.231 233.024 476.231C240.172 476.231 247.058 475.173 253.943 472.788C265.859 484.441 282.278 491.854 300.286 491.854Z"/></svg>}
     {viewingCodex?'荷马会员':'改用 ChatGPT 套餐'}
    </Button>;
 return <div className={'desktop-permissions desktop-account'+(onboarding?' desktop-account-onboarding':'')} aria-busy={busy}>
  {!bridge||state?.supported===false?<p role="status">此入口仅适用于日常 Homer 桌面版。</p>:<>
   {onboarding&&<header className="desktop-account-welcome"><img src={homerLogo} alt="" width={64} height={64}/><h1>欢迎使用荷马</h1><p>连接一个模型服务，开始和荷马一起做事。</p></header>}
   <div className="desktop-account-page-heading"><h2>{viewingCodex?'ChatGPT 套餐':onboarding?'荷马会员服务':'荷马模型服务'}</h2>{!onboarding&&sourceEntry}</div>
   <div className="desktop-account-detail">
    {onboarding&&!viewingCodex&&<p>登录荷马账号，使用积分调用模型。</p>}
    {viewingCodex?<>
     <p role="status">{nativeLabel}</p><p>通过 Codex 使用 ChatGPT 登录，荷马不收取模型费用。</p>
     {native?.account==='other'&&<p>当前使用 API Key，不能作为 ChatGPT 套餐登录；请在原 Codex 环境中处理。</p>}
     {native?.pending&&<p>请在系统浏览器完成 Codex 登录，然后返回荷马。</p>}
     {state?.nativeError&&<p role="status">{state.nativeError}</p>}
     <div className="desktop-permission-actions">
      {native?.pending?<><Button disabled={busy||!native.canReopen} onClick={()=>void run('nativeReopen')}>重新打开 Codex 登录页面</Button><Button disabled={busy} onClick={()=>void run('nativeCancel')}>取消 Codex 登录</Button></>:native?.account==='none'&&<Button className="primary-button" disabled={busy} onClick={()=>void run('nativeConnect')}>通过 Codex 登录</Button>}
      {state&&(nativeLabel==='状态未确认'||native?.phase==='unconfirmed'||native?.phase==='cancel_unconfirmed')&&<Button disabled={busy} onClick={()=>void run('state')}>重新检查 Codex 登录</Button>}
      {onboarding&&!different&&native?.connected&&!state?.nativeError&&<Button className="primary-button" disabled={busy} onClick={()=>void run('restart')}>重启并应用</Button>}
     </div>
     {!onboarding&&<DesktopChatGPTModels connected={!!native?.connected&&!state?.nativeError} unconfirmed={!native||!!state?.nativeError||native.account==='unknown'} busy={busy} different={different} apply={roles=>run('applyCodex',roles)}/>}
    </>:<>
     {websiteStatus&&<p role="status">{websiteStatus}</p>}
     {state&&!state.configured&&<p role="status">{error('CONFIGURATION_REQUIRED')}</p>}
     {state?.error&&<p role="status">{error(state.error)}</p>}
     {state?.pending?<div className="desktop-permission-actions"><Button disabled={busy||!state.canReopen} onClick={()=>void run('reopen')}>重新打开登录页面</Button><Button disabled={busy} onClick={()=>void run('cancel')}>取消</Button></div>:<>
      {state&&!state.needsRestart&&(!connected&&!saved||expired)&&<div className="desktop-permission-actions"><Button className="primary-button" disabled={busy||!state.configured} onClick={()=>void run('connect')}>{expired||state.error&&state.error!=='CONNECTION_CANCELLED'?'重新登录':onboarding?'登录荷马':'登录'}</Button></div>}
      {state?.needsRestart&&!different&&<div className="desktop-permission-actions"><Button className="primary-button" disabled={busy} onClick={()=>void run('restart')}>重启并应用</Button></div>}
     </>}
     {!onboarding&&(connected||state?.source==='codex'&&saved)&&<section aria-label="可用积分">
      <div className="desktop-account-metrics"><p><span>可用积分</span><strong>{state?.wallet?`${state.wallet.available.toLocaleString(undefined,{maximumFractionDigits:6})} ${state.wallet.unit}`:'未知'}</strong></p></div>
      {state?.updatedAt&&<p>{state.stale||state.walletError?'上次记录':'更新时间'}：{new Date(state.updatedAt).toLocaleString()}</p>}
      {state?.walletError&&<p role="status">{error(state.walletError)}</p>}
      {walletKnown&&state?.wallet?.available===0&&<p role="status">购买积分后即可开始使用。</p>}
      {!walletKnown&&<p role="status">暂时无法确认可用积分，请重新检查。</p>}
      <div className="desktop-permission-actions">
       <Button className="primary-button" disabled={busy||!state?.configured} onClick={()=>void run('openWebsite')}>购买积分</Button>
       {(!walletKnown||state?.wallet?.available===0)&&<Button disabled={busy} onClick={()=>void run('refresh')}>{walletKnown?'我已购买，刷新状态':'重新检查积分'}</Button>}
      </div>
     </section>}
    </>}
    {different&&<div className="desktop-account-apply">
     <p>当前使用{state?.source==='codex'?'ChatGPT 套餐':'荷马模型服务'}。停止当前工作后切换，重启后继续原对话。</p>
     {(viewingCodex?onboarding&&native?.connected&&!state?.nativeError:saved&&!expired&&state?.websiteReady!==false&&!state?.pending)&&<Button className="primary-button" disabled={busy} onClick={()=>void run(viewingCodex?'applyCodex':'applyWebsite')}>应用并重启</Button>}
    </div>}
   </div>
   {onboarding&&<>{sourceEntry}<p className="desktop-account-hint">之后可以在设置中查看账号或切换服务。</p></>}
   {!onboarding&&!viewingCodex&&(saved||connected)&&!state?.pending&&<div className="desktop-account-footer"><Button disabled={busy} onClick={()=>void run('disconnect')}>退出登录</Button></div>}
  </>}
  {notice&&<p role="status">{notice}</p>}
  {onboarding&&notice&&<Button disabled={busy} onClick={()=>void run('state')}>重新检查账号</Button>}
 </div>;
}


function currentHomerWallet(state?:AccountState){
 const wallet=state?.wallet;
 return state?.supported&&state.configured&&state.source==='website'&&state.active==='website'&&wallet&&!state.stale&&!state.walletError&&state.error!=='TOKEN_UNAVAILABLE'&&!(wallet.expiresAt&&wallet.expiresAt<=Date.now()/1000)?wallet:undefined;
}

export function ModelFailureNotice({failure,onAccount,onDismiss}:{failure?:NonNullable<WebState['modelFailure']>;onAccount?:()=>void;onDismiss?:()=>void}){
 const bridge=window.homerDesktopAccount;
 const {state,busy,notice,run}=useDesktopAccount({currentSourceOnly:true});
 const [dismissed,setDismissed]=useState<string>(),[lowSeen,setLowSeen]=useState(false);
 const active=state?.supported&&state.configured&&state.source==='website'&&state.active==='website';
 const expired=!!state?.wallet?.expiresAt&&state.wallet.expiresAt<=Date.now()/1000||state?.walletError==='TOKEN_UNAVAILABLE'||state?.error==='TOKEN_UNAVAILABLE';
 const currentWallet=currentHomerWallet(state),known=!!currentWallet;
 const low=known&&currentWallet.unit==='积分'&&currentWallet.available<=10;
 useEffect(()=>{
  if(!active||known&&!low)setLowSeen(false);
  else if(low)setLowSeen(true);
 },[active,known,low]);
 const current=failure?.messageId===dismissed?undefined:failure;
 const quota=current?.code==='engine_quota_insufficient'||!current&&active&&(low||lowSeen);
 const rate=current?.code==='engine_rate_limited',auth=current?.code==='engine_authentication_failed',unconfirmed=current?.code==='engine_account_status_unconfirmed';
 const website=quota&&(current?current.source==='website':active);
 const wallet=website?currentWallet:undefined;
 const zero=wallet?.available===0;
 let title=quota?'额度不足':rate?'请求受到限流，本次未能继续':auth?'账号连接未通过验证':unconfirmed?'账号状态未能确认':'本次请求未能完成';
 let description=quota?'当前额度不足以继续本次请求。':rate?'请稍后再发起请求。恢复时间暂未提供，荷马不会自动重试。':auth?'当前模型服务未通过认证，请检查账号连接后重新发送消息。':unconfirmed?'未能核实账号状态，请检查连接与额度后重新发送消息。':'原因暂无法确认。请先核对已有结果，再决定下一步。';
 if(website){
  title=zero?'积分已用完':current?'额度不足':wallet?'积分余额较低':'积分状态待确认';
  if(expired)description='登录凭据已失效，请查看账号与额度并重新登录。';
  else if(!wallet)description=current?'本次请求因额度不足未能完成，剩余积分暂时无法确认，请刷新余额。':'剩余积分暂时无法确认，请刷新余额或查看账号与额度。';
  else if(zero)description='新的模型请求将无法继续；已保存的对话和成果仍可查看。购买积分后，请刷新余额再继续。';
  else description=current?'当前额度不足以继续本次请求，请购买积分后重新发送。':'积分用完后，新的模型请求将无法继续。建议及时购买，避免工作中断。';
 }
 async function refresh(){
  const wallet=currentHomerWallet(await run('refresh'));
  if(wallet?.unit==='积分'&&wallet.available>10)setDismissed(failure?.messageId);
 }
 if(!current&&!quota)return null;
 return <section className={'model-failure-notice'+(quota?' model-failure-notice-quota':'')} aria-label={quota?(website?'积分余额提醒':'额度不足提醒'):rate?'请求限流提醒':'请求失败提醒'}>
  <div className="model-failure-copy"><div role="status">
   <div className="model-failure-heading"><h2>{title}</h2>{website&&<p className="model-failure-balance">{wallet&&wallet.unit!=='积分'?'剩余额度':'剩余积分'}：<strong>{wallet?`${wallet.available.toLocaleString(undefined,{maximumFractionDigits:6})} ${wallet.unit}`:'暂时无法确认'}</strong></p>}</div>
   <p>{description}</p>
  </div>
   {(quota||auth||unconfirmed)&&(bridge||onAccount)&&<div className="model-failure-actions">
    {onAccount&&<Button className="model-failure-account" onClick={onAccount}>查看账号与额度</Button>}
    {website&&bridge&&!expired&&<Button className="primary-button" disabled={busy||state?.configured===false} aria-busy={busy} onClick={()=>void run('openWebsite')}>购买积分</Button>}
    {website&&bridge&&<Button disabled={busy} aria-busy={busy} onClick={()=>void refresh()}>刷新余额</Button>}
   </div>}
   {quota&&notice&&<p role="status">{notice}</p>}
  </div>
  {!quota&&<Button className="model-failure-close" aria-label={'关闭'+(rate?'请求限流':'请求失败')+'提醒'} onClick={()=>{setDismissed(current!.messageId);onDismiss?.();}}><X size={16}/></Button>}
 </section>;
}
