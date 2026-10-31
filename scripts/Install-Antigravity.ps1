[CmdletBinding()]
param(
    [string]$PluginDirectory = (Join-Path $env:USERPROFILE '.gemini\config\plugins\browser-bridge'),
    [string]$NodePath,
    [string]$DataDirectory = $(if ($env:BROWSER_BRIDGE_DATA_DIR) { $env:BROWSER_BRIDGE_DATA_DIR } else { Join-Path $env:USERPROFILE '.browser-bridge' }),
    [ValidateRange(1024,65535)][int]$Port = $(if ($env:BROWSER_BRIDGE_PORT) { [int]$env:BROWSER_BRIDGE_PORT } else { 9224 })
)
$ErrorActionPreference = 'Stop'
$sourceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$targetRoot = [IO.Path]::GetFullPath($PluginDirectory)
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'runtime\mcp.mjs'))) { throw 'Use the release ZIP or run the project build first.' }
if (-not $NodePath) {
    $bundledNode = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) { $NodePath = $bundledNode }
    elseif ($nodeCommand) { $NodePath = $nodeCommand.Source }
}
if (-not $NodePath -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Pass -NodePath with an installed Node.js 22+ executable.' }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$major = [int]((& $NodePath --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22 or later is required.' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
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
    foreach ($entry in @('runtime', 'extension', 'skills', 'docs', 'scripts', 'plugin.json', 'mcp_config.json', 'README.md', 'README.en.md', 'CHANGELOG.md', 'LICENSE')) {
        $sourcePath = Join-Path $sourceRoot $entry
        if (Test-Path -LiteralPath $sourcePath) { Copy-Item -LiteralPath $sourcePath -Destination $targetRoot -Recurse -Force }
    }
}
# Resolve Node because App processes may not inherit the shell PATH.
$configPath = Join-Path $targetRoot 'mcp_config.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$entry = $config.mcpServers.'browser-bridge'
$entry.command = $NodePath
if (-not $entry.env) { $entry | Add-Member -NotePropertyName env -NotePropertyValue ([PSCustomObject]@{}) -Force }
$entry.env | Add-Member -NotePropertyName BROWSER_BRIDGE_PORT -NotePropertyValue ([string]$Port) -Force
$entry.env | Add-Member -NotePropertyName BROWSER_BRIDGE_DATA_DIR -NotePropertyValue $DataDirectory -Force
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
# Antigravity App discovers this official global plugin directory itself.
Write-Host "App plugin files: $targetRoot"
Write-Host "Shared state directory: $DataDirectory (port $Port)"
Write-Host 'Restart Antigravity App to load its Browser Bridge tools.'
Write-Host 'DSH uses its own native browser-bridge plugin; restart DSH after upgrading that package.'
Write-Host "For pairing, run the installed script: $targetRoot\scripts\BrowserBridge.ps1 pair"
