// WebRTC already provides ordering/reliability. This bounds one Homer packet's size.
export const MOBILE_PACKET_BYTES=16*1024*1024;
const chunkBytes=16*1024;
export type MobileChannelPort={send:(data:Uint8Array)=>void;buffered:()=>number;closed:()=>boolean;close:()=>void;receive:(fn:(data:Uint8Array)=>void)=>void};
export function mobileChannel(port:MobileChannelPort,deliver:(value:unknown)=>void){
 let body:Uint8Array|undefined,offset=0,closed=false,queued=0,tail=Promise.resolve();
 const close=()=>{if(closed)return;closed=true;body=undefined;port.close();};
 port.receive(frame=>{
  if(closed)return;
  try{
   if(!body){
    if(frame.byteLength!==4)throw Error('mobile_frame_invalid');
    const size=new DataView(frame.buffer,frame.byteOffset,4).getUint32(0);
    if(size<1||size>MOBILE_PACKET_BYTES)throw Error('mobile_packet_size_limit');
    body=new Uint8Array(size);offset=0;return;
   }
   if(!frame.byteLength||frame.byteLength>chunkBytes||offset+frame.byteLength>body.byteLength)throw Error('mobile_frame_invalid');
   body.set(frame,offset);offset+=frame.byteLength;
   if(offset===body.byteLength){const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));body=undefined;deliver(value);}
  }catch{close();}
 });
 return {close,send(value:unknown):Promise<void>{
  if(closed||port.closed())return Promise.reject(Error('mobile_channel_unavailable'));
  // At most the session's eight concurrent replies; encode only the active one.
  if(queued>=8)return Promise.reject(Error('mobile_request_busy'));
  const packet=JSON.stringify(value);
  queued++;
  const work=tail.then(async()=>{
   const bytes=new TextEncoder().encode(packet);
   if(!bytes.length||bytes.length>MOBILE_PACKET_BYTES)throw Error('mobile_packet_size_limit');
   const header=new Uint8Array(4);new DataView(header.buffer).setUint32(0,bytes.length);
   const started=Date.now();
   const write=async(frame:Uint8Array)=>{
    while(port.buffered()>64*1024){if(closed||port.closed()||Date.now()-started>10000)throw Error('mobile_channel_unavailable');await new Promise(resolve=>setTimeout(resolve,5));}
    if(closed||port.closed())throw Error('mobile_channel_unavailable');port.send(frame);
   };
   await write(header);for(let at=0;at<bytes.length;at+=chunkBytes)await write(bytes.subarray(at,at+chunkBytes));
  }).finally(()=>{queued--;});
  tail=work.catch(()=>{close();});return work;
 }};
}
