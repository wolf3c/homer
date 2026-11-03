export const LOCAL_ORIGIN:string;
export type Pairing={signalOrigin:string;routeId:string;invitation?:string;credential?:string};
export type ConnectionStatus='restoring'|'restore-error'|'scan'|'connecting'|'pending'|'active'|'denied'|'version'|'unavailable'|'invitation-expired'|'approval-timeout'|'pairing-busy'|'saving'|'save-error'|'cancelling'|'cancel-error'|'cancel-approved'|'cancel-manual';
export function connectionScreen(status:ConnectionStatus,wasConnected:boolean):'loading'|'welcome'|'chat'|'restore-error'|'connecting'|'pending'|'denied'|'version'|'unavailable'|'invitation-expired'|'approval-timeout'|'pairing-busy'|'saving'|'save-error'|'cancelling'|'cancel-error'|'cancel-approved'|'cancel-manual';
export function pairingAddress(value:string):Pairing;
export function savedPairing(value:string):Pairing;
export function navigation(value:string,origin:string,topFrame?:boolean):'internal'|'external'|'blocked';
export function downloadMessage(value:string,origin:string,url:string):{filename:string;base64:string};
