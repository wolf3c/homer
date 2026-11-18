import {useLayoutEffect,useRef,useState,type RefObject} from 'react';

export function useMainProcessingIndicator(active:boolean,inline:boolean,viewport:RefObject<HTMLDivElement|null>,messageList:RefObject<HTMLDivElement|null>){
  const marker=useRef<HTMLDivElement>(null);
  const sprite=useRef<HTMLImageElement>(null);
  const [queueAnchor,setQueueAnchor]=useState<HTMLSpanElement|null>(null);
  const [docked,setDocked]=useState(false);

  useLayoutEffect(()=>{
    const view=viewport.current,image=sprite.current;
    if(!active||!view||!image)return;
    const composer=queueAnchor?.closest('.composer-area');
    let frame=0,previousDocked:boolean|undefined;

    const update=()=>{
      const viewportBox=view.getBoundingClientRect();
      const slot=marker.current?.getBoundingClientRect();
      const anchor=queueAnchor?.getBoundingClientRect();
      const composerBox=composer?.getBoundingClientRect();
      const target=anchor?.width&&composerBox&&anchor.top>=composerBox.top&&anchor.bottom<=composerBox.bottom?anchor:undefined;
      const size=slot?.width||image.width;
      const visible=slot?Math.max(0,Math.min(slot.bottom,viewportBox.bottom)-Math.max(slot.top,viewportBox.top)):0;
      const progress=target?1-Math.min(1,visible/size):0;
      const ready=image.complete&&image.naturalWidth>0;
      const nextDocked=ready&&!!target&&progress>=.995;
      if(nextDocked!==previousDocked){
        previousDocked=nextDocked;
        setDocked(nextDocked);
      }
      if(!ready||(!visible&&!target)){
        image.style.visibility='hidden';
        return;
      }
      const x=(slot?.left??0)*(1-progress)+(target?.left??0)*progress;
      const y=(slot?.top??0)*(1-progress)+(target?.top??0)*progress;
      const scale=1+((target?.width??size)/size-1)*progress;
      image.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;
      image.style.clipPath=!target&&slot?`inset(${Math.max(0,viewportBox.top-slot.top)}px 0 ${Math.max(0,slot.bottom-viewportBox.bottom)}px)`:'';
      image.style.visibility='visible';
    };

    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
    const resize=new ResizeObserver(schedule);
    resize.observe(view);
    if(messageList.current)resize.observe(messageList.current);
    if(queueAnchor)resize.observe(queueAnchor);
    if(composer)resize.observe(composer);
    view.addEventListener('scroll',schedule,{passive:true});
    composer?.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule);
    image.addEventListener('load',schedule);
    update();
    return ()=>{
      cancelAnimationFrame(frame);
      resize.disconnect();
      view.removeEventListener('scroll',schedule);
      composer?.removeEventListener('scroll',schedule);
      window.removeEventListener('resize',schedule);
      image.removeEventListener('load',schedule);
    };
  },[active,inline,messageList,queueAnchor,viewport]);

  return {marker,sprite,setQueueAnchor,docked:active&&!!queueAnchor&&docked};
}
