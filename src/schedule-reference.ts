export type ScheduleReference={scheduleId:string;label:string};

export const isScheduleId=(id:unknown):id is string=>typeof id==='string'&&/^schedule-[a-f0-9-]{36}$/.test(id);

function schedulePrefix({scheduleId,label}:ScheduleReference){
 return '用户选择的定时任务：'+JSON.stringify({scheduleId,label})+'\n\n';
}

export function scheduleMessageText(text:string,reference?:ScheduleReference){
 return reference?schedulePrefix(reference)+text:text;
}

// The caller must supply the separately recorded reference. Old text alone is
// never evidence of a selection made in the schedule list.
export function scheduleMessageBody(text:string,reference?:ScheduleReference){
 if(!reference)return;
 const prefix=schedulePrefix(reference);
 if(text.startsWith(prefix))return text.slice(prefix.length);
}
