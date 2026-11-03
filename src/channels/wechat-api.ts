import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { MEDIA_POLICY, mediaLimit,detectMedia,imageDimensions,type MediaKind } from '../media-policy.js';
import {getDuration} from 'silk-wasm';

export const WECHAT_AUTH_ORIGIN = "https://ilinkai.weixin.qq.com";
const VERSION = "0.1.0";
export type WechatCredential = { botToken: string; botId: string; ownerId: string; baseUrl: string; dataKey: string };
export type WechatMedia={encrypt_query_param?:string;aes_key?:string;encrypt_type?:number;full_url?:string};
export type WechatThumbnail={bytes:Buffer;width:number;height:number};
export type WechatItem = { type: number; msg_id?:string;is_completed?:boolean;text_item?: { text?: string };
 image_item?:{media?:WechatMedia;thumb_media?:WechatMedia;aeskey?:string;url?:string;mid_size?:number;hd_size?:number;thumb_size?:number;thumb_width?:number;thumb_height?:number};
 voice_item?:{media?:WechatMedia;text?:string;encode_type?:number;sample_rate?:number;bits_per_sample?:number;playtime?:number};
 file_item?:{file_name?:string;len?:string;md5?:string;media?:WechatMedia};
 video_item?:{media?:WechatMedia;thumb_media?:WechatMedia;video_size?:number;play_length?:number;video_md5?:string;thumb_size?:number;thumb_width?:number;thumb_height?:number};
 tool_call_start_item?:{tool_name?:string;tool_call_id?:string};tool_call_result_item?:{tool_name?:string;tool_call_id?:string;status?:string};
 ref_msg?:{message_item?:WechatItem;title?:string;svr_id?:string;partial_text?:{start:string;end:string;startindex:number;endindex:number;quotemd5:string}} };
export type WechatUpdate = {
  message_id?: string | number; seq?: number; from_user_id?: string; to_user_id?: string;
  group_id?: string; message_type?: number; message_state?: number; context_token?: string; item_list?: WechatItem[];
};
export type WechatUpdates = { ret?: number; errcode?: number; msgs?: WechatUpdate[]; get_updates_buf?: string; longpolling_timeout_ms?: number };
export type WechatQrStatus = { status: string; bot_token?: string; ilink_bot_id?: string; ilink_user_id?: string; baseurl?: string; redirect_host?: string };
export type WechatSendFailure = {
  event: "wechat_send_failure";
  stage: "transport" | "http" | "response" | "api" | "receipt";
  code: "wechat_send_uncertain" | "wechat_credentials_invalid" | "wechat_api_rejected";
  uncertain: boolean;
};
export class WechatError extends Error {
  constructor(readonly code: string, readonly uncertain = false, readonly stage?: WechatSendFailure["stage"]) { super(code); }
}
export function wechatUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new WechatError("wechat_url_denied"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      !url.hostname.endsWith(".weixin.qq.com")) throw new WechatError("wechat_url_denied");
  return url;
}
// Tokenize strings first: numbers inside text cannot be mistaken for JSON IDs.
export function parseWechatJson(raw: string): unknown {
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[^\s]/g) ?? [];
  for (let i = 0; i < tokens.length - 2; i++) {
    const token = tokens[i]!;
    if (!token.startsWith('"') || tokens[i + 1] !== ":") continue;
    const key = JSON.parse(token);
    if (["message_id", "msg_id", "svr_id"].includes(key) && /^\d+$/.test(tokens[i + 2]!))
      tokens[i + 2] = JSON.stringify(tokens[i + 2]);
  }
  return JSON.parse(tokens.join(""));
}
export function splitWechatText(text: string, maxBytes = 3500): string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new WechatError("wechat_chunk_size_invalid");
  const chunks: string[] = []; let chunk = "", bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) { chunks.push(chunk); chunk = ""; bytes = 0; }
    chunk += char; bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
export class WechatApi {
  constructor(private fetcher: typeof fetch = fetch,
    private diagnose: (failure: WechatSendFailure) => void = failure => console.warn(JSON.stringify(failure))) {}
  private async request(base: string, path: string, body: unknown, credential?: WechatCredential, signal?: AbortSignal, timeout = 15000): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { "iLink-App-Id": "bot", "iLink-App-ClientVersion": "256" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers.AuthorizationType = "ilink_bot_token";
      headers["X-WECHAT-UIN"] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString("base64");
    }
    if (credential) headers.Authorization = `Bearer ${credential.botToken}`;
    const sending = path === "ilink/bot/sendmessage";
    const failure = (code: WechatSendFailure["code"], stage: WechatSendFailure["stage"], uncertain = false, otherCode: string = code) => {
      if (sending) {
        // Only local constants enter this diagnostic. Never include the request, response or caught error.
        try { this.diagnose({ event: "wechat_send_failure", stage, code, uncertain }); } catch { /* Diagnostics cannot change the send outcome. */ }
      }
      return new WechatError(sending ? code : otherCode, sending && uncertain, sending ? stage : undefined);
    };
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, wechatUrl(base).origin + "/"), {
        method: body === undefined ? "GET" : "POST", headers,
        ...(body === undefined ? {} : { body: JSON.stringify(credential ? { ...(body as object), base_info: { channel_version: VERSION, bot_agent: "Homer/0.1.0" } } : body) }),
        redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      });
    } catch { throw failure("wechat_send_uncertain", "transport", true, "wechat_network_unavailable"); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw failure("wechat_credentials_invalid", "http");
      throw failure("wechat_send_uncertain", "http", true, "wechat_http_error");
    }
    let data: Record<string, unknown>;
    try {
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error();
      const parsed = parseWechatJson(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      data = parsed as Record<string, unknown>;
    } catch { throw failure("wechat_send_uncertain", "response", true, "wechat_response_invalid"); }
    if (sending && [data.ret, data.errcode].some(value => value !== undefined &&
        (typeof value !== "number" || !Number.isSafeInteger(value)))) throw failure("wechat_send_uncertain", "receipt", true);
    if (data.ret === -14 || data.errcode === -14) throw failure("wechat_credentials_invalid", "api");
    if ((typeof data.ret === "number" && data.ret !== 0) || (typeof data.errcode === "number" && data.errcode !== 0))
      throw failure("wechat_api_rejected", "api");
    if (sending) {
      // Tencent's SendMessageResp omits ret on some successes. A uint64 server ID is
      // positive receipt evidence; an empty object or malformed status is not.
      const id = data.message_id;
      const hasMessageId = typeof id === "string" && /^\d{1,20}$/.test(id) && BigInt(id) <= 18446744073709551615n;
      if ((id !== undefined && !hasMessageId) || (data.ret !== 0 && !hasMessageId)) throw failure("wechat_send_uncertain", "receipt", true);
    }
    return data;
  }
  async beginQr(signal?: AbortSignal): Promise<{ qrcode: string; qrcode_img_content: string }> {
    const data = await this.request(WECHAT_AUTH_ORIGIN, "ilink/bot/get_bot_qrcode?bot_type=3", { local_token_list: [] }, undefined, signal);
    if (typeof data.qrcode !== "string" || !data.qrcode || typeof data.qrcode_img_content !== "string" || !data.qrcode_img_content)
      throw new WechatError("wechat_qr_invalid");
    wechatUrl(data.qrcode_img_content);
    return { qrcode: data.qrcode, qrcode_img_content: data.qrcode_img_content };
  }
  async pollQr(base: string, qrcode: string, signal?: AbortSignal, verifyCode?: string): Promise<WechatQrStatus> {
    if (verifyCode !== undefined && !/^\d{4,12}$/.test(verifyCode)) throw new WechatError("wechat_verify_code_invalid");
    const query = new URLSearchParams({ qrcode, ...(verifyCode ? { verify_code: verifyCode } : {}) });
    const data = await this.request(base, "ilink/bot/get_qrcode_status?" + query, undefined, undefined, signal, 35000);
    if (typeof data.status !== "string") throw new WechatError("wechat_qr_status_invalid");
    return data as WechatQrStatus;
  }
  async updates(credential: WechatCredential, cursor: string, signal?: AbortSignal, timeout = 35000): Promise<WechatUpdates> {
    const data = await this.request(credential.baseUrl, "ilink/bot/getupdates", { get_updates_buf: cursor }, credential, signal, timeout);
    if (data.msgs !== undefined && !Array.isArray(data.msgs)) throw new WechatError("wechat_updates_invalid");
    return data as WechatUpdates;
  }
  async send(credential: WechatCredential, peerId: string, contextToken: string, clientId: string, item: WechatItem, signal?: AbortSignal):Promise<Record<string,unknown>|void> {
    if(peerId!==credential.ownerId||!contextToken)throw new WechatError('wechat_reply_route_invalid');
    return this.request(credential.baseUrl,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:peerId,client_id:clientId,message_type:2,message_state:2,context_token:contextToken,item_list:[item]}},credential,signal);
  }
  async sendItems(credential:WechatCredential,peerId:string,contextToken:string,clientId:string,items:WechatItem[],signal?:AbortSignal):Promise<Record<string,unknown>>{
    if (peerId !== credential.ownerId || !contextToken) throw new WechatError("wechat_reply_route_invalid");
    const fields:Record<number,keyof WechatItem>={1:'text_item',2:'image_item',3:'voice_item',4:'file_item',5:'video_item',11:'tool_call_start_item',12:'tool_call_result_item'};
    if(!items.length||items.length>10||items.some(item=>{
      const expected=fields[item.type];
      if(!expected||!item[expected]||Object.values(fields).some(key=>key!==expected&&item[key]!==undefined))return true;
      if(item.type===1&&(!item.text_item?.text||Buffer.byteLength(item.text_item.text)>3500))return true;
      if(item.ref_msg){const id=item.ref_msg.svr_id;if(!id||!/^\d{1,20}$/.test(id)||BigInt(id)>18446744073709551615n)return true;}
      return false;
    }))throw new WechatError('wechat_outgoing_item_invalid');
    return this.request(credential.baseUrl, "ilink/bot/sendmessage", { msg: { from_user_id: "", to_user_id: peerId, client_id: clientId,
      message_type: 2, message_state: 2, context_token: contextToken, item_list: items } }, credential, signal);
  }
  async download(item:WechatItem,signal?:AbortSignal):Promise<{bytes:Buffer;mime:string;kind:MediaKind}>{
    const kind:MediaKind=item.type===2?'image':item.type===3?'voice':item.type===4?'file':'video';
    if(![2,3,4,5].includes(item.type))throw new WechatError('wechat_media_type_denied');
    const media=item.image_item?.media??item.voice_item?.media??item.file_item?.media??item.video_item?.media;
    if(!media)throw new WechatError('wechat_media_reference_missing');
    let url:URL;
    if(media.full_url)url=wechatUrl(media.full_url);
    else if(media.encrypt_query_param){url=new URL('https://novac2c.cdn.weixin.qq.com/c2c/download');url.searchParams.set('encrypted_query_param',media.encrypt_query_param);}
    else throw new WechatError('wechat_media_reference_missing');
    if(url.hostname!=='novac2c.cdn.weixin.qq.com')throw new WechatError('wechat_url_denied');
    const max=mediaLimit(kind),abort=signal?AbortSignal.any([signal,AbortSignal.timeout(MEDIA_POLICY.downloadTimeoutMs)]):AbortSignal.timeout(MEDIA_POLICY.downloadTimeoutMs);
    let response:Response;
    try{response=await this.fetcher(url,{redirect:'error',signal:abort});}catch{throw new WechatError('wechat_media_network_failed');}
    if(!response.ok||!response.body)throw new WechatError('wechat_media_download_failed');
    if(Number(response.headers.get('content-length'))>max+16){await response.body.cancel();throw new WechatError('wechat_media_size_limit');}
    const reader=response.body.getReader(),chunks:Buffer[]=[];let length=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max+16)throw new WechatError('wechat_media_size_limit');chunks.push(Buffer.from(value));}}
    finally{await reader.cancel().catch(()=>{});}
    let bytes=Buffer.concat(chunks),key:Buffer|undefined;
    if(item.image_item?.aeskey){if(!/^[a-fA-F0-9]{32}$/.test(item.image_item.aeskey))throw new WechatError('wechat_media_key_invalid');key=Buffer.from(item.image_item.aeskey,'hex');}
    else if(media.aes_key){
      if(!/^[A-Za-z0-9+/]+={0,2}$/.test(media.aes_key))throw new WechatError('wechat_media_key_invalid');
      const decoded=Buffer.from(media.aes_key,'base64');key=decoded.length===16?decoded:/^[a-fA-F0-9]{32}$/.test(decoded.toString())?Buffer.from(decoded.toString(),'hex'):undefined;
      if(!key)throw new WechatError('wechat_media_key_invalid');
    }
    if(key){try{const d=createDecipheriv('aes-128-ecb',key,null);bytes=Buffer.concat([d.update(bytes),d.final()]);}catch{throw new WechatError('wechat_media_decrypt_failed');}}
    else if(kind!=='image')throw new WechatError('wechat_media_key_missing');
    if(!bytes.length||bytes.length>max)throw new WechatError('wechat_media_size_limit');
    const mime=detectMedia(bytes);
    if(kind==='image'&&!mime.startsWith('image/')||kind==='video'&&!mime.startsWith('video/'))throw new WechatError('wechat_media_type_mismatch');
    const dims=imageDimensions(bytes,mime);if(dims&&(!dims.width||!dims.height||dims.width*dims.height>MEDIA_POLICY.maxPixels))throw new WechatError('wechat_media_pixel_limit');
    return {bytes,mime,kind};
  }
  async getConfig(credential:WechatCredential,contextToken:string,signal?:AbortSignal){return this.request(credential.baseUrl,'ilink/bot/getconfig',{ilink_user_id:credential.ownerId,context_token:contextToken},credential,signal,3000);}
  async sendTyping(credential:WechatCredential,ticket:string,status:1|2,signal?:AbortSignal){return this.request(credential.baseUrl,'ilink/bot/sendtyping',{ilink_user_id:credential.ownerId,typing_ticket:ticket,status},credential,signal,3000);}
  async notify(credential:WechatCredential,state:'start'|'stop',signal?:AbortSignal){return this.request(credential.baseUrl,'ilink/bot/msg/notify'+state,{},credential,signal,2000);}
  async uploadMedia(credential:WechatCredential,filename:string,plaintext:Buffer,kind:MediaKind,signal?:AbortSignal,thumbnail?:WechatThumbnail):Promise<WechatItem>{
    if(!plaintext.length||plaintext.length>mediaLimit(kind)||!filename||filename.length>120||/[\/\\\x00-\x1f]/.test(filename))throw new WechatError('wechat_artifact_denied');
    const mime=detectMedia(plaintext);if(kind==='image'&&!mime.startsWith('image/')||kind==='video'&&!mime.startsWith('video/')||kind==='voice'&&!mime.startsWith('audio/'))throw new WechatError('wechat_media_type_mismatch');
    let duration:number|undefined;
    if(kind==='voice'){
      if(mime!=='audio/silk')throw new WechatError('wechat_voice_encoding_unsupported');
      try{duration=getDuration(plaintext);}catch{throw new WechatError('wechat_voice_encoding_unsupported');}
      if(!duration||duration>60000)throw new WechatError('wechat_voice_duration_limit');
    }
    if(thumbnail){
      const dimensions=imageDimensions(thumbnail.bytes,detectMedia(thumbnail.bytes));
      if(!['image','video'].includes(kind)||!thumbnail.bytes.length||thumbnail.bytes.length>512*1024||!dimensions||dimensions.width!==thumbnail.width||dimensions.height!==thumbnail.height||!Number.isInteger(thumbnail.width)||!Number.isInteger(thumbnail.height)||thumbnail.width<1||thumbnail.height<1||thumbnail.width>320||thumbnail.height>320)throw new WechatError('wechat_thumbnail_invalid');
    }
    const {media,thumbMedia}=await this.uploadBytes(credential,plaintext,{image:1,video:2,file:3,voice:4}[kind],signal,thumbnail?.bytes);
    const encryptedSize=(Math.floor(plaintext.length/16)+1)*16;
    const thumb=thumbnail&&thumbMedia?{thumb_media:thumbMedia,thumb_size:(Math.floor(thumbnail.bytes.length/16)+1)*16,thumb_width:thumbnail.width,thumb_height:thumbnail.height}:{};
    if(kind==='image')return {type:2,image_item:{media,mid_size:encryptedSize,...thumb}};
    if(kind==='video')return {type:5,video_item:{media,video_size:encryptedSize,video_md5:createHash('md5').update(plaintext).digest('hex'),...thumb}};
    if(kind==='voice'){
      return {type:3,voice_item:{media,encode_type:6,bits_per_sample:16,sample_rate:24000,playtime:duration}};
    }
    return {type:4,file_item:{file_name:filename,len:String(plaintext.length),md5:createHash('md5').update(plaintext).digest('hex'),media}};
  }
  private async uploadBytes(credential:WechatCredential,plaintext:Buffer,mediaType:number,signal?:AbortSignal,thumbnail?:Buffer){
    const key=randomBytes(16),filekey=randomBytes(16).toString('hex');
    const encrypt=(bytes:Buffer)=>{const cipher=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([cipher.update(bytes),cipher.final()]);};
    const encrypted=encrypt(plaintext),encryptedThumb=thumbnail?encrypt(thumbnail):undefined;
    const data=await this.request(credential.baseUrl,'ilink/bot/getuploadurl',{filekey,media_type:mediaType,to_user_id:credential.ownerId,rawsize:plaintext.length,rawfilemd5:createHash('md5').update(plaintext).digest('hex'),filesize:encrypted.length,no_need_thumb:!thumbnail,aeskey:key.toString('hex'),...(thumbnail?{thumb_rawsize:thumbnail.length,thumb_rawfilemd5:createHash('md5').update(thumbnail).digest('hex'),thumb_filesize:encryptedThumb!.length}:{})},credential,signal);
    if(thumbnail&&(typeof data.thumb_upload_param!=='string'||!data.thumb_upload_param))throw new WechatError('wechat_thumbnail_upload_unavailable');
    const upload=async(bytes:Buffer,param:unknown,full?:unknown):Promise<WechatMedia>=>{
      let url:URL;
      if(typeof full==='string'&&full)url=wechatUrl(full);
      else if(typeof param==='string'&&param){url=new URL('https://novac2c.cdn.weixin.qq.com/c2c/upload');url.search=new URLSearchParams({encrypted_query_param:param,filekey}).toString();}
      else throw new WechatError('wechat_upload_url_missing');
      if(url.hostname!=='novac2c.cdn.weixin.qq.com')throw new WechatError('wechat_url_denied');
      let response:Response;try{response=await this.fetcher(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(bytes),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{throw new WechatError('wechat_upload_unconfirmed');}
      const receipt=response.headers.get('x-encrypted-param');if(response.status!==200||!receipt)throw new WechatError('wechat_upload_unconfirmed');
      return {encrypt_query_param:receipt,aes_key:Buffer.from(key.toString('hex')).toString('base64'),encrypt_type:1};
    };
    const media=await upload(encrypted,data.upload_param,data.upload_full_url);
    const thumbMedia=encryptedThumb?await upload(encryptedThumb,data.thumb_upload_param):undefined;
    return {media,thumbMedia};
  }
  async uploadMarkdown(credential: WechatCredential, filename: string, content: string | Uint8Array, signal?: AbortSignal): Promise<WechatItem & {file_item:{file_name:string;len:string;media:{encrypt_query_param:string;aes_key:string;encrypt_type:number}}}> {
    const plaintext = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
    if (!/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]{0,99}\.md$/u.test(filename) || !isUtf8(plaintext) || !plaintext.toString("utf8").trim() || plaintext.length > 128 * 1024)
      throw new WechatError("wechat_artifact_denied");
    const key = randomBytes(16), filekey = randomBytes(16).toString("hex");
    const cipher = createCipheriv("aes-128-ecb", key, null);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const data = await this.request(credential.baseUrl, "ilink/bot/getuploadurl", {
      filekey, media_type: 3, to_user_id: credential.ownerId, rawsize: plaintext.length,
      rawfilemd5: createHash("md5").update(plaintext).digest("hex"), filesize: encrypted.length,
      no_need_thumb: true, aeskey: key.toString("hex"),
    }, credential, signal);
    let url: URL;
    if (typeof data.upload_full_url === "string" && data.upload_full_url) url = wechatUrl(data.upload_full_url);
    else if (typeof data.upload_param === "string" && data.upload_param) {
      url = new URL("https://novac2c.cdn.weixin.qq.com/c2c/upload");
      url.search = new URLSearchParams({ encrypted_query_param: data.upload_param, filekey }).toString();
    } else throw new WechatError("wechat_upload_url_missing");
    let response: Response;
    try { response = await this.fetcher(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(encrypted), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }); }
    catch { throw new WechatError("wechat_upload_unconfirmed"); }
    const param = response.headers.get("x-encrypted-param");
    if (response.status !== 200 || !param) throw new WechatError("wechat_upload_unconfirmed");
    return { type: 4, file_item: { file_name: filename, len: String(plaintext.length), media: {
      encrypt_query_param: param, aes_key: Buffer.from(key.toString("hex")).toString("base64"), encrypt_type: 1,
    } } };
  }
}
