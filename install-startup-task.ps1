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
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 0) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$runAsUser = (& whoami).Trim()
if ([string]::IsNullOrWhiteSpace($runAsUser)) {
    throw 'Cannot determine the current Windows account with whoami.'
}
$runAsPassword = Read-Host -Prompt "Enter the Windows password for $runAsUser" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($runAsPassword)
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    Register-ScheduledTask -TaskName 'MamMi Print Agent' -Action $action -Trigger $trigger -Settings $settings -User $runAsUser -Password $plainPassword -RunLevel Highest -Force
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
}
Start-ScheduledTask -TaskName 'MamMi Print Agent'
Write-Host 'MamMi Print Agent startup task installed.'
Write-Host 'MamMi Print Agent started.'
