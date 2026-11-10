export type TelegramContextMessage={id:number;replyTo?:number;text?:string;author?:string};

export async function telegramReplyContext(
  recent:readonly TelegramContextMessage[],trigger:TelegramContextMessage,quote:TelegramContextMessage|undefined,
  read:(id:number)=>Promise<TelegramContextMessage|undefined>,
){
  const context=new Map(recent.filter(message=>message.id<trigger.id).slice(-10).map(message=>[message.id,message]));
  let child=trigger;
  // Bound the work for exceptionally long chains.
  for(let depth=0;depth<16;depth++){
    const id=child.replyTo;
    if(!id||!Number.isSafeInteger(id)||id<1||id>=child.id)break;
    const direct=quote?.id===id?quote:undefined;
    const found=context.get(id)??await read(id).catch(()=>undefined);
    const parent=found?.id===id?found:direct;
    if(!parent)break;
    context.set(id,direct?.text!==undefined?{...parent,text:direct.text}:parent);
    child=parent;
  }
  return [...context.values()].filter(message=>message.text?.trim()).sort((a,b)=>a.id-b.id);
}
