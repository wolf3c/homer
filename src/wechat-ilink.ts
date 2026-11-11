import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';

const origin='https://ilinkai.weixin.qq.com';
const cdn='novac2c.cdn.weixin.qq.com';
const protocolVersion='2.4.10';
export type WechatCredential={botId:string;ownerId:string;botToken:string;baseUrl:string};
type WireObject=Record<string,unknown>;

export class WechatRejected extends Error{
  constructor(readonly code:number){super('wechat_api_rejected');}
}
export const wechatSessionExpired=(error:unknown)=>error instanceof WechatRejected&&[-14,401,403].includes(error.code);
export function wechatUrl(value:string){
  let url:URL;
  try{url=new URL(value);}catch{throw Error('wechat_url_denied');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!url.hostname.endsWith('.weixin.qq.com'))
    throw Error('wechat_url_denied');
  return url;
}
export function wechatMessageId(id:unknown):id is string{
  return typeof id==='string'&&/^[1-9]\d{0,19}$/.test(id)&&BigInt(id)<=18446744073709551615n;
}
function object(value:unknown):value is WireObject{
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
export const wechatValue=(value:unknown,max:number):value is string=>
  typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

export class WechatIlink{
  constructor(private http:typeof fetch){}
  async request(base:string,path:string,body:WireObject|undefined,credential:WechatCredential|undefined,signal:AbortSignal,timeout=15_000){
    signal.throwIfAborted();
    const headers:Record<string,string>={'iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|10)};
    if(body)Object.assign(headers,{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token',
      'X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')});
    if(credential)headers.Authorization='Bearer '+credential.botToken;
    const url=new URL('/ilink/bot/'+path,wechatUrl(base).origin);
    let response:Response;
    try{
      response=await this.http(url,{
        method:body?'POST':'GET',headers,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),
        ...(body?{body:JSON.stringify(credential?{...body,base_info:{channel_version:protocolVersion,bot_agent:'Homer/0.1.4'}}:body)}:{})
      });
    }catch{signal.throwIfAborted();throw Error('wechat_network_unavailable');}
    if(!response.ok){
      await response.body?.cancel();
      if([401,403].includes(response.status))throw new WechatRejected(response.status);
      throw Error('wechat_http_error');
    }
    const maxBytes=4*1024*1024;
    const reader=response.body?.getReader();
    if(!reader)throw Error('wechat_response_invalid');
    const chunks:Buffer[]=[];let size=0;
    try{
      for(;;){
        const {value,done}=await reader.read();
        if(done)break;
        size+=value.length;
        if(size>maxBytes)throw Error('wechat_response_invalid');
        chunks.push(Buffer.from(value));
      }
    }catch{signal.throwIfAborted();throw Error('wechat_response_invalid');}
    finally{await reader.cancel().catch(()=>{});}
    let result:unknown;
    try{
      result=JSON.parse(Buffer.concat(chunks,size).toString('utf8'),function(key,value){
        // Node 22 exposes the original number token before precision is lost.
        return key==='message_id'&&typeof value==='number'?arguments[2]?.source:value;
      });
    }catch{throw Error('wechat_response_invalid');}
    if(!object(result))throw Error('wechat_response_invalid');
    for(const code of [result.ret,result.errcode])
      if(code!==undefined&&!Number.isSafeInteger(code))throw Error('wechat_response_invalid');
    for(const code of [result.ret,result.errcode])if(typeof code==='number'&&code!==0)throw new WechatRejected(code);
    return result;
  }
  async send(account:WechatCredential,contextToken:string,item:WireObject,attemptId:string,signal:AbortSignal){
    const reply=await this.request(account.baseUrl,'sendmessage',{msg:{from_user_id:'',to_user_id:account.ownerId,
      client_id:'homer-'+attemptId,message_type:2,message_state:2,context_token:contextToken,item_list:[item]}},account,signal);
    if((reply.message_id!==undefined&&!wechatMessageId(reply.message_id))||(reply.ret!==0&&!wechatMessageId(reply.message_id)))
      throw Error('wechat_receipt_unknown');
    return wechatMessageId(reply.message_id)?reply.message_id:undefined;
  }
  async file(account:WechatCredential,filename:string,bytes:Buffer,signal:AbortSignal){
    if(!filename||filename.length>240||/[\\/\x00-\x1f\x7f]/.test(filename)||!bytes.length)throw Error('wechat_file_invalid');
    const key=randomBytes(16),filekey=randomBytes(16).toString('hex'),aeskey=key.toString('hex');
    const cipher=createCipheriv('aes-128-ecb',key,null);
    const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
    const md5=createHash('md5').update(bytes).digest('hex');
    const result=await this.request(account.baseUrl,'getuploadurl',{filekey,media_type:3,to_user_id:account.ownerId,
      rawsize:bytes.length,rawfilemd5:md5,filesize:encrypted.length,no_need_thumb:true,aeskey},account,signal);
    const url=typeof result.upload_full_url==='string'&&result.upload_full_url?wechatUrl(result.upload_full_url):
      wechatValue(result.upload_param,8192)?new URL('https://'+cdn+'/c2c/upload?'+new URLSearchParams({encrypted_query_param:result.upload_param,filekey})):undefined;
    if(!url||url.hostname!==cdn)throw Error('wechat_upload_url_denied');
    signal.throwIfAborted();
    const response=await this.http(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},
      body:encrypted,redirect:'error',signal});
    const receipt=response.headers.get('x-encrypted-param');
    await response.body?.cancel();
    if(response.status!==200||!wechatValue(receipt,8192))throw Error('wechat_upload_unconfirmed');
    return {type:4,file_item:{file_name:filename,len:String(bytes.length),md5,
      media:{encrypt_query_param:receipt,aes_key:Buffer.from(aeskey).toString('base64'),encrypt_type:1}}};
  }
}

export function wechatCredential(value:unknown):WechatCredential{
  if(!object(value)||!wechatValue(value.botId,256)||!wechatValue(value.ownerId,256)||
    !wechatValue(value.botToken,4096)||!wechatValue(value.baseUrl,512))throw Error('wechat_account_invalid');
  const url=wechatUrl(value.baseUrl);
  if(url.pathname!=='/'||url.search)throw Error('wechat_url_denied');
  return {botId:value.botId,ownerId:value.ownerId,botToken:value.botToken,baseUrl:url.origin};
}
export async function authorizeWechat(terminal:{showQr:(url:string)=>void|Promise<void>;scanned?:()=>void;verifyCode:(signal:AbortSignal)=>string|Promise<string>},
    http:typeof fetch=fetch,abort?:AbortSignal){
  const signal=AbortSignal.any([AbortSignal.timeout(300_000),...(abort?[abort]:[])]);
  const api=new WechatIlink(http);
  const qr=await api.request(origin,'get_bot_qrcode?bot_type=3',{local_token_list:[]},undefined,signal);
  if(!wechatValue(qr.qrcode,4096)||!wechatValue(qr.qrcode_img_content,4096))throw Error('wechat_qr_invalid');
  await terminal.showQr(wechatUrl(qr.qrcode_img_content).href);
  let base=origin,code:string|undefined;
  for(;;){
    const query=new URLSearchParams({qrcode:qr.qrcode,...(code?{verify_code:code}:{})});
    const result=await api.request(base,'get_qrcode_status?'+query,undefined,undefined,signal,40_000);
    code=undefined;
    switch(result.status){
      case 'confirmed':return wechatCredential({botId:result.ilink_bot_id,ownerId:result.ilink_user_id,
        botToken:result.bot_token,baseUrl:result.baseurl});
      case 'scaned_but_redirect':
        terminal.scanned?.();
        if(!wechatValue(result.redirect_host,255)||!/^[-.a-zA-Z0-9]+$/.test(result.redirect_host))throw Error('wechat_url_denied');
        base=wechatUrl('https://'+result.redirect_host).origin;break;
      case 'need_verifycode':
        code=await terminal.verifyCode(signal);
        if(!/^\d{4,12}$/.test(code))throw Error('wechat_verify_code_invalid');
        break;
      case 'scaned':terminal.scanned?.();break;
      case 'wait':break;
      case 'expired':throw Error('wechat_qr_expired');
      default:throw Error('wechat_qr_not_confirmed');
    }
    await wait(500,undefined,{signal});
  }
}
