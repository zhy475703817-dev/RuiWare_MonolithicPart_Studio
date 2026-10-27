param(
    [int]$PollSeconds = 15,
    [int]$QuietSeconds = 30
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$log = Join-Path $root 'sync-github.log'
$ignoredStatus = @('apps/studio-web/tsconfig.tsbuildinfo', 'libs/python/ruiware_template_engineering_platform.egg-info/SOURCES.txt')

function Write-Log([string]$message) {
    Add-Content -LiteralPath $log -Value ("{0:u} {1}" -f (Get-Date), $message) -Encoding UTF8
}

function Get-MeaningfulStatus {
    $lines = @(git status --porcelain --untracked-files=all)
    return @($lines | Where-Object {
        $path = $_.Substring([Math]::Min(3, $_.Length)).Replace('\', '/')
        $_ -and ($ignoredStatus -notcontains $path)
    })
}

Write-Log "Watcher started (poll=${PollSeconds}s, quiet=${QuietSeconds}s)."
$lastSignature = ''
$changedAt = $null
while ($true) {
    try {
        $status = @(Get-MeaningfulStatus)
        $signature = ($status -join "`n")
        if ($signature -ne $lastSignature) {
            $lastSignature = $signature
            $changedAt = if ($signature) { Get-Date } else { $null }
            if ($signature) { Write-Log "Changes detected; waiting for quiet period." }
        }
        if ($changedAt -and ((Get-Date) - $changedAt).TotalSeconds -ge $QuietSeconds) {
            if (@(git diff --cached --name-only).Count) {
                Write-Log 'Skipped: staged changes already exist; review and unstage/commit them.'
            } else {
                Write-Log 'Quiet period reached; running synchronization.'
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sync-github.ps1') `
                    -Message 'Automatic sync of local workspace and component deliverables' *>> $log
                if ($LASTEXITCODE -eq 0) { Write-Log 'Synchronization succeeded.' }
                else { Write-Log "Synchronization failed with exit code $LASTEXITCODE; will retry after a new change." }
            }
            $changedAt = $null
        }
    } catch {
        Write-Log "Watcher error: $($_.Exception.Message)"
        $changedAt = $null
    }
    Start-Sleep -Seconds $PollSeconds
}
