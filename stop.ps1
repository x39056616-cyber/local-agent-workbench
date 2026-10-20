$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot 'data\server.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host '没有本项目的运行记录。'; exit }
$agentState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$serverFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'src\server.ts'))
$agentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$agentState.pid)" -ErrorAction SilentlyContinue
if ($agentProcess -and $agentProcess.CommandLine.Contains($serverFile)) {
    # taskkill /T 仅清理由启动脚本创建并通过路径核对的本项目进程树。
    & taskkill.exe /PID ([string]$agentState.pid) /T /F | Out-Null
    Write-Host '本地 Agent 已停止。LM Studio 和你原来打开的其他应用继续运行。'
} else { Write-Host '原服务进程已退出，未停止其他进程。' }
