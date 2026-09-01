$ErrorActionPreference = 'Stop'

# ===== SSH CONFIGURATION =====
$sshUser = 'hp'
$sshHost = '100.78.69.25'
$remoteDirectory = 'C:/Users/HP/app/print-agent'

# Optional: set the path to your private key, or leave empty to use the default SSH key.
$sshKey = ''

$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localFile = Join-Path $agentRoot 'dist\mammi-print-agent.exe'
$installScript = Join-Path $agentRoot 'install-startup-task.ps1'

if (-not (Test-Path -LiteralPath $localFile)) {
    throw "File not found: $localFile. Run npm run build:windows first."
}
if (-not (Test-Path -LiteralPath $installScript)) {
    throw "File not found: $installScript."
}

$missingConfiguration = (
    [string]::IsNullOrWhiteSpace($sshUser) -or
    [string]::IsNullOrWhiteSpace($sshHost) -or
    [string]::IsNullOrWhiteSpace($remoteDirectory) -or
    $sshUser -eq 'YOUR_SSH_USER' -or
    $sshHost -eq 'YOUR_SERVER_IP_OR_HOSTNAME' -or
    $remoteDirectory -eq '/path/to/remote/folder/'
)

if ($missingConfiguration) {
    throw 'Fill in $sshUser, $sshHost, and $remoteDirectory at the top of this script first.'
}

$scpArguments = @()
if ($sshKey.Trim()) {
    $scpArguments += @('-i', $sshKey)
}
$scpArguments += @($localFile, $installScript, "${sshUser}@${sshHost}:$remoteDirectory")

Write-Host "Uploading $localFile to ${sshUser}@${sshHost}:$remoteDirectory ..."
& scp @scpArguments
if ($LASTEXITCODE -ne 0) {
    throw "Upload failed with exit code $LASTEXITCODE."
}

Write-Host 'Upload completed successfully.'
