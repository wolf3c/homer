export type MacWakeEvent={id:string;at:number};
export type MacWakeStatus={supported:boolean;authorization:'required'|'authorized'|'denied'|'unavailable';reason?:string};
export function createMacWakeAdapter(options:{bundle:string;resources:string;profile?:string;instanceId:string;onWake?:()=>void}):{
 status():Promise<MacWakeStatus>;
 authorize():Promise<MacWakeStatus>;
 list():Promise<MacWakeEvent[]>;
 schedule(event:MacWakeEvent):Promise<MacWakeEvent>;
 cancel(event:MacWakeEvent):Promise<void>;
 close():Promise<void>;
 prepareUpdate():Promise<void>;
};
