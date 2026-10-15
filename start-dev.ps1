param(
    [int]$ApiPort = 8010,
    [int]$WebPort = 5173,
    [string]$MaterialDatabase = $env:RUIWARE_MATERIAL_DB
)

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectSitePackages = Join-Path $ProjectRoot '.venv\Lib\site-packages'
$PythonCandidates = @()
$VenvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $VenvPython) {
    $PythonCandidates += [pscustomobject]@{ Path = $VenvPython; UseProjectPackages = $false }
}
$PathPython = Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if ($PathPython) {
    $PythonCandidates += [pscustomobject]@{ Path = $PathPython; UseProjectPackages = $true }
}
$CodexPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path -LiteralPath $CodexPython) {
    $PythonCandidates += [pscustomobject]@{ Path = $CodexPython; UseProjectPackages = $true }
}

function Get-PythonPathForCandidate {
    param([bool]$UseProjectPackages)
    if (-not $UseProjectPackages) { return $script:OriginalPythonPath }
    $paths = @()
    if (Test-Path -LiteralPath $script:ProjectSitePackages) { $paths += $script:ProjectSitePackages }
    if ($script:OriginalPythonPath) { $paths += $script:OriginalPythonPath }
    return ($paths -join [IO.Path]::PathSeparator)
}

function Test-PythonCandidate {
    param([pscustomobject]$Candidate)
    $previousPythonPath = $env:PYTHONPATH
    $candidatePythonPath = Get-PythonPathForCandidate $Candidate.UseProjectPackages
    if ($candidatePythonPath) { $env:PYTHONPATH = $candidatePythonPath }
    else { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue }
    try {
        $null = & $Candidate.Path -c "import fastapi, uvicorn, pydantic, OCP; import sys; sys.path.insert(0, r'$ProjectRoot\services\template-api'); import app.main" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        if ($null -ne $previousPythonPath) { $env:PYTHONPATH = $previousPythonPath }
        else { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue }
    }
}

$OriginalPythonPath = $env:PYTHONPATH
$SelectedPython = $PythonCandidates | Where-Object { Test-PythonCandidate $_ } | Select-Object -First 1
if (-not $SelectedPython) {
    throw 'No usable Python runtime found. Restore Python 3.12 or install the project dependencies with the steps in README.md.'
}
$PythonExecutable = $SelectedPython.Path
$env:PYTHONPATH = Get-PythonPathForCandidate $SelectedPython.UseProjectPackages
if (-not $env:PYTHONPATH) { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue }
Write-Host "Python runtime: $PythonExecutable"

function Test-LocalPort {
    param([int]$Port)
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $true
    } catch {
        return $false
    } finally {
        if ($client) { $client.Dispose() }
    }
}

function Wait-HttpReady {
    param(
        [string]$Uri,
        [int]$TimeoutSeconds = 30
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        } catch {
            # The child process may still be starting; retry until the deadline.
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $Uri"
}

if (-not $MaterialDatabase) {
    $materialCandidates = @(
        (Join-Path $ProjectRoot 'ruiware.db'),
        (Join-Path (Split-Path -Parent $ProjectRoot) 'debug\debug\ruiware.db')
    )
    $MaterialDatabase = $materialCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}
if ($MaterialDatabase) {
    $env:RUIWARE_MATERIAL_DB = (Resolve-Path -LiteralPath $MaterialDatabase).Path
}

$BunExecutable = $null
$bunCandidates = @(
    (Get-Command bun.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    (Join-Path $env:APPDATA 'npm\node_modules\bun\bin\bun.exe'),
    (Join-Path $env:USERPROFILE '.bun\bin\bun.exe')
)
foreach ($candidate in $bunCandidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
        $BunExecutable = $candidate
        break
    }
}
$NodeExecutable = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
if (-not $NodeExecutable) {
    $runtimeNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $runtimeNode) { $NodeExecutable = $runtimeNode }
}
$ViteCli = Get-ChildItem (Join-Path $ProjectRoot 'apps\studio-web\node_modules\.pnpm') -Directory -Filter 'vite@*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'node_modules\vite\bin\vite.js' } |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $BunExecutable -and -not ($NodeExecutable -and $ViteCli)) {
    throw 'Missing Bun/Node/Vite. Install Bun or Node dependencies first.'
}

if (-not (Test-LocalPort $ApiPort)) {
    Start-Process -FilePath $PythonExecutable `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'services/template-api', '--host', '127.0.0.1', '--port', $ApiPort) `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $ProjectRoot 'api.out.log') `
        -RedirectStandardError (Join-Path $ProjectRoot 'api.err.log')
}

if ($BunExecutable) {
    $WebFile = $BunExecutable
    $WebArguments = @('--cwd', 'apps/studio-web', 'dev', '--host', '127.0.0.1', '--port', $WebPort)
    $WebWorkingDirectory = $ProjectRoot
} else {
    $WebFile = $NodeExecutable
    $WebArguments = @($ViteCli, 'dev', '--host', '127.0.0.1', '--port', $WebPort)
    $WebWorkingDirectory = Join-Path $ProjectRoot 'apps\studio-web'
}
if (-not (Test-LocalPort $WebPort)) {
    Start-Process -FilePath $WebFile `
        -ArgumentList $WebArguments `
        -WorkingDirectory $WebWorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $ProjectRoot 'web.out.log') `
        -RedirectStandardError (Join-Path $ProjectRoot 'web.err.log')
}

Wait-HttpReady "http://127.0.0.1:$ApiPort/docs"
Wait-HttpReady "http://127.0.0.1:$WebPort/"

Write-Host "Template API: http://127.0.0.1:$ApiPort"
Write-Host "Template Studio: http://127.0.0.1:$WebPort"
Write-Host "Material database: $($env:RUIWARE_MATERIAL_DB)"
