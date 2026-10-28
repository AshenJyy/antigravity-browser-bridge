[CmdletBinding()]
param([switch]$HideToken)
$ErrorActionPreference = 'Stop'
$bridgeRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$installedRoot = Join-Path $env:USERPROFILE '.gemini\config\plugins\browser-bridge'
foreach ($root in @($bridgeRoot, $installedRoot)) {
    $localConfigPath = Join-Path $root 'mcp_config.json'
    if (-not (Test-Path -LiteralPath $localConfigPath)) { continue }
    $serverEnv = (Get-Content -LiteralPath $localConfigPath -Raw | ConvertFrom-Json).mcpServers.'browser-bridge'.env
    foreach ($key in @('BROWSER_BRIDGE_DATA_DIR', 'BROWSER_BRIDGE_PORT')) {
        if (-not [Environment]::GetEnvironmentVariable($key) -and $serverEnv.$key) {
            [Environment]::SetEnvironmentVariable($key, [string]$serverEnv.$key, 'Process')
        }
    }
}
$port = if ($env:BROWSER_BRIDGE_PORT) { [int]$env:BROWSER_BRIDGE_PORT } else { 9224 }
$dataDirectory = if ($env:BROWSER_BRIDGE_DATA_DIR) { [IO.Path]::GetFullPath($env:BROWSER_BRIDGE_DATA_DIR) } else { Join-Path $env:USERPROFILE '.browser-bridge' }
if ($port -lt 1024 -or $port -gt 65535) { throw 'The bridge port must be between 1024 and 65535.' }
$nodeCandidates = @((Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'))
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
$nodePath = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $nodePath) { throw 'Node.js is missing. Start DSH Desktop once to provision its Node runtime.' }
$cliPath = Join-Path $bridgeRoot 'runtime\cli.mjs'
if (-not (Test-Path -LiteralPath $cliPath)) { throw 'Bundled runtime is missing. Use the current Browser Bridge release.' }

# Only the exact entry point of this project or its installed copy may be stopped.
$knownEntries = @()
foreach ($root in @($bridgeRoot, $installedRoot, (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\node_modules\dsh-browser-bridge'))) {
    foreach ($relative in @('runtime\service.mjs', 'core\service.mjs', 'server\server.py')) {
        $knownEntries += [IO.Path]::GetFullPath((Join-Path $root $relative))
    }
}
$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
$processesToStop = @()
foreach ($processId in @($listeners.OwningProcess | Sort-Object -Unique)) {
    if (-not $processId) { continue }
    $owner = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $processId)
    $scriptPath = $null
    if ($owner.CommandLine -match '^\s*(?:"[^"]+"|\S+)\s+(?:"(?<script>[^"]+)"|(?<script>\S+))(?:\s|$)') {
        try { $scriptPath = [IO.Path]::GetFullPath($Matches.script) } catch {}
    }
    if ($owner.Name -notin @('node.exe', 'python.exe', 'pythonw.exe') -or -not $scriptPath -or $knownEntries -notcontains $scriptPath) {
        throw "Port $port belongs to an unrelated or unrecognized process (PID $processId, $($owner.Name)); it has not been stopped."
    }
    $processesToStop += $owner
}

# Keep the App on the same data directory as the native DSH plugin and CLI.
$mcpPath = Join-Path $installedRoot 'mcp_config.json'
if (Test-Path -LiteralPath $mcpPath) {
    $configuration = Get-Content -LiteralPath $mcpPath -Raw | ConvertFrom-Json
    $entry = $configuration.mcpServers.'browser-bridge'
    if (-not $entry) { throw 'The installed MCP config does not contain browser-bridge.' }
    if (-not $entry.env) { $entry | Add-Member -NotePropertyName env -NotePropertyValue ([PSCustomObject]@{}) -Force }
    $entry.env | Add-Member -NotePropertyName BROWSER_BRIDGE_PORT -NotePropertyValue ([string]$port) -Force
    $entry.env | Add-Member -NotePropertyName BROWSER_BRIDGE_DATA_DIR -NotePropertyValue $dataDirectory -Force
    $entry.command = $nodePath
    $backupDirectory = Join-Path $dataDirectory 'config-backups'
    New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
    Copy-Item -LiteralPath $mcpPath -Destination (Join-Path $backupDirectory ('mcp-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.json'))
    [IO.File]::WriteAllText($mcpPath, ($configuration | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
}

foreach ($owner in $processesToStop) {
    $current = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $owner.ProcessId) -ErrorAction SilentlyContinue
    if ($current -and $current.CommandLine -eq $owner.CommandLine -and $current.CreationDate -eq $owner.CreationDate) {
        Stop-Process -Id $owner.ProcessId
        Wait-Process -Id $owner.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
    }
}
$env:BROWSER_BRIDGE_PORT = [string]$port
$env:BROWSER_BRIDGE_DATA_DIR = $dataDirectory
# The pair command creates a token only if missing, and starts the real service.
$rawPairing = & $nodePath $cliPath pair
if ($LASTEXITCODE -ne 0) { throw 'Browser Bridge pairing initialization failed; see the error above.' }
$pairing = $rawPairing | ConvertFrom-Json
if ($HideToken) {
    [PSCustomObject]@{ endpoint = $pairing.endpoint; tokenPath = (Join-Path $dataDirectory 'token'); tokenReady = [bool]$pairing.token } | ConvertTo-Json
} else {
    $rawPairing | Write-Output
    Write-Host "Paste only the token value into the Edge extension. Port: $port."
}
