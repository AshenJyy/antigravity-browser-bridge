[CmdletBinding()]
param(
    [string]$PluginDirectory = (Join-Path $env:USERPROFILE '.gemini\config\plugins\browser-bridge'),
    [string]$NodePath,
    [string]$AgyPath
)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$targetRoot = [IO.Path]::GetFullPath($PluginDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'runtime\mcp.mjs'))) { throw 'Use the release ZIP or run the project build first.' }
if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCommand) { $NodePath = $nodeCommand.Source }
    else { $NodePath = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' }
}
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Pass -NodePath with an installed Node.js 22+ executable.' }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$major = [int]((& $NodePath --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22 or later is required.' }
if (-not $AgyPath) {
    $agyCommand = Get-Command agy -ErrorAction SilentlyContinue
    if ($agyCommand) { $AgyPath = $agyCommand.Source }
    else { $AgyPath = Join-Path $env:USERPROFILE '.dsh\antigravity\bin\agy.exe' }
}
if (-not (Test-Path -LiteralPath $AgyPath -PathType Leaf)) { throw 'Pass -AgyPath with the agy executable used by the DSH Antigravity subagent plugin.' }
$AgyPath = (Resolve-Path -LiteralPath $AgyPath).Path
if ($sourceRoot -ne $targetRoot) {
    if (Test-Path -LiteralPath $targetRoot) {
        if (-not (Test-Path -LiteralPath (Join-Path $targetRoot 'plugin.json'))) { throw 'Destination exists and is not a plugin directory.' }
        $backupRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $targetRoot)) 'plugin-backups'
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $backupPath = Join-Path $backupRoot ('browser-bridge-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        Copy-Item -LiteralPath $targetRoot -Destination $backupPath -Recurse
        Write-Host "Previous installation preserved at $backupPath"
    }
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    foreach ($entry in @('runtime', 'extension', 'skills', 'docs', 'scripts', 'plugin.json', 'mcp_config.json', 'README.md', 'LICENSE')) {
        $sourcePath = Join-Path $sourceRoot $entry
        if (Test-Path -LiteralPath $sourcePath) { Copy-Item -LiteralPath $sourcePath -Destination $targetRoot -Recurse -Force }
    }
}
# Resolve Node because App processes may not inherit the shell PATH.
$configPath = Join-Path $targetRoot 'mcp_config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$config.mcpServers.'browser-bridge'.command = $NodePath
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
$currentPlugins = & $AgyPath plugin list --json
if ($LASTEXITCODE -ne 0) { throw 'Could not read the agy plugin registry.' }
$registered = @($currentPlugins | ConvertFrom-Json) | Where-Object {
    $_.name -eq 'browser-bridge' -and $_.path -and [IO.Path]::GetFullPath($_.path) -eq $targetRoot
}
if (-not $registered) {
    & $AgyPath plugin install $targetRoot
    if ($LASTEXITCODE -ne 0) { throw 'agy plugin install failed; the App copy remains at the specified directory.' }
}
& $AgyPath plugin enable browser-bridge
if ($LASTEXITCODE -ne 0) { throw 'agy could not enable browser-bridge.' }
& $AgyPath plugin list --json
if ($LASTEXITCODE -ne 0) { throw 'agy plugin listing failed.' }
Write-Host "App plugin files: $targetRoot"
Write-Host 'Restart Antigravity App and start a new DSH agy subagent conversation to load tools.'
Write-Host 'Run scripts\BrowserBridge.ps1 pair, then enter the token in the Edge extension popup.'
Write-Host 'Verify browser_status in BOTH hosts; a plugin listing alone does not prove tool execution.'
