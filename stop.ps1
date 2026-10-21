$ErrorActionPreference = 'Stop'
$statePath = Join-Path $PSScriptRoot 'data\server.json'
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host '没有本项目的运行记录。'; exit }
$agentState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$serverFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'src\server.ts'))
$agentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$agentState.pid)" -ErrorAction SilentlyContinue
if ($agentProcess -and $agentProcess.CommandLine.Contains($serverFile)) {
    # 模型准备进程及其启动的 Bionic 独立完成；只回收工作台的执行器子进程。
    $children=Get-CimInstance Win32_Process -Filter "ParentProcessId=$([int]$agentState.pid)" -ErrorAction SilentlyContinue
    foreach($child in $children) {
        if($child.CommandLine -like '*start-qwen-api.ps1*' -or $child.Name -in @('Bionic.exe','LM Studio.exe','llmster.exe')) { continue }
        & taskkill.exe /PID ([string]$child.ProcessId) /T /F 2>$null | Out-Null
    }
    Stop-Process -Id ([int]$agentState.pid) -ErrorAction SilentlyContinue
    Write-Host '本地 Agent 已停止。LM Studio 和你原来打开的其他应用继续运行。'
} else { Write-Host '原服务进程已退出，未停止其他进程。' }
