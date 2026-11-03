import {useEffect,useRef,useState} from 'react';
import {Button} from '@base-ui/react/button';
import {AlertDialog} from '@base-ui/react/alert-dialog';
import {Clock,Plus,RefreshCw,Smartphone} from 'lucide-react';
import {connectionFetch} from './web-connection-client';

type Device={id:string;name:string;enabled:boolean};
type State={configured:boolean;devices:Device[];pending:{id:string;name:string}|null;expiresAt?:number|null};
export function MobileDeviceSettings(){
 const [state,setState]=useState<State>(),[qr,setQr]=useState<{qr:string;expiresAt:number}>();
 const [readFailed,setReadFailed]=useState(false),[uncertain,setUncertain]=useState(false),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const [editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState(''),[remove,setRemove]=useState<Device|null>(null);
 const live=useRef(false),pending=useRef(false),reading=useRef(false),uncertainRef=useRef(false),revision=useRef(0),cancelDelete=useRef<HTMLButtonElement>(null);
 async function call(path:string,input?:unknown){
  const response=await connectionFetch('/api/mobile/'+path,input===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  const value=await response.json();if(!response.ok)throw Error('mobile_action_failed');return value;
 }
 async function read(manual=false){
  if(reading.current||pending.current||(!manual&&(document.visibilityState==='hidden'||uncertainRef.current)))return;
  reading.current=true;const version=revision.current;
  try{
   const value:State=await call('state');if(!live.current||version!==revision.current)return;
   setState(value);setReadFailed(false);
   setQr(old=>old&&!value.expiresAt&&Date.now()<old.expiresAt?undefined:old);
   if(manual&&uncertainRef.current){uncertainRef.current=false;setUncertain(false);setNotice('已更新设备状态，请核对后再操作。');}
  }catch{if(live.current&&version===revision.current)setReadFailed(true);}
  finally{reading.current=false;}
 }
 async function action(path:string,input:unknown){
  if(pending.current||uncertainRef.current||readFailed)return;
  pending.current=true;revision.current++;setBusy(true);setNotice('');
  try{
   const value=await call(path,input);if(!live.current)return;
   if(path==='invite'){setQr(value);setNow(Date.now());}
   else{setState(value);if(path==='approve'||path==='reject')setQr(undefined);if(path==='update')setEditing(null);}
  }catch{if(live.current){uncertainRef.current=true;setUncertain(true);setQr(undefined);setNotice('');}}
  finally{pending.current=false;if(live.current)setBusy(false);}
 }
 useEffect(()=>{
  live.current=true;void read();const poll=window.setInterval(()=>void read(),1500),clock=window.setInterval(()=>setNow(Date.now()),1000);
  return()=>{live.current=false;revision.current++;window.clearInterval(poll);window.clearInterval(clock);};
 },[]);
 const locked=busy||readFailed||uncertain;
 const seconds=qr?Math.max(0,Math.ceil((qr.expiresAt-now)/1000)):0;
 const expired=!!qr&&seconds===0;
 const activePending=state?.pending&&(!state.expiresAt||state.expiresAt>now)?state.pending:null;
 const pendingName=activePending?.name&&activePending.name!=='移动设备'?activePending.name:'未知设备';
 const submitName=(event:React.FormEvent<HTMLFormElement>,id:string)=>{event.preventDefault();if(draft.trim())void action('update',{id,name:draft.trim()});};
 return <div className="mobile-device-settings mobile-settings" aria-busy={busy}>
  <h2>移动设备</h2><p className="mobile-settings-intro">连接手机后，可在 Homer App 继续主聊天。主端需保持运行。</p>
  {readFailed&&<section className="mobile-settings-message" role="alert"><h3>暂时无法读取设备状态</h3><p>请确认主端正在运行，然后重新检查。无法读取时，不会将设备视为未绑定。</p><Button disabled={busy} onClick={()=>void read(true)}>重新检查设备状态</Button></section>}
  {!readFailed&&uncertain&&<section className="mobile-settings-message" role="alert"><h3>操作结果尚未确认</h3><p>请先重新检查设备状态，确认结果后再继续操作。</p><Button disabled={busy} onClick={()=>void read(true)}>重新检查设备状态</Button></section>}
  {notice&&!locked&&<p className="mobile-settings-notice" role="status">{notice}</p>}
  {busy&&<p role="status">正在处理…</p>}
  {!state&&!readFailed&&!uncertain&&<p role="status">正在读取…</p>}
  {state&&!locked&&!state.configured&&<section className="mobile-settings-message" role="status"><h3>移动连接尚未配置</h3><p>请联系维护方开通主端连接地址后，再添加移动设备。</p></section>}
  {state&&!locked&&state.configured&&<>
   {activePending&&<section className="mobile-settings-pending" aria-label="待确认设备"><div className="mobile-settings-pending-title"><span aria-hidden="true"/><h3>有设备请求连接</h3></div><p>确认后，这台设备可以访问主聊天。</p><div className="mobile-settings-candidate"><p>设备名称</p><strong>{pendingName}</strong><p>名称仅供辨认，不能作为身份凭证。确认是你的设备后再绑定。</p></div><form key={activePending.id} onSubmit={event=>{event.preventDefault();void action('approve',{id:activePending.id,name:pendingName});}}><div className="mobile-settings-actions"><Button type="submit" className="mobile-settings-primary" disabled={busy}>确认绑定</Button><Button type="button" disabled={busy} onClick={()=>void action('reject',{id:activePending.id})}>拒绝</Button></div></form></section>}
   {!activePending&&qr&&<section className="mobile-settings-pairing" aria-label="扫码连接"><h3>{expired?'二维码已过期':'使用 Homer App 扫码'}</h3><p>{expired?'请重新生成二维码，再用手机扫描。':'扫码后，请回到这里确认绑定请求。'}</p><div className="mobile-settings-qr-layout">{!expired&&<div className="mobile-settings-qr"><img src={qr.qr} width={180} height={180} alt="用 Homer App 扫描此二维码连接主端"/></div>}<div className="mobile-settings-qr-details"><p className="mobile-settings-time"><Clock size={15}/>{expired?'当前二维码已失效':<>有效时间 <strong>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</strong></>}</p><p>请仅在信任的设备上扫码。重新生成会取消当前待确认请求。</p><Button disabled={busy} onClick={()=>void action('invite',{})}><RefreshCw size={15}/>重新生成二维码</Button></div></div></section>}
   {!activePending&&!qr&&!!state.expiresAt&&<section className="mobile-settings-message"><h3>请重新生成二维码</h3><p>当前页面无法显示之前生成的二维码。重新生成会取消当前待确认请求。</p><Button disabled={busy} onClick={()=>void action('invite',{})}><RefreshCw size={15}/>重新生成二维码</Button></section>}
   {!activePending&&!qr&&!state.expiresAt&&!state.devices.length&&<section className="mobile-settings-empty"><div className="mobile-settings-icon"><Smartphone size={23}/></div><h3>还没有绑定设备</h3><p>添加设备后，用手机扫码并在此确认。</p><Button className="mobile-settings-primary" disabled={busy} onClick={()=>void action('invite',{})}><Plus size={16}/>添加移动设备</Button></section>}
   {state.devices.length>0&&<section className="mobile-settings-devices"><div className="mobile-settings-list-heading"><div><h3>已绑定设备 <span>{state.devices.length}</span></h3><p>设备已启用不代表当前在线。</p></div>{!activePending&&!qr&&!state.expiresAt&&<Button disabled={busy} onClick={()=>void action('invite',{})}><Plus size={15}/>添加设备</Button>}</div><div>{state.devices.map(device=><section className="mobile-settings-device" aria-label={device.name} key={device.id}><div className="mobile-settings-device-icon"><Smartphone size={19}/></div><div className="mobile-settings-device-info">{editing===device.id?<form className="mobile-settings-edit" onSubmit={event=>submitName(event,device.id)}><label className="mobile-settings-sr-only" htmlFor={`mobile-name-${device.id}`}>设备名称</label><input id={`mobile-name-${device.id}`} value={draft} onChange={event=>setDraft(event.target.value)} maxLength={60} required/><Button type="submit" disabled={busy}>保存</Button><Button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</Button></form>:<><strong>{device.name}</strong><p><span className={device.enabled?'enabled':'disabled'} aria-hidden="true"/>{device.enabled?'已启用':'已停用'}</p></>}</div>{editing!==device.id&&<div className="mobile-settings-device-actions"><Button aria-label={`重命名${device.name}`} disabled={busy} onClick={()=>{setDraft(device.name);setEditing(device.id);}}>重命名</Button><Button aria-label={`${device.enabled?'停用':'启用'}${device.name}`} disabled={busy} onClick={()=>void action('update',{id:device.id,enabled:!device.enabled})}>{device.enabled?'停用':'启用'}</Button><Button aria-label={`删除${device.name}`} disabled={busy} onClick={()=>setRemove(device)}>删除</Button></div>}</section>)}</div></section>}
  </>}
  <AlertDialog.Root open={!!remove&&!locked} onOpenChange={open=>{if(!open)setRemove(null);}}><AlertDialog.Portal><AlertDialog.Backdrop className="desktop-settings-backdrop desktop-settings-confirm-backdrop"/><AlertDialog.Popup className="desktop-settings-confirm" initialFocus={cancelDelete}><AlertDialog.Title>删除设备绑定？</AlertDialog.Title><AlertDialog.Description>删除“{remove?.name}”后，这台设备需要重新配对才能访问主聊天。</AlertDialog.Description><div><AlertDialog.Close ref={cancelDelete}>取消</AlertDialog.Close><Button onClick={()=>{const id=remove?.id;setRemove(null);if(id)void action('delete',{id});}}>删除绑定</Button></div></AlertDialog.Popup></AlertDialog.Portal></AlertDialog.Root>
 </div>;
}
