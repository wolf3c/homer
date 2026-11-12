export interface WindowsWakeEvent {id:string;at:number}
export interface WindowsWakeStatus {supported:boolean;authorization:'required'|'authorized'|'denied'|'unavailable';reason?:string}
export interface WindowsWakeOptions {bundle:string;resources:string;profile:string;instanceId:string;onWake:()=>void|Promise<void>}
export function createWindowsWakeAdapter(options:WindowsWakeOptions):{
 status():Promise<WindowsWakeStatus>;
 authorize():Promise<WindowsWakeStatus>;
 list():Promise<WindowsWakeEvent[]>;
 schedule(event:WindowsWakeEvent):Promise<WindowsWakeEvent>;
 cancel(event:WindowsWakeEvent):Promise<void>;
 close():Promise<void>;
};
