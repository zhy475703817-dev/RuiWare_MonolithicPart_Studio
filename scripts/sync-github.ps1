param([string]$Message = 'Sync local code and component deliverables', [switch]$Preview)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$gitRuntime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\native\git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (-not (Test-Path -LiteralPath (Join-Path $gitRuntime 'cmd\git.exe'))) {
        throw 'Git is required. Install Git for Windows and retry.'
    }
    $env:PATH = (Join-Path $gitRuntime 'cmd') + ';' + $env:PATH
}
if (Test-Path -LiteralPath (Join-Path $gitRuntime 'mingw64\bin')) {
    $env:PATH = (Join-Path $gitRuntime 'mingw64\bin') + ';' + $env:PATH
}
function Invoke-Git {
    & git @args
    if ($LASTEXITCODE -ne 0) { throw "Git failed: $($args -join ' ')" }
}
if ((Invoke-Git symbolic-ref --short HEAD) -ne 'en888-jpg') { throw 'Only en888-jpg may be synchronized.' }
if ((Invoke-Git remote get-url origin) -ne 'https://github.com/zhy475703817-dev/RuiWare_MonolithicPart_Studio.git') { throw 'Unexpected remote.' }
if (Invoke-Git diff --cached --name-only) { throw 'Existing staged changes found. Review or commit them first.' }
$pythonCandidates = @((Join-Path $root '.venv\Scripts\python.exe'),
    (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'))
$python = $null
foreach ($candidate in $pythonCandidates) {
    if (Test-Path -LiteralPath $candidate) {
        try {
            & $candidate -c 'import sqlite3, zipfile' 2>$null
            if ($LASTEXITCODE -eq 0) { $python = $candidate; break }
        } catch { continue }
    }
}
if (-not $python) { throw 'Python 3 with sqlite3 is required.' }
& $python (Join-Path $PSScriptRoot 'export-component-deliverables.py')
if ($LASTEXITCODE -ne 0) { throw 'Component export failed; no commit or push performed.' }
$paths = @('apps/studio-web/src', 'apps/studio-web/public', 'apps/studio-web/package.json',
    'apps/studio-web/index.html', 'apps/studio-web/vite.config.ts', 'apps/studio-web/tsconfig.json',
    'libs/python', 'packages/contracts', 'services', 'tests', 'scripts', 'docs', 'examples',
    'deliverables', 'README.md', 'AGENTS.md', '.gitignore', '.gitattributes', '.editorconfig',
    'pyproject.toml', 'package.json', 'package-lock.json', 'bun.lock', 'start-dev.ps1',
    'start-dev.bat', 'sync-github.bat') | Where-Object { Test-Path -LiteralPath $_ }
$paths += @(':(exclude)**/*.egg-info/**', ':(exclude)**/__pycache__/**',
    ':(exclude)**/*.pyc', ':(exclude)**/*.log', ':(exclude)**/*.tsbuildinfo')
if ($Preview) {
    Invoke-Git status --short -- @paths
    Write-Host 'Preview only. No files staged, committed, or pushed.'
    return
}
Invoke-Git add -A -- @paths
$staged = @(Invoke-Git diff --cached --name-only)
foreach ($file in $staged) {
    if ($file -match '(^|/)(node_modules|__pycache__|\.venv|\.env[^/]*|credentials)(/|$)|\.(db|log|pem|key|pyc)$') {
        throw "Unsafe staged path. Review and unstage before retrying: $file"
    }
    if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 20MB) {
        throw "File exceeds synchronization limit: $file"
    }
}
if ($staged.Count) { Invoke-Git commit -m $Message }
# No force push, reset, checkout, auto-merge, or uploading the platform/material DB.
Invoke-Git -c credential.interactive=false push -u origin en888-jpg
Write-Host 'GitHub synchronization completed.'
