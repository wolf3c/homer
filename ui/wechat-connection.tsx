import {useEffect,useState} from 'react';
import {Button} from '@base-ui/react/button';
import {Form} from '@base-ui/react/form';
import {Field} from '@base-ui/react/field';
import {canStartChannel,channelLabel,type ChannelSettings} from './channel-settings';

const loginLabels:Record<string,string>={wait:'等待扫码',scaned:'已扫码，请在微信中确认',confirmed:'授权已确认，正在核对连接状态',expired:'二维码已过期',need_verifycode:'请填写微信提示的验证码',verify_code_blocked:'验证暂时受限，请稍后重新扫码',already_bound:'已有绑定，请核对连接状态',error:'授权未完成，请重新核对'};
type Props={model:ChannelSettings<'wechat'>;onDirtyChange:(dirty:boolean)=>void};
export function WechatSettingsPanel({model,onDirtyChange}:Props){
 const [code,setCode]=useState(''),[failedImage,setFailedImage]=useState('');
 const {state,busy,unconfirmed,error,loading}=model,login=state?.login;
 const ready=canStartChannel(state),locked=busy||unconfirmed||!state;
 useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
 useEffect(()=>{
  if(!ready||busy||unconfirmed||!login||!['wait','scaned'].includes(login.status))return;
  const timer=setTimeout(()=>{if(!document.hidden)void model.run('/login/poll',{id:login.id});},2000);
  return()=>clearTimeout(timer);
 },[ready,busy,unconfirmed,login,model.run]);
 const image=ready&&login?.imagePath&&/^\/api\/channels\/wechat\/login\/[a-f0-9-]{36}\/qr\.png$/.test(login.imagePath)?login.imagePath:undefined;
 return <div className="channel-settings">
  <h2>微信</h2><p>使用微信继续同一个主对话。此电脑需保持在线。</p>
  <p role="status">{busy?'正在处理…':unconfirmed?'结果未确认':loading?'正在读取连接状态…':channelLabel(state)}</p>
  {error&&<p className="channel-error" role="alert">{error}</p>}
  {!state&&!loading&&!busy&&<Button onClick={()=>void model.refresh()}>重新检查</Button>}
  {unconfirmed&&<Button disabled={busy||loading} onClick={()=>void model.refresh()}>重新检查</Button>}
  {state&&<>
   <p>{state.bound?'本人绑定已保留。':'使用本人的微信扫码，并在手机上确认。'}</p>
   {!ready&&<p className="channel-settings-note">新旧消息边界尚未确认，暂不恢复收发。</p>}
   {login&&<section aria-label="微信扫码授权"><h3>{loginLabels[login.status]??'扫码状态待核对'}</h3>
    {image&&failedImage!==image&&<img className="wechat-qr" src={image} alt="微信授权二维码" onError={()=>setFailedImage(image)}/>}
    {image&&failedImage===image&&<p role="alert">二维码未能显示，请重新生成。</p>}
    {image&&<p>扫码后请在微信中确认。{login.expiresAt&&<>有效至 {new Date(login.expiresAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}。</>}</p>}
    {login.status==='need_verifycode'&&<Form onFormSubmit={()=>{const value=code;setCode('');onDirtyChange(false);void model.run('/login/poll',{id:login.id,verifyCode:value});}}>
     <Field.Root name="wechat-code"><Field.Label>验证码</Field.Label><Field.Control value={code} onValueChange={value=>{setCode(value);onDirtyChange(!!value);}} inputMode="numeric" autoComplete="off" pattern="[0-9]{4,12}" required disabled={locked||!ready}/><Field.Error/></Field.Root>
     <Button type="submit" disabled={locked||!ready||!/^\d{4,12}$/.test(code)}>确认验证码</Button>
    </Form>}
   </section>}
   <div className="channel-settings-actions">
    {state.enabled?<Button disabled={locked} onClick={()=>void model.run('/disable')}>暂停收发</Button>:state.bound?<Button disabled={locked||!ready} onClick={()=>void model.run('/reconnect')}>恢复收发</Button>:<Button disabled={locked||!ready} onClick={()=>void model.run('/login')}>扫码授权</Button>}
    {login&&(['expired','error','verify_code_blocked'].includes(login.status)||image&&failedImage===image)&&<Button disabled={locked||!ready} onClick={()=>void model.run('/login')}>重新生成二维码</Button>}
   </div>
   {(state.uncertain>0||state.failed>0)&&<p className="channel-settings-note">有消息发送未完成或结果未确认，请先到微信核对。不会自动重发旧消息。</p>}
   {state.bound&&<section className="channel-settings-danger"><h3>解除绑定</h3><p>历史保留尚未核验，暂不能解除绑定。</p><Button disabled>解除绑定</Button></section>}
  </>}
 </div>;
}
