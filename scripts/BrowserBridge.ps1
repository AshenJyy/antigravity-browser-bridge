[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$BridgeArguments = @('status'))
$ErrorActionPreference = 'Stop'
$bridgeRoot = Split-Path -Parent $PSScriptRoot
$candidates = @((Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $candidates += $nodeCommand.Source }
$nodePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $nodePath) { throw 'Node.js 22+ was not found. Install Node.js or start DSH Desktop once to provision its runtime.' }
$major = [int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Browser Bridge requires Node.js 22 or later.' }
$entry = Join-Path $bridgeRoot 'runtime\cli.mjs'
if (-not (Test-Path -LiteralPath $entry)) { $entry = Join-Path $bridgeRoot 'scripts\cli.mjs' }
& $nodePath $entry @BridgeArguments
exit $LASTEXITCODE
