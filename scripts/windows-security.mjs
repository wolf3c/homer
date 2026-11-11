import {execFile,execFileSync} from 'node:child_process';
import {win32} from 'node:path';
import {promisify} from 'node:util';

function windowsInvocation(command,values,timeout){
 const root=process.env.SystemRoot;
 if(!root||!win32.isAbsolute(root))throw Error('windows_security_unavailable');
 return [win32.join(root,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "+command],{encoding:'utf8',timeout,maxBuffer:1024*1024,windowsHide:true,env:{SystemRoot:root,...values}}];
}
export function windowsCommand(command,values={}){
 const [file,args,options]=windowsInvocation(command,values,20000);
 return execFileSync(file,args,{...options,stdio:['ignore','pipe','pipe']}).trim();
}
export async function windowsCommandAsync(command,values){
 return (await promisify(execFile)(...windowsInvocation(command,values,5000))).stdout.trim();
}
export function assertWindowsPrivate(path){
 const result=windowsCommand("$u=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $a=Get-Acl -LiteralPath $env:HOMER_PRIVATE_PATH; $owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value; $bad=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($u,'S-1-5-18','S-1-5-32-544')}); if($owner -ne $u -or $bad.Count -gt 0){throw 'private_acl_required'}; 'private'",{HOMER_PRIVATE_PATH:path});
 if(result!=='private')throw Error('windows_private_acl_required');
}
export function secureWindowsDirectory(path){
 windowsCommand("$u=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a=New-Object Security.AccessControl.DirectorySecurity; $a.SetOwner($u); $a.SetAccessRuleProtection($true,$false); $r=New-Object Security.AccessControl.FileSystemAccessRule($u,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $a.AddAccessRule($r); Set-Acl -LiteralPath $env:HOMER_PRIVATE_PATH -AclObject $a",{HOMER_PRIVATE_PATH:path});
 assertWindowsPrivate(path);
}
