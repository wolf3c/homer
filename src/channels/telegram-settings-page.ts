// Static assets served by the existing loopback server; no inline script, token
// interpolation, browser storage, external resources or second listener.
export const telegramSettingsHtml = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telegram · 荷马</title><link rel="stylesheet" href="/settings/telegram.css"><script type="module" src="/settings/telegram.js"></script></head>
<body><main><a class="back" href="/">← 回到荷马对话</a><header><img src="/branding/homer.png" width="52" height="52" alt="荷马"><div><h1>连接 Telegram</h1><p>手机与电脑继续同一个荷马对话。</p></div></header>
<p id="status" role="status" aria-live="polite">正在读取本地连接状态…</p>
<section><h2>1. 保存自己的 Bot</h2><p>先在 Telegram 的 <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">BotFather</a> 创建专用 Bot。Token 只填在此电脑的本地设置页，请勿发给荷马聊天。</p>
<form id="credentials"><label for="token">Bot Token</label><div class="input-row"><input id="token" name="telegram-secret" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" required maxlength="121"><button id="save" type="submit">验证并安全保存</button></div><small>凭据保存到此电脑的钥匙串。首次连接会检查已有 webhook，不会替你删除。</small></form><p id="error" role="alert" tabindex="-1" hidden></p></section>
<section><h2>2. 明确绑定本人</h2><p>连接后生成一次性配对码，在你与此 Bot 的普通私聊中发送显示的 /start 指令，再回此页核对并批准具体账号。</p>
<div class="actions"><button id="connect" type="button">连接</button><button id="pair" type="button">生成配对码</button><button id="disconnect" class="secondary" type="button">断开收发</button></div>
<pre id="pair-code" hidden></pre><p id="candidate" aria-live="polite"></p><button id="approve" type="button" hidden>批准以上本人账号</button></section>
<section><h2>连接说明</h2><p>此电脑需保持在线并能访问 Telegram。断开收发后，已经派发的工作仍继续；成果保存在本机，重连后回到原私聊。手机停止生成仅停止当前主回复。</p><p id="counts"></p><button id="forget" class="danger" type="button">解除绑定并删除本机凭据</button><p><small>解除绑定会使旧按钮与旧来源失效；不会删除主对话历史或取消后台工作。发送未确认的项目需要先在手机核对，不会盲目重发。</small></p></section>
</main></body></html>`;

export const telegramSettingsCss = `:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#152332;background:#f7f8fa;font-size:16px;line-height:1.75}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:auto;padding:32px 22px 64px}header{display:flex;align-items:center;gap:16px;margin:28px 0}header img{border-radius:12px}h1{font-size:26px;margin:0}h2{font-size:19px;margin:0 0 12px}p{margin:10px 0}header p{margin:0;color:#526171}section{border-top:1px solid #dce1e6;padding:24px 0}a{color:#1c4c78;text-underline-offset:3px}small{color:#526171}label{display:block;margin-bottom:6px}.input-row,.actions{display:flex;gap:10px;flex-wrap:wrap}input{min-width:180px;flex:1;font:inherit;border:1px solid #9ca8b4;border-radius:10px;padding:10px;background:#fff}button{font:inherit;font-weight:600;padding:10px 16px;border:1px solid #152332;background:#152332;color:white;border-radius:10px;cursor:pointer}button.secondary{background:white;color:#152332}button.danger{background:#fff;color:#a92735;border-color:#a92735}button:disabled{opacity:.5;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #3c79a7;outline-offset:3px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8edf2;padding:14px;border-radius:10px}#status{padding:12px 0;font-weight:600}#error{color:#992039;background:#fff0f2;padding:12px;border-radius:10px}@media(max-width:500px){main{padding:20px 18px 48px}.input-row{display:block}.input-row input,.input-row button{width:100%;margin-bottom:10px}}`;

export const telegramSettingsJs = `
const el=id=>document.getElementById(id);
let pairing=null,candidate=null,polling=false,timer=null,expiresAt=0,busy=false,lastState=null;
const states={offline:'已断开收发',online:'已连接',conflict:'检测到其他消费者；已停止连接',unauthorized:'凭据不可用；请重新设置',network_retry:'网络重连中',presentation_degraded:'富呈现降级；需核对',send_uncertain:'有发送结果未确认；请先在手机核对',send_failed:'有发送失败的内容',host_uncertain:'主任务接受或停止尚未确认'};
const explanations={
  telegram_existing_webhook:'此 Bot 已有 webhook。请先在原服务核实归属；荷马未删除它。',
  telegram_consumer_already_running:'同一个 Bot 已有接收实例，请保留一个消费者。',
  telegram_pairing_expired:'配对码已过期，请重新生成。',
  telegram_pairing_mismatch:'候选账号已变化，请重新核对。',
  telegram_invalid_token:'Token 格式不正确，请在本地重新输入。',
  telegram_unbind_previous_bot_first:'请先明确解除旧 Bot 绑定，再配置新 Bot。',
  telegram_not_configured:'请先安全保存你自己的 Bot Token。',
  telegram_keychain_unavailable:'未能完成系统钥匙串保存或核验。请检查此电脑的钥匙串权限，再在本地重试。',
  telegram_keychain_invalid:'钥匙串凭据核验失败，请在本地重新设置。',
  telegram_unauthorized:'Telegram 未接受此凭据，请在 BotFather 核对后仅在本地重新输入。',
  telegram_uncertain:'Telegram 验证结果未确认。请检查此电脑能否访问 Telegram，再核对本地连接状态。',
  telegram_rate_limited:'Telegram 暂时限流，请稍后重试。',
  telegram_rejected:'Telegram 拒绝了验证请求，请核对 Bot 设置。',
  telegram_request_timeout:'本次操作超时，结果未确认。请先核对连接状态；勿重复提交保存。',
  web_receipt_unconfirmed:'服务尚未确认保存结果。请先核对连接状态，勿重复提交。',
  telegram_save_unconfirmed:'服务未确认凭据已保存，请先核对连接状态。',
  telegram_local_unreachable:'无法确认本地服务响应，请检查服务是否仍在运行。',
  telegram_invalid_response:'本地服务响应不可读，请核对服务状态后重试。',
  telegram_request_failed:'本次操作未确认，请核对连接状态后重试。',
  service_upgrading:'服务正在安全升级，请稍后重试。'
};
async function api(path,input){
  const controller=new AbortController();
  let timer;
  // The configure RPC has its own 90s receipt limit. Bound the browser wait as
  // well, including stalled response bodies; a timeout never implies rollback.
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('telegram_request_timeout'));},path==='/configure'?95000:input===undefined?8000:40000);});
  const request=(async()=>{
    let response;
    try{response=await fetch('/api/channels/telegram'+path,{...(input===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),signal:controller.signal,headers:{...(input===undefined?{}:{'Content-Type':'application/json'})},credentials:'omit'});}
    catch{throw new Error('telegram_local_unreachable');}
    let value;
    try{value=await response.json();}catch{throw new Error('telegram_invalid_response');}
    if(!response.ok)throw new Error(Object.hasOwn(explanations,value?.error)?value.error:'telegram_request_failed');
    return value;
  })();
  try{return await Promise.race([request,deadline]);}finally{clearTimeout(timer);}
}
function clearPair(){clearTimeout(timer);pairing=null;candidate=null;expiresAt=0;el('pair-code').hidden=true;el('pair-code').textContent='';el('candidate').textContent='';el('approve').hidden=true;}
function controls(){
  const state=lastState;
  document.querySelectorAll('button').forEach(button=>button.disabled=busy);
  el('token').disabled=busy;
  if(!state)return;
  el('connect').disabled=busy||!state.configured||state.enabled;
  el('pair').disabled=busy||!state.configured||state.bound||!state.enabled;
  el('disconnect').disabled=busy||!state.enabled;
  el('forget').disabled=busy||!state.configured;
}
function show(state){
  lastState=state;
  el('status').textContent=(!state.configured?'尚未设置 Bot':states[state.status]||'连接状态待核对')+(state.bound?' · 已绑定本人账号':' · 尚未绑定本人');
  el('counts').textContent='待发送 '+state.pending+' · 未确认 '+state.uncertain+' · 失败 '+state.failed+' · 收件未确认 '+state.uncertainInputs+' · 过期收件待核对 '+state.heldInputs;
  controls();
}
async function refresh(skipIfBusy=false){const state=await api('');if(!skipIfBusy||!busy)show(state);}
async function action(fn,{progress='正在处理，请稍候…',success}={}){
  if(busy)return;
  busy=true;el('error').hidden=true;el('status').textContent=progress;
  el('credentials').setAttribute('aria-busy','true');
  el('save').textContent=progress.startsWith('正在验证')?'正在验证并保存…':'验证并安全保存';
  controls();
  try{await fn();if(success)el('status').textContent=success;else if(lastState&&el('status').textContent===progress)show(lastState);}
  catch(error){
    const code=Object.hasOwn(explanations,error?.message)?error.message:'telegram_request_failed';
    el('status').textContent='操作结果尚未确认，请查看提示。';
    el('error').textContent=explanations[code]+'（'+code+'）';el('error').hidden=false;
    el('error').focus({preventScroll:true});el('error').scrollIntoView({block:'center'});
  }finally{
    busy=false;el('credentials').removeAttribute('aria-busy');
    el('save').textContent='验证并安全保存';controls();
  }
}
async function poll(){if(!pairing||polling)return;if(Date.now()>=expiresAt){clearPair();el('candidate').textContent='配对码已过期，请重新生成。';return;}polling=true;const code=pairing;try{const value=await api('/pair/candidate',{code});if(pairing!==code)return;candidate=value;if(candidate){el('candidate').textContent='请核对本人稳定账号 ID：'+candidate.userId+'；私聊 ID：'+candidate.chatId;el('approve').hidden=false;}else{el('candidate').textContent='等待你在 Bot 私聊发送配对指令…';el('approve').hidden=true;}}catch{el('candidate').textContent='本地服务暂不可用；保留配对码，稍后重试。';}finally{polling=false;if(pairing)timer=setTimeout(poll,1200);}}
el('credentials').addEventListener('submit',event=>{
  event.preventDefault();if(busy)return;
  const token=el('token').value.trim();el('token').value='';
  void action(async()=>{clearPair();const state=await api('/configure',{token});if(!state.configured)throw new Error('telegram_save_unconfirmed');show(state);},{progress:'正在验证 Bot 并安全保存，请稍候…',success:'Bot 已验证并安全保存。请连接后绑定本人账号。'});
});
el('connect').onclick=()=>action(async()=>show(await api('/connect',{})));
el('pair').onclick=()=>action(async()=>{clearPair();const value=await api('/pair',{});pairing=value.code;expiresAt=Date.now()+value.expiresInSeconds*1000;el('pair-code').textContent='/start '+pairing;el('pair-code').hidden=false;void poll();});
el('approve').onclick=()=>action(async()=>{if(!pairing||!candidate)throw new Error('telegram_pairing_mismatch');show(await api('/pair/approve',{code:pairing,userId:candidate.userId,chatId:candidate.chatId}));clearPair();});
el('disconnect').onclick=()=>action(async()=>{clearPair();show(await api('/disconnect',{}));});
el('forget').onclick=()=>action(async()=>{if(!confirm('解除此 Bot 的本人绑定并删除本机钥匙串凭据？主对话和后台工作会保留。'))return;clearPair();show(await api('/forget',{}));});
const stateTimer=setInterval(()=>{if(!busy&&!document.hidden)void refresh(true).catch(()=>{if(!busy)el('status').textContent='本地服务暂不可用，请稍后重试。';});},5000);
window.addEventListener('pagehide',()=>{clearPair();clearInterval(stateTimer);});
void action(refresh,{progress:'正在读取本地连接状态…'});
`;
