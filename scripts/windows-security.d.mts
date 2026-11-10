export function windowsCommand(command:string,values?:Record<string,string>):string;
export function windowsCommandAsync(command:string,values?:Record<string,string>):Promise<string>;
export function assertWindowsPrivate(path:string):void;
export function secureWindowsDirectory(path:string):void;
