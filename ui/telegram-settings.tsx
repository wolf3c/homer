import {useEffect,useRef,useState} from 'react';
import {Button} from '@base-ui/react/button';
import {Form} from '@base-ui/react/form';
import {Field} from '@base-ui/react/field';
import {Eye,EyeOff} from 'lucide-react';
import {canStartChannel,channelError,channelLabel,channelRequest,type ChannelSettings} from './channel-settings';

type Pair={code:string;expiresAt:number};
type Candidate={userId:string;chatId:string};
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value));
export function TelegramSettingsPanel({model,onDirtyChange}:{model:ChannelSettings<'telegram'>;onDirtyChange:(dirty:boolean)=>void}){
 const [token,setToken]=useState(''),[reveal,setReveal]=useState(false),[editing,setEditing]=useState(false),[pair,setPair]=useState<Pair>(),[candidate,setCandidate]=useState<Candidate>(),[notice,setNotice]=useState('');
 const mounted=useRef(true);
 const {state,busy,unconfirmed,error,loading}=model,ready=canStartChannel(state),locked=busy||unconfirmed||!state;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onDirtyChange(false);};},[onDirtyChange]);
 useEffect(()=>{
  if(!pair||busy||unconfirmed||!ready||state?.bound)return;
  let active=true,timer:ReturnType<typeof setTimeout>;
  async function poll(){
   if(Date.now()>=pair!.expiresAt){if(active){setPair(undefined);setCandidate(undefined);setNotice('配对码已过期，请重新生成。');}return;}
   if(document.hidden){timer=setTimeout(poll,1200);return;}
   try{
    const value=await channelRequest<unknown>('telegram','/pair/candidate',{code:pair!.code});
    if(!active)return;
    if(value===null){setCandidate(undefined);setNotice('');}
    else if(typeof value==='object'&&validId((value as Candidate).userId)&&validId((value as Candidate).chatId)){setCandidate(value as Candidate);setNotice('');}
    else{setCandidate(undefined);setNotice('配对状态暂不可用，请重新核对。');}
   }catch(e){if(active){setCandidate(undefined);setNotice(channelError(e));}}
   finally{if(active)timer=setTimeout(poll,1200);}
  }
  void poll();return()=>{active=false;clearTimeout(timer);};
 },[pair,busy,unconfirmed,ready,state?.bound]);
 async function save(){
  const value=token.trim();if(!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(value))return;
  setToken('');setReveal(false);onDirtyChange(false);setPair(undefined);setCandidate(undefined);setNotice('');
  const result=await model.run('/configure',{token:value});
  if(mounted.current){if(result){setEditing(false);setNotice('Bot 配置已保存。');}else setNotice('Token 输入已清空，请重新输入；结果未确认时请勿重复提交。');}
 }
 async function generatePair(){
  setPair(undefined);setCandidate(undefined);setNotice('');
  const result=await model.run<{code:string;expiresInSeconds:number}>('/pair');
  if(!mounted.current||!result)return;
  setPair({code:result.code,expiresAt:Date.now()+result.expiresInSeconds*1000});
 }
 return <div className="channel-settings">
  <h2>Telegram</h2><p>配置专用 Bot，绑定你的 Telegram 账号。</p>
  <p role="status">{busy?'正在处理…':unconfirmed?'结果未确认':loading?'正在读取连接状态…':state&&!state.configured?'尚未配置 Bot':state&&!state.bound&&['offline','online'].includes(state.status)?'待绑定本人':channelLabel(state)}</p>
  {error&&<p className="channel-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {(!state&&!loading&&!busy||unconfirmed)&&<Button disabled={busy||loading} onClick={()=>void model.refresh()}>重新检查</Button>}
  {state&&<>
   {!state.configured||editing?<section><h3>配置 Bot</h3><p>在 Telegram 的官方 BotFather 创建专用 Bot。Token 仅填在本机设置中，请勿发到聊天中。</p>
    {state.enabled&&<p>保存新 Token 会暂停当前收发。</p>}
    <Form onFormSubmit={()=>void save()} aria-busy={busy}>
     <Field.Root name="bot-token"><Field.Label>Bot Token</Field.Label><div className="channel-settings-secret"><Field.Control type={reveal?'text':'password'} value={token} onValueChange={value=>{setToken(value);onDirtyChange(!!value);}} autoComplete="off" autoCapitalize="off" spellCheck={false} required maxLength={121} pattern="[0-9]{5,20}:[A-Za-z0-9_-]{20,100}" disabled={locked}/><Button type="button" aria-label={reveal?'隐藏 Token':'显示 Token'} disabled={locked} onClick={()=>setReveal(!reveal)}>{reveal?<EyeOff size={18}/>:<Eye size={18}/>}</Button></div><Field.Error/></Field.Root>
     <Button type="submit" disabled={locked||!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token.trim())}>{busy?'正在验证并保存…':'验证并保存'}</Button>
    </Form>
   </section>:<div className="channel-settings-actions"><span>专用 Bot 已配置</span><Button disabled={locked} onClick={()=>{setPair(undefined);setCandidate(undefined);setEditing(true);}}>更新 Token</Button></div>}
   {state.configured&&!editing&&<section><h3>{state.bound?'本人绑定已保留':'绑定本人'}</h3>
    {!ready&&<p className="channel-settings-note">新旧消息边界尚未确认，暂不恢复收发或开始配对。</p>}
    {state.bound?<><p>暂停保留绑定，不取消已派发的后台工作。</p>{state.ownerId&&<p>账号 ID：{state.ownerId}</p>}</>:<p>在此 Bot 的普通私聊发送下方一次性指令，再回来核对并批准你刚刚发起的本人配对。</p>}
    <div className="channel-settings-actions">
     {state.enabled?<Button disabled={locked} onClick={()=>{setPair(undefined);setCandidate(undefined);void model.run('/disconnect');}}>暂停收发</Button>:<Button disabled={locked||!ready} onClick={()=>void model.run('/connect')}>{state.bound?'恢复收发':'连接并准备配对'}</Button>}
     {!state.bound&&state.enabled&&<Button disabled={locked||!ready} onClick={()=>void generatePair()}>{pair?'重新生成配对码':'生成配对码'}</Button>}
    </div>
    {pair&&!state.bound&&<div className="channel-settings-pair"><code>/start {pair.code}</code><p>有效至 {new Date(pair.expiresAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}。关闭设置不会撤销服务端配对码。</p>
     {candidate?<><p>账号 ID：{candidate.userId}<br/>私聊 ID：{candidate.chatId}</p><p>仅确认你刚刚发起的本人配对。不确定时请重新配对。</p><div className="channel-settings-actions"><Button disabled={locked||!ready} onClick={()=>{if(Date.now()>=pair.expiresAt){setPair(undefined);setCandidate(undefined);setNotice('配对码已过期，请重新生成。');return;}void model.run('/pair/approve',{code:pair.code,...candidate});}}>确认是我并绑定</Button><Button disabled={locked||!ready} onClick={()=>void generatePair()}>不是我，重新配对</Button></div></>:<p>等待本人发起配对…</p>}
    </div>}
   </section>}
   {(state.uncertain>0||state.failed>0||state.uncertainInputs>0)&&<p className="channel-settings-note">有消息或接收结果尚未确认，请先在手机核对。不会自动重发旧消息。</p>}
   {state.configured&&<section className="channel-settings-danger"><h3>解除绑定</h3><p>历史保留尚未核验，暂不能删除绑定凭据。</p><Button disabled>解除绑定并删除凭据</Button></section>}
  </>}
 </div>;
}
