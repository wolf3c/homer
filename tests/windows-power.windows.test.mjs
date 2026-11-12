// Explicit Windows contract check: real ScheduledTasks constructors, in-memory registration only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {test} from 'node:test';

const fixture=String.raw`
Microsoft.PowerShell.Core\Import-Module (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks\ScheduledTasks.psd1')
$global:FakeWakeTasks = @{}
function global:Import-Module { [CmdletBinding()] param($Name) if ([IO.Path]::GetFileName($Name) -ne 'ScheduledTasks.psd1') { throw 'unexpected_module' } }
function global:Get-ScheduledTask {
    [CmdletBinding()] param($TaskPath,$TaskName)
    if ($TaskPath -cne '\' -or $TaskName -cnotmatch '^Homer-Wake-v1-[a-f0-9]{16}-[a-f0-9]{64}-\*$') { throw 'unscoped_query' }
    @($global:FakeWakeTasks.Values | Where-Object { $_.TaskPath -ceq $TaskPath -and $_.TaskName -clike $TaskName })
}
function global:Register-ScheduledTask {
    [CmdletBinding()] param($TaskPath,$TaskName,$Action,$Trigger,$Principal,$Settings,$Description)
    if ($global:FakeWakeTasks.ContainsKey($TaskName)) { throw 'unexpected_overwrite' }
    $task = New-ScheduledTask -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description $Description
    $task.TaskPath = $TaskPath; $task.TaskName = $TaskName
    $global:FakeWakeTasks[$TaskName] = $task
}
function global:Unregister-ScheduledTask {
    [CmdletBinding()] param($TaskPath,$TaskName,[switch]$Confirm)
    if ($TaskPath -cne '\' -or !$global:FakeWakeTasks.ContainsKey($TaskName)) { throw 'unowned_delete' }
    $global:FakeWakeTasks.Remove($TaskName)
}
`;

test('Windows PowerShell bridge reads exact real task objects and rejects disabled wake requests',{timeout:30000},()=>{
 assert.equal(process.platform,'win32','explicit Windows PowerShell/ScheduledTasks test; no Mac substitute');
 const root=resolve('.codex/scratch/windows-power-contract');mkdirSync(root,{recursive:true});const directory=mkdtempSync(join(root,'case-'));
 try{
  const bundle=join(directory,'bundle'),resources=join(bundle,'resources'),profile=join(directory,'profile');
  mkdirSync(join(resources,'homer/scripts'),{recursive:true});mkdirSync(profile);
  writeFileSync(join(resources,'node.exe'),'');writeFileSync(join(resources,'homer/scripts/desktop-wake.mjs'),'');
  const instanceId='a'.repeat(64),session='b'.repeat(32),first={id:'1'.repeat(32),at:Math.ceil((Date.now()+120000)/1000)*1000},second={id:'2'.repeat(32),at:first.at+60000};
  const request=(operation,event=null,taskSession=session)=>({format:1,bundle,resources,profile,instanceId,operation,session:taskSession,event});
  const cases=[
   {request:request('status')},{request:request('schedule',first)},{request:request('schedule',second)},
   {request:request('cancel',{...first,at:first.at+1000},null)},{request:request('cancel',first,null)},
   {request:request('clear',null,'c'.repeat(32))},{request:request('list'),disable:true},
   {request:request('clear')},{request:request('list')}
  ];
  const script=fixture+'\n$cases = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HOMER_POWER_CASES)) | ConvertFrom-Json\nforeach ($case in $cases) {\n'+
   'if ($case.disable) { foreach ($task in $global:FakeWakeTasks.Values) { $task.Settings.Enabled = $false } }\n'+
   '$env:HOMER_WAKE_REQUEST = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($case.request | ConvertTo-Json -Depth 5 -Compress)))\n'+
   '$result = & {\n'+readFileSync(new URL('../packaging/windows/power-task.ps1',import.meta.url),'utf8')+'\n}\n'+
   '@{ reply = ($result | ConvertFrom-Json); count = $global:FakeWakeTasks.Count } | ConvertTo-Json -Depth 6 -Compress\n}';
  const stdout=execFileSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
   encoding:'utf8',timeout:25000,maxBuffer:65536,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,HOMER_POWER_CASES:Buffer.from(JSON.stringify(cases)).toString('base64')}
  });
  const replies=stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  assert.equal(replies.length,9);assert.deepEqual(replies.map(row=>row.count),[0,1,2,2,1,1,1,0,0]);
  assert.deepEqual(replies.slice(0,6).map(row=>row.reply.ok),[true,true,true,true,true,true]);
  assert.deepEqual(replies[2].reply.events.map(({id,at})=>({id,at})).sort((a,b)=>a.at-b.at),[first,second]);
  assert.deepEqual(replies[6].reply,{ok:false,error:'ownership_unconfirmed'});
  assert.deepEqual(replies[8].reply.events,[]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
