param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$agentRoot = $PSScriptRoot
$nodeBin = (Get-Command node -ErrorAction Stop).Source
if ([int]((& $nodeBin --version).TrimStart('v').Split('.')[0]) -lt 24) { throw '需要 Node.js 24 或更高版本。' }
if (-not (Test-Path -LiteralPath (Join-Path $agentRoot 'node_modules'))) {
    Push-Location -LiteralPath $agentRoot
    try { & npm.cmd ci --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' } } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath (Join-Path $agentRoot 'dist\index.html'))) {
    Push-Location -LiteralPath $agentRoot
    try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw '网页构建失败' } } finally { Pop-Location }
}
$agentData = Join-Path $agentRoot 'data'
New-Item -ItemType Directory -Path $agentData -Force | Out-Null
$agentPort = if ($env:LA_PORT) { [int]$env:LA_PORT } else { 4317 }
$agentUrl = "http://127.0.0.1:$agentPort"
$running = $false
try { $reply = Invoke-RestMethod "$agentUrl/api/session" -TimeoutSec 2 -SessionVariable agentSession; $running = $reply.ready -eq $true } catch { }
if (-not $running) {
    $serverFile = Join-Path $agentRoot 'src\server.ts'
    Start-Process -FilePath $nodeBin -ArgumentList @('--disable-warning=ExperimentalWarning', ('"' + $serverFile + '"')) -WorkingDirectory $agentRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $agentData 'server.log') -RedirectStandardError (Join-Path $agentData 'server-error.log') | Out-Null
    for ($i=0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try { $reply=Invoke-RestMethod "$agentUrl/api/session" -TimeoutSec 1 -SessionVariable agentSession; if ($reply.ready) { $running=$true; break } } catch { }
    }
}
if (-not $running) { throw "启动失败，请查看 $agentData\server-error.log" }
try { $modelPreparation=Invoke-RestMethod "$agentUrl/api/runtime/qwen" -Method Post -ContentType 'application/json' -Body '{}' -WebSession $agentSession -TimeoutSec 5; Write-Host $modelPreparation.message } catch { Write-Warning 'Qwen 自动准备尚未启动，请在网页中点击重试。' }
Write-Host "本地 Agent 已启动：$agentUrl"
if (-not $NoBrowser) { Start-Process $agentUrl }
