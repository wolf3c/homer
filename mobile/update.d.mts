export type ReleaseIdentity={platform:string;channel:string|undefined;applicationId:string|null;development:boolean;version:string|null;build:string|null;apiLevel?:number;abis?:string[]|null;osVersion?:string|null;storeEnvironment?:string|null;storefront?:string|null};
export type MobileUpdate={version:string;identifier:string};
export const downloadPage:string;
export function compareVersions(a:unknown,b:unknown):number|null;
export function releaseEnabled(local:ReleaseIdentity):boolean;
export function availableUpdate(data:unknown,local:ReleaseIdentity,dismissed:string|null):MobileUpdate|null;
export function fetchRelease():Promise<unknown>;
