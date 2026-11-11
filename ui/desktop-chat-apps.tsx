import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Popover} from '@base-ui/react/popover';
import {ArrowLeft,CircleAlert,Info,Plus} from 'lucide-react';
import wechatLogo from '../assets/branding/chat-apps/wechat.png';
import telegramLogo from '../assets/branding/chat-apps/telegram.svg';
import dingtalkLogo from '../assets/branding/chat-apps/dingtalk.png';
import type {DesktopChannel,DesktopChannelStart,DesktopChannelState} from '../src/desktop-channels';
import type {ChannelStatus} from '../src/channel-plugin';

type BindingInput={channel:DesktopChannel;key:string};
type Bridge={
  state:(refresh:boolean)=>Promise<DesktopChannelState>;
  start:(input:DesktopChannelStart)=>Promise<string>;
  code:(input:{id:string;code:string})=>Promise<void>;
  confirm:(input:{id:string})=>Promise<void>;
  cancel:(input:{id:string})=>Promise<void>;
  remove:(input:BindingInput)=>Promise<void>;
  undo:(input:BindingInput)=>Promise<void>;
  discard:()=>Promise<void>;
  apply:()=>Promise<void>;
};
declare global{interface Window{homerDesktopChatApps?:Bridge;}}

const names={wechat:'微信',telegram:'Telegram',dingtalk:'钉钉'};
const logos={wechat:wechatLogo,telegram:telegramLogo,dingtalk:dingtalkLogo};
const status={ready:'已连接',setup:'待发送首条消息',reauthorize:'需重新授权',offline:'暂时无法连接',checking:'等待连接'};
const phase={
  starting:'正在核验',scan:'等待扫码',scanned:'等待手机确认',code:'输入手机验证码',pair:'在 Bot 私聊里发起配对',
  confirm:'确认是你的私聊',error:'授权未完成',
};
const authErrors:Record<string,string>={
  wechat_qr_expired:'二维码已过期。请生成新的二维码。',
  channel_auth_timeout:'授权已超时，请重新开始。',
  telegram_pair_conflict:'Bot 已设置 webhook 或正在由其他程序接收消息。请处理冲突后重试。',
  telegram_token_unchanged:'请输入同一个 Bot 的新 Token。',
  telegram_token_invalid:'Bot Token 格式不正确。请在 BotFather 中核对。',
  dingtalk_credentials_invalid:'请在钉钉开发者后台核对 AppKey 和 AppSecret。',
  dingtalk_secret_unchanged:'请输入同一个机器人的新 AppSecret。',
  dingtalk_stream_conflict:'机器人正在由其他程序接收消息。请停止旧连接后重试。',
  channel_binding_conflict:'这个账号已有绑定或待生效变更。请返回列表核对。',
  channel_wrong_account:'该凭据对应另一个 Bot。请核对当前绑定。',
  wechat_unbind_before_replacing_account:'扫码账号与原绑定不一致，请用原微信账号重新扫码。',
};

export function DesktopChatApps(){
  const bridge=window.homerDesktopChatApps!;
  const [state,setState]=useState<DesktopChannelState>();
  const [selected,setSelected]=useState<BindingInput>();
  const [form,setForm]=useState<{channel:DesktopChannel;target?:string}>();
  const [remove,setRemove]=useState(false);
  const [pending,setPending]=useState(false);
  const [notice,setNotice]=useState('');
  const [applying,setApplying]=useState(false);
  const alive=useRef(false),flowId=useRef<string|undefined>(undefined),request=useRef(0),mutating=useRef(false);
  const heading=useRef<HTMLHeadingElement>(null);
  const mounted=()=>alive.current;

  async function read(refresh:boolean){
    const id=++request.current;
    try{
      const next=await bridge.state(refresh);
      if(!mounted()||id!==request.current)return;
      setState(next);
      if(flowId.current&&!next.flow){flowId.current=undefined;setForm(undefined);setSelected(undefined);}
      return next;
    }catch{
      if(mounted()&&id===request.current)setNotice('连接状态未能读取，请重新检查。');
    }
  }

  useEffect(()=>{
    alive.current=true;
    void read(true);
    return ()=>{
      alive.current=false;
      request.current++;
      if(flowId.current)void bridge.cancel({id:flowId.current}).catch(()=>{});
    };
  },[bridge]);

  const flow=state?.flow;
  const watching=!!form&&!!flow&&['starting','scan','scanned','pair'].includes(flow.phase);
  useEffect(()=>{
    if(!watching&&!applying)return;
    let disposed=false,timer:ReturnType<typeof setTimeout>;
    const tick=async()=>{
      const next=await read(false);
      if(disposed)return;
      if(applying&&!next?.busy){setApplying(false);return;}
      timer=setTimeout(tick,500);
    };
    timer=setTimeout(tick,500);
    return ()=>{disposed=true;clearTimeout(timer);};
  },[watching,applying,bridge]);

  useEffect(()=>{heading.current?.focus();},[selected,form]);

  async function act(run:()=>Promise<unknown>,failure='操作未能完成，请重新检查后重试。'){
    if(mutating.current)return;
    mutating.current=true;
    setPending(true);
    setNotice('');
    try{await run();if(mounted())await read(false);}
    catch{if(mounted()){setNotice(failure);await read(false);}}
    finally{mutating.current=false;if(mounted())setPending(false);}
  }

  function begin(channel:DesktopChannel,target?:string,token?:string,credentials?:DesktopChannelStart['credentials']){
    return act(async()=>{
      if(flowId.current){await bridge.cancel({id:flowId.current});flowId.current=undefined;}
      const id=await bridge.start({channel,target,token,...(credentials?{credentials}:{})});
      if(!mounted()){await bridge.cancel({id});return;}
      flowId.current=id;
      setForm({channel,target});
    });
  }

  function back(){
    if(form){
      setForm(undefined);
      if(flowId.current){
        const id=flowId.current;
        flowId.current=undefined;
        void act(()=>bridge.cancel({id}));
      }
    }else{setSelected(undefined);setRemove(false);}
  }

  function secret(event:FormEvent<HTMLFormElement>,name:string){
    event.preventDefault();
    const value=String(new FormData(event.currentTarget).get(name)??'').trim();
    event.currentTarget.reset();
    return value;
  }

  const changes=state?.pending??[];
  const busy=pending||applying||!!state?.busy;
  const changeFor=(row:BindingInput)=>changes.find(change=>change.channel===row.channel&&change.key===row.key);
  const rows=(channel:DesktopChannel)=>{
    const active=(state?.bindings??[]).filter(row=>row.adapterId===channel);
    const additions=changes.filter(change=>change.channel===channel&&change.kind==='add'&&!active.some(row=>row.accountKey===change.key))
      .map(change=>({adapterId:channel,accountKey:change.key,label:change.label,state:'checking',failed:0,unknown:0}) satisfies ChannelStatus);
    return [...active,...additions];
  };
  const row=selected&&rows(selected.channel).find(binding=>binding.accountKey===selected.key);
  const change=selected&&changeFor(selected);
  const label=(channel:DesktopChannel,binding:ChannelStatus)=>channel==='telegram'&&binding.label!==binding.accountKey?'@'+binding.label:binding.label;
  const pill=(binding:ChannelStatus,staged?:typeof change)=><span className="chat-apps-status" data-state={staged?'checking':state?.readError?'offline':binding.state}>
    {staged?staged.kind==='remove'?'待解绑':'待重启生效':state?.readError?'状态未确认':status[binding.state]}
  </span>;

  return <div className="chat-apps" aria-busy={busy}>
    {(row||form)&&<button className="chat-apps-quiet" type="button" onClick={back} disabled={busy}><ArrowLeft size={16}/>返回聊天应用</button>}
    <header className="chat-apps-heading">
      <h2 ref={heading} tabIndex={-1}>{form?form.target?'重新授权 '+names[form.channel]:form.channel==='wechat'?'绑定微信':form.channel==='dingtalk'?'添加钉钉机器人':'添加 Telegram Bot':row?'绑定详情':'连接聊天应用'}</h2>
      {!form&&!row&&<button className="chat-apps-quiet" type="button" disabled={busy} onClick={()=>void act(async()=>{await read(true);})}>重新检查</button>}
    </header>
    {notice&&<p role="alert">{notice}</p>}
    {form?<section className="chat-apps-card" aria-live="polite">
      {flow&&<h3>{phase[flow.phase]}</h3>}
      {!flow&&form.channel==='telegram'&&<form onSubmit={event=>void begin(form.channel,form.target,secret(event,'token'))}>
        <p>在 Telegram 的 BotFather 创建专用 Bot，或获取同一个 Bot 的新 Token。</p>
        <label>Bot Token<input name="token" type="password" autoComplete="off" maxLength={146} required disabled={busy}/></label>
        <button className="primary-button" disabled={busy}>验证 Bot</button>
      </form>}
      {!flow&&form.channel==='dingtalk'&&<form onSubmit={event=>{
        event.preventDefault();
        const data=new FormData(event.currentTarget);
        const credentials={appKey:String(data.get('appKey')??'').trim(),appSecret:String(data.get('appSecret')??'').trim()};
        event.currentTarget.reset();
        void begin('dingtalk',form.target,undefined,credentials);
      }}>
        <p>使用组织已批准且启用 Stream 的专用机器人。</p>
        <label>AppKey<input name="appKey" type="password" autoComplete="off" maxLength={104} required disabled={busy}/></label>
        <label>AppSecret<input name="appSecret" type="password" autoComplete="off" maxLength={200} required disabled={busy}/></label>
        <button className="primary-button" disabled={busy}>验证机器人</button>
      </form>}
      {!flow&&form.channel==='wechat'&&<button type="button" onClick={()=>void begin(form.channel,form.target)} disabled={busy}>生成二维码</button>}
      {flow?.qr&&['scan','scanned','code'].includes(flow.phase)&&<div className="chat-apps-qr">
        <img src={flow.qr} width={180} height={180} alt="微信扫码授权二维码"/>
        <p>{flow.phase==='scan'?'用要绑定的微信账号扫码。':'请在手机微信中完成授权。'}</p>
      </div>}
      {flow?.phase==='code'&&<form onSubmit={event=>{const code=secret(event,'code');void act(()=>bridge.code({id:flow.id,code}),'验证码格式不正确，请重新输入。');}}>
        <label>验证码<input name="code" inputMode="numeric" autoComplete="off" pattern="[0-9]{4,12}" maxLength={12} required disabled={busy}/></label>
        <button className="primary-button" disabled={busy}>确认验证码</button>
      </form>}
      {flow?.phase==='pair'&&<><p>在这个机器人的私聊中发送下方一次性指令。</p><code className="chat-apps-command">{flow.command}</code></>}
      {flow?.phase==='confirm'&&<>
        <p>{flow.target?'确认继续使用这个机器人的原私聊。':'请核对你刚刚发起配对的私聊。'}</p>
        <dl><dt>{form.channel==='dingtalk'?'机器人':'Bot'}</dt><dd>{flow.label}</dd><dt>私聊</dt><dd>{flow.peer}</dd></dl>
        <button className="primary-button" type="button" disabled={busy} onClick={()=>void act(async()=>{
          await bridge.confirm({id:flow.id});flowId.current=undefined;setForm(undefined);setSelected(undefined);
        })}>确认并绑定</button>
      </>}
      {flow?.phase==='error'&&<>
        <p role="alert">{authErrors[flow.error??'']??'未能完成授权，请核对凭据和网络后重试。'}</p>
        <button type="button" disabled={busy} onClick={()=>form.channel==='wechat'?void begin(form.channel,form.target):
          void act(async()=>{await bridge.cancel({id:flow.id});flowId.current=undefined;})}>
          {form.channel==='wechat'?'生成新二维码':form.channel==='dingtalk'?'重新输入凭据':'重新输入 Token'}
        </button>
      </>}
      <button className="chat-apps-quiet" type="button" disabled={busy} onClick={back}>取消</button>
    </section>:row&&selected?<div>
      <section className="chat-apps-card">
        <h3>{names[selected.channel]}@{row.label}</h3>
        <p>{pill(row,change)} 私聊入口</p>
        {row.state==='setup'&&!change&&<p>请先在该微信的 ClawBot 私聊里发一条消息。</p>}
        <div className="chat-apps-actions">
          {change?<button type="button" disabled={busy} onClick={()=>void act(async()=>{await bridge.undo(selected);setSelected(undefined);})}>撤销此变更</button>:<>
            {(row.state==='reauthorize'||selected.channel==='dingtalk')&&<button className="primary-button" type="button" disabled={busy||state?.stopped} onClick={()=>
              selected.channel==='wechat'?void begin('wechat',selected.key):setForm({channel:selected.channel,target:selected.key})
            }>重新授权</button>}
            <button className="chat-apps-danger" type="button" disabled={busy||state?.stopped} onClick={()=>setRemove(true)}>解除绑定</button>
          </>}
        </div>
      </section>
      <section className="chat-apps-card">
        <h3>发送情况</h3>
        {state?.readError||state?.stopped?<p>暂时无法确认发送情况。</p>:row.failed||row.unknown?<>
          <p>{row.failed} 条发送失败。消息仍可在荷马会话中查看。</p>
          <p>{row.unknown} 条结果待确认。请先到原私聊核对。</p>
        </>:<p>目前没有发送失败或结果待确认的消息。</p>}
      </section>
      {remove&&!change&&<section className="chat-apps-card">
        <h3>解除这个绑定？</h3>
        <p>重启后，这个入口停止收发。其他绑定和荷马会话记录会保留。</p>
        <div className="chat-apps-actions">
          <button type="button" onClick={()=>setRemove(false)} disabled={busy}>取消</button>
          <button className="chat-apps-danger" type="button" disabled={busy} onClick={()=>void act(async()=>{
            await bridge.remove(selected);setRemove(false);setSelected(undefined);
          })}>确认解绑</button>
        </div>
      </section>}
    </div>:<>
      <p>连接聊天应用，就能在微信、Telegram 或钉钉里和荷马对话。</p>
      {state?.readError&&<p role="status">连接状态未确认，请重新检查。</p>}
      {state?.result?.failed.length? <p role="alert">已保存 {state.result.saved.join('、')||'0 项'}。{state.result.failed.map(channel=>names[channel]).join('、')}的剩余变更待重试。</p>:null}
      {state?.stopped&&!changes.length&&<button className="primary-button" type="button" disabled={busy} onClick={()=>void act(async()=>{
        await bridge.apply();setApplying(true);
      })}>重新启动荷马</button>}
      {!!changes.length&&<div className="chat-apps-banner" role="status">
        <span>{applying||state?.busy?'正在等待当前工作安全停止并重启…':changes.length+' 项变更待重启生效。'}</span>
        <div className="chat-apps-actions">
          <button type="button" disabled={busy} onClick={()=>void act(()=>bridge.discard())}>撤销变更</button>
          <button className="primary-button" type="button" disabled={busy} onClick={()=>void act(async()=>{await bridge.apply();setApplying(true);})}>应用并重启</button>
        </div>
      </div>}
      {(['wechat','telegram','dingtalk'] as const).map(channel=>{
        const bindings=rows(channel);
        return <section className="chat-apps-group" key={channel}>
          <header className="chat-apps-heading">
            <h3><img className="chat-apps-logo" src={logos[channel]} alt="" width={20} height={20}/>{names[channel]} {bindings.length>0&&<span>{bindings.length}<span className="sr-only"> 个绑定</span></span>}</h3>
            <button type="button" disabled={busy||!state||state.stopped} onClick={()=>channel==='wechat'?void begin(channel):setForm({channel})}><Plus size={16}/>{channel==='wechat'?'扫码添加':channel==='dingtalk'?'添加机器人':'添加 Bot'}</button>
          </header>
          {channel==='telegram'&&<p>
            Telegram Bot 可加入群聊，成员可随时 @ 它（需关闭群隐私模式）{' '}
            <Popover.Root>
              <Popover.Trigger className="chat-apps-help" aria-label="如何关闭 Telegram 群隐私模式"><CircleAlert size={16} aria-hidden="true"/></Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={12} className="chat-apps-privacy-positioner">
                  <Popover.Popup className="chat-apps-privacy-tip">
                    <Popover.Title>关闭群隐私模式</Popover.Title>
                    <ol>
                      <li><a href="https://t.me/BotFather?startapp" target="_blank" rel="noopener noreferrer">打开 BotFather 小程序</a>，选中 Bot，在设置里关闭群隐私模式。</li>
                      <li>用绑定荷马的 Telegram 账号加群。已入群的 Bot 需先移出再加回。</li>
                    </ol>
                    <p>也可在 BotFather 私聊发送 <code>/setprivacy</code>，选中 Bot 后点 <strong>Disable</strong>。</p>
                    <p>关闭后，Bot 会收到普通群消息。启用群聊背景时，这些消息可用作上下文。</p>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </p>}
          <div className="chat-apps-list">
            {bindings.map(binding=>{
              const target={channel,key:binding.accountKey};
              return <div className="chat-apps-row" key={binding.accountKey}>
                <div><strong>{label(channel,binding)}</strong><p>{binding.failed||binding.unknown?binding.failed+' 条发送失败 · '+binding.unknown+' 条结果待确认':'私聊入口'}</p></div>
                {pill(binding,changeFor(target))}
                <button className="chat-apps-quiet" type="button" onClick={()=>setSelected(target)} disabled={busy}>查看</button>
              </div>;
            })}
            {!bindings.length&&<p className="chat-apps-empty">{!state?'正在读取连接…':state.readError?'绑定状态未确认。':'尚未添加绑定。'}</p>}
          </div>
        </section>;
      })}
      <p className="chat-apps-note"><Info size={16}/>普通回复回到发起消息的入口。后台通知和附件发往该事项当前订阅的入口。</p>
    </>}
  </div>;
}
