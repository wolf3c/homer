# Fixed Task Scheduler bridge. Input is JSON data; no caller supplies PowerShell.
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Fail($code) { throw $code }
function ValidPath($value) {
    return $value -is [string] -and $value -cmatch '^[A-Za-z]:\\' -and $value -notmatch '[<>"|?*\x00-\x1f]' -and $value.Substring(2) -notmatch ':' -and [IO.Path]::GetFullPath($value) -ceq $value
}
function ValidEvent($event) {
    return $null -ne $event -and $event.id -is [string] -and $event.id -cmatch '^[a-f0-9]{32}$' -and ($event.at -is [long] -or $event.at -is [int]) -and $event.at -gt 0 -and $event.at -le 253402300499000 -and $event.at % 1000 -eq 0 -and @($event.PSObject.Properties.Name | Where-Object { $_ -notin @('id','at') }).Count -eq 0
}
function Quote($value) { return '"' + $value + '"' }
function PrincipalSid($principal) {
    if ($principal.UserId -match '^S-1-') { return $principal.UserId }
    return ([Security.Principal.NTAccount]::new($principal.UserId)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function OwnTasks([bool]$requireActive = $true) {
    $readErrors = @()
    $tasks = @(Get-ScheduledTask -TaskPath '\' -TaskName ($prefix + '-*') -ErrorAction SilentlyContinue -ErrorVariable readErrors)
    foreach ($issue in $readErrors) { if ($issue.FullyQualifiedErrorId -notlike 'CmdletizationQuery_NotFound_TaskName*') { throw $issue } }
    $rows = @()
    foreach ($task in $tasks) {
        if ($task.TaskPath -cne '\' -or $task.TaskName -cnotmatch ('^' + [regex]::Escape($prefix) + '-([a-f0-9]{32})-([a-f0-9]{32})$')) { Fail 'ownership_unconfirmed' }
        $taskSession = $Matches[1]; $id = $Matches[2]
        if ($task.Description -cnotmatch ('^Homer desktop wake v1 ' + $request.instanceId + ' ' + $taskSession + ' ' + $id + ' ([0-9]{1,15})$')) { Fail 'ownership_unconfirmed' }
        $at = [long]$Matches[1]
        if (@($task.Actions).Count -ne 1 -or @($task.Triggers).Count -ne 1) { Fail 'ownership_unconfirmed' }
        $action = $task.Actions[0]; $trigger = $task.Triggers[0]
        $node = [string]$action.Execute
        if (!(ValidPath $node) -or [IO.Path]::GetFileName($node) -cne 'node.exe') { Fail 'ownership_unconfirmed' }
        $entry = Join-Path ([IO.Path]::GetDirectoryName($node)) 'homer\scripts\desktop-wake.mjs'
        $arguments = (Quote $entry) + ' wake ' + $request.instanceId + ' ' + $taskSession
        if ($action.Arguments -cne $arguments -or $action.WorkingDirectory -cne [IO.Path]::GetDirectoryName($node)) { Fail 'ownership_unconfirmed' }
        if ((PrincipalSid $task.Principal) -cne $sid -or [string]$task.Principal.LogonType -notin @('Interactive','3') -or [string]$task.Principal.RunLevel -notin @('Limited','0')) { Fail 'ownership_unconfirmed' }
        if ($requireActive -and (!$task.Settings.Enabled -or !$trigger.Enabled)) { Fail 'ownership_unconfirmed' }
        if (!$task.Settings.WakeToRun -or $task.Settings.StartWhenAvailable -or $task.Settings.ExecutionTimeLimit -ne 'PT30S' -or $trigger.CimClass.CimClassName -cne 'MSFT_TaskTimeTrigger' -or $trigger.Repetition.Interval) { Fail 'ownership_unconfirmed' }
        $start = [DateTimeOffset]::Parse($trigger.StartBoundary,[Globalization.CultureInfo]::InvariantCulture)
        $end = [DateTimeOffset]::Parse($trigger.EndBoundary,[Globalization.CultureInfo]::InvariantCulture)
        if ($start.ToUnixTimeMilliseconds() -ne $at -or $end.ToUnixTimeMilliseconds() -ne ($at + 300000) -or $task.Settings.DeleteExpiredTaskAfter -ne 'PT1H') { Fail 'ownership_unconfirmed' }
        $rows += @{ task = $task; event = @{ id = $id; at = $at; session = $taskSession } }
    }
    return $rows
}

try {
    $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HOMER_WAKE_REQUEST)) | ConvertFrom-Json
    if ($request.format -ne 1 -or $request.operation -notin @('status','list','schedule','cancel','clear') -or $request.instanceId -isnot [string] -or $request.instanceId -cnotmatch '^[a-f0-9]{64}$' -or @($request.PSObject.Properties.Name | Where-Object { $_ -notin @('format','operation','instanceId','bundle','resources','profile','session','event') }).Count) { Fail 'context_invalid' }
    if (!(ValidPath $request.bundle) -or !(ValidPath $request.resources) -or !(ValidPath $request.profile) -or $request.resources -cne (Join-Path $request.bundle 'resources')) { Fail 'context_invalid' }
    if ($null -ne $request.session -and ($request.session -isnot [string] -or $request.session -cnotmatch '^[a-f0-9]{32}$')) { Fail 'context_invalid' }
    if ($request.operation -in @('schedule','clear') -and $null -eq $request.session) { Fail 'context_invalid' }
    if ($request.operation -in @('schedule','cancel') -and !(ValidEvent $request.event)) { Fail 'event_invalid' }
    $module = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\ScheduledTasks\ScheduledTasks.psd1'
    Import-Module -Name $module -ErrorAction Stop
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $userHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sid))).Replace('-','').ToLowerInvariant().Substring(0,16) } finally { $sha.Dispose() }
    $prefix = 'Homer-Wake-v1-' + $userHash + '-' + $request.instanceId
    $rows = @(OwnTasks ($request.operation -notin @('cancel','clear')))
    if ($request.operation -eq 'schedule') {
        if ($request.event.at -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) { Fail 'event_invalid' }
        $name = $prefix + '-' + $request.session + '-' + $request.event.id
        $existing = @($rows | Where-Object { $_.task.TaskName -ceq $name })
        if ($existing.Count -and $existing[0].event.at -ne $request.event.at) { Fail 'conflict' }
        if (!$existing.Count) {
            $instant = [DateTimeOffset]::FromUnixTimeMilliseconds($request.event.at)
            $trigger = New-ScheduledTaskTrigger -Once -At $instant.UtcDateTime
            $trigger.StartBoundary = $instant.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",[Globalization.CultureInfo]::InvariantCulture)
            $trigger.EndBoundary = $instant.AddMinutes(5).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",[Globalization.CultureInfo]::InvariantCulture)
            $node = Join-Path $request.resources 'node.exe'; $entry = Join-Path $request.resources 'homer\scripts\desktop-wake.mjs'
            if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $entry -PathType Leaf)) { Fail 'unavailable' }
            $action = New-ScheduledTaskAction -Execute $node -Argument ((Quote $entry) + ' wake ' + $request.instanceId + ' ' + $request.session) -WorkingDirectory $request.resources
            $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
            $settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 30) -DeleteExpiredTaskAfter (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -DisallowDemandStart -Compatibility Win8
            Register-ScheduledTask -TaskPath '\' -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ('Homer desktop wake v1 ' + $request.instanceId + ' ' + $request.session + ' ' + $request.event.id + ' ' + $request.event.at) -ErrorAction Stop | Out-Null
            $rows = @(OwnTasks)
        }
    }
    if ($request.operation -in @('cancel','clear')) {
        $remove = @($rows | Where-Object { if ($request.operation -eq 'clear') { $_.event.session -ceq $request.session } else { $_.event.id -ceq $request.event.id -and $_.event.at -eq $request.event.at } })
        foreach ($row in $remove) { Unregister-ScheduledTask -TaskPath '\' -TaskName $row.task.TaskName -Confirm:$false -ErrorAction Stop }
        $rows = @(OwnTasks $false)
        if (@($rows | Where-Object { if ($request.operation -eq 'clear') { $_.event.session -ceq $request.session } else { $_.event.id -ceq $request.event.id -and $_.event.at -eq $request.event.at } }).Count) { Fail 'cleanup_unconfirmed' }
    }
    @{ ok = $true; instanceId = $request.instanceId; events = @($rows | ForEach-Object { $_.event }) } | ConvertTo-Json -Depth 4 -Compress
} catch {
    $code = 'unavailable'
    if ($_.Exception.Message -in @('context_invalid','event_invalid','ownership_unconfirmed','conflict','cleanup_unconfirmed','unavailable')) { $code = $_.Exception.Message }
    for ($errorObject = $_.Exception; $null -ne $errorObject; $errorObject = $errorObject.InnerException) {
        if ($errorObject -is [UnauthorizedAccessException] -or $errorObject.HResult -eq -2147024891 -or $errorObject.NativeErrorCode -eq 5) { $code = 'denied' }
    }
    @{ ok = $false; error = $code } | ConvertTo-Json -Compress
}
