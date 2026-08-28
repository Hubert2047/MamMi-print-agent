$ErrorActionPreference = 'Stop'
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$standalone = Join-Path $agentRoot 'mammi-print-agent.exe'
if (Test-Path $standalone) {
    $action = New-ScheduledTaskAction -Execute $standalone -WorkingDirectory $agentRoot
} else {
    $node = (Get-Command node.exe).Source
    $action = New-ScheduledTaskAction -Execute $node -Argument "`"$agentRoot\src\index.mjs`"" -WorkingDirectory $agentRoot
}
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'MamMi Print Agent' -Action $action -Trigger $trigger -Principal $principal -Force
Write-Host 'MamMi Print Agent startup task installed.'
