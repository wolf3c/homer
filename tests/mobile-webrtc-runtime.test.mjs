import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import rtc from 'node-datachannel';

test('Node WebRTC interoperates with browser API for ordered text and binary without relay', {timeout:20000},async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const peer=new rtc.PeerConnection('mobile-runtime',{iceServers:[],enableIceTcp:false});
 try{
  const page=await browser.newPage();
  peer.onDataChannel(channel=>channel.onMessage(value=>{if(typeof value==='string')channel.sendMessage(value);else channel.sendMessageBinary(new Uint8Array(value));}));
  await page.exposeFunction('answer',offer=>new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('rtc_gather_timeout')),5000);
   peer.onGatheringStateChange(state=>{if(state==='complete'){clearTimeout(timer);resolve(peer.localDescription());}});
   peer.setRemoteDescription(offer.sdp,'offer');
  }));
  const result=await page.evaluate(async()=>{
   const pc=new RTCPeerConnection({iceServers:[]}),channel=pc.createDataChannel('homer');channel.binaryType='arraybuffer';
   try{
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(resolve=>{if(pc.iceGatheringState==='complete')resolve();else pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')resolve();};});
    await pc.setRemoteDescription(await window.answer(pc.localDescription.toJSON()));
    await new Promise((resolve,reject)=>{channel.onopen=resolve;channel.onerror=reject;});
    const echo=value=>new Promise(resolve=>{channel.onmessage=event=>resolve(event.data);channel.send(value);});
    const text=await echo('synthetic-chat'),bytes=new Uint8Array(16384);for(let n=0;n<bytes.length;n++)bytes[n]=n%251;
    const returned=new Uint8Array(await echo(bytes));
    const stats=await pc.getStats();const candidates=[];for(const report of stats.values())if(report.type==='transport'&&report.selectedCandidatePairId){const pair=stats.get(report.selectedCandidatePairId);candidates.push(stats.get(pair.localCandidateId).candidateType,stats.get(pair.remoteCandidateId).candidateType);}
    return {text,binary:returned.length===bytes.length&&returned.every((v,n)=>v===bytes[n]),candidates};
   }finally{channel.close();pc.close();}
  });
  assert.equal(result.text,'synthetic-chat');assert.equal(result.binary,true);assert.equal(result.candidates.length,2);assert.ok(result.candidates.every(type=>type!=='relay'));
 }finally{peer.close();await browser.close();rtc.cleanup();}
});
