# restart-dev.ps1
# Stops old dev servers (by common ports + project node processes), then starts a fresh Next.js dev server.

$ErrorActionPreference = 'Stop'

Write-Host 'Checking old dev servers...' -ForegroundColor Yellow

# 1) Kill processes listening on common Next.js dev ports.
$ports = @(3000, 3001, 3002, 3003)
$killedPids = New-Object System.Collections.Generic.HashSet[int]

foreach ($port in $ports) {
    try {
        $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
        foreach ($conn in $listeners) {
            $procId = [int]$conn.OwningProcess
            if ($procId -gt 0 -and -not $killedPids.Contains($procId)) {
                try {
                    Stop-Process -Id $procId -Force -ErrorAction Stop
                    $killedPids.Add($procId) | Out-Null
                    Write-Host "Stopped PID $procId on port $port" -ForegroundColor Green
                } catch {
                    Write-Host "Could not stop PID $procId on port $port" -ForegroundColor DarkYellow
                }
            }
        }
    } catch {
        # No listener on this port.
    }
}

# 2) Kill leftover node.exe processes for this workspace path.
$workspacePath = $PSScriptRoot
$nodeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$workspacePath*" }

foreach ($p in $nodeProcesses) {
    $procId = [int]$p.ProcessId
    if (-not $killedPids.Contains($procId)) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            $killedPids.Add($procId) | Out-Null
            Write-Host "Stopped workspace node PID $procId" -ForegroundColor Green
        } catch {
            Write-Host "Could not stop workspace node PID $procId" -ForegroundColor DarkYellow
        }
    }
}

# 3) Clear stale Next.js lock file if present.
$lockPath = Join-Path $workspacePath '.next\dev\lock'
if (Test-Path $lockPath) {
    Remove-Item $lockPath -Force
    Write-Host "Removed lock file: $lockPath" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Starting dev server...' -ForegroundColor Cyan
npm run dev
