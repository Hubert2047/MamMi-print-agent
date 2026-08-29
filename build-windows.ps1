$ErrorActionPreference = 'Stop'

$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $agentRoot 'dist'
Set-Location $agentRoot

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

Write-Host 'Bundling MamMi Print Agent...'
npx --no-install esbuild src/index.mjs --bundle --platform=node --format=cjs --outfile=dist/index.cjs
if ($LASTEXITCODE -ne 0) { throw 'Bundling failed.' }

Write-Host 'Creating Windows executable...'
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw 'SEA blob creation failed.' }

$nodePath = (Get-Command node.exe).Source
Copy-Item $nodePath (Join-Path $dist 'mammi-print-agent.exe') -Force

$sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
npx --no-install postject (Join-Path $dist 'mammi-print-agent.exe') NODE_SEA_BLOB (Join-Path $dist 'mammi-print-agent.blob') --sentinel-fuse $sentinelFuse
if ($LASTEXITCODE -ne 0) { throw 'Injecting the SEA blob into the Windows executable failed.' }

Remove-Item (Join-Path $dist 'index.cjs'), (Join-Path $dist 'mammi-print-agent.blob') -Force

Write-Host ''
Write-Host "Built: $(Join-Path $dist 'mammi-print-agent.exe')"
Write-Host 'Copy this executable next to a production .env file on Windows.'
