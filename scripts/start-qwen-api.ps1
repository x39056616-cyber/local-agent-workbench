param(
  [string]$DataDirectory=(Join-Path (Split-Path $PSScriptRoot -Parent) 'data'),
  [string]$BaseUrl='http://127.0.0.1:1234/v1',
  [string]$Model='qwen3.8-27b-gsq-rco',
  [int]$LoadTimeoutSeconds=240
)
$ErrorActionPreference='Stop'
$endpoint=[Uri]$BaseUrl
if($endpoint.Scheme -ne 'http' -or -not $endpoint.IsLoopback){throw 'Automatic startup requires a local HTTP endpoint.'}
$apiRoot=$BaseUrl.TrimEnd('/') -replace '/v1$',''
New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
$statePath=Join-Path $DataDirectory 'qwen-startup.json'
function Set-State([string]$status,[string]$message){
  $state=@{status=$status;message=$message;updated=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress
  $temporary=$statePath+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
  try{
    [IO.File]::WriteAllText($temporary,$state,(New-Object Text.UTF8Encoding($false)))
    for($attempt=0;$attempt -lt 8;$attempt++){
      try{
        if([IO.File]::Exists($statePath)){[IO.File]::Replace($temporary,$statePath,[NullString]::Value)}else{[IO.File]::Move($temporary,$statePath)}
        return
      }catch [IO.IOException]{if($attempt -eq 7){throw};Start-Sleep -Milliseconds 30}
    }
  }finally{if([IO.File]::Exists($temporary)){[IO.File]::Delete($temporary)}}
}
function Models { return (Invoke-RestMethod ($apiRoot+'/api/v1/models') -TimeoutSec 3).models }
function Find-Qwen { return @(Models | Where-Object { $_.key -eq $Model }) | Select-Object -First 1 }
$lockKey=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($BaseUrl))).Replace('-','').Substring(0,16)
$mutex=New-Object Threading.Mutex($false,('Local\LocalAgentQwen-'+$lockKey))
$ownsLock=$false
try{
  try{$ownsLock=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$ownsLock=$true}
  if(-not $ownsLock){
    $deadline=(Get-Date).AddSeconds($LoadTimeoutSeconds)
    do{try{$m=Find-Qwen;if($m -and $m.loaded_instances.Count -gt 0){Set-State 'ready' 'Qwen 已就绪，沿用你的模型设置';exit 0}}catch{};Start-Sleep -Seconds 2}while((Get-Date) -lt $deadline)
    throw 'Timed out waiting for the existing model startup.'
  }
  Set-State 'starting' '正在连接本地模型应用'
  $apiReady=$false
  try{$null=Models;$apiReady=$true}catch{}
  if(-not $apiReady){
    $modelWindow=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('Bionic','LM Studio') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if(-not $modelWindow){
      $candidates=@($env:LA_QWEN_APP,(Join-Path $env:ProgramFiles 'Bionic\Bionic.exe'),(Join-Path $env:LOCALAPPDATA 'Programs\LM Studio\LM Studio.exe')) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
      if(-not $candidates){throw 'Bionic / LM Studio was not found. Set LA_QWEN_APP to the installed application.'}
      Start-Process -FilePath $candidates[0] -WindowStyle Hidden | Out-Null
      for($i=0;$i -lt 45;$i++){
        Start-Sleep -Seconds 1
        try{$null=Models;$apiReady=$true;break}catch{}
        $modelWindow=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('Bionic','LM Studio') -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if($modelWindow){break}
      }
    }
    if(-not $apiReady){
      if(-not $modelWindow){throw 'The model application did not create a window.'}
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $rootElement=[Windows.Automation.AutomationElement]::FromHandle($modelWindow.MainWindowHandle)
      function Find-Button([string]$label){
        $condition=New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,$label)),(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)))
        return $rootElement.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
      }
      function Invoke-Button($button){
        $pattern=$null
        if($button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}else{
          $shellControl=New-Object -ComObject WScript.Shell
          $shellControl.AppActivate($modelWindow.Id)|Out-Null
          $button.SetFocus();$shellControl.SendKeys('{ENTER}')
        }
      }
      $serverButton=$null
      for($i=0;$i -lt 20;$i++){
        $serverButton=Find-Button '本地API服务器'
        if($serverButton){break}
        $settings=Find-Button '设置';if($settings){Invoke-Button $settings;Start-Sleep -Milliseconds 300}
        $api=Find-Button '本地模型API';if($api){Invoke-Button $api}
        Start-Sleep -Seconds 1
      }
      if(-not $serverButton){throw 'Cannot locate the local API switch in this application version.'}
      $toggle=$serverButton.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
      if($toggle.Current.ToggleState -eq [Windows.Automation.ToggleState]::Off){$toggle.Toggle()}
      for($i=0;$i -lt 30;$i++){Start-Sleep -Seconds 1;try{$null=Models;$apiReady=$true;break}catch{}}
      if(-not $apiReady){throw 'The local model API did not start.'}
    }
  }
  $modelInfo=Find-Qwen
  if(-not $modelInfo){throw ('The configured model is not installed: '+$Model)}
  if($modelInfo.loaded_instances.Count -eq 0){
    Set-State 'loading' '正在载入 Qwen，首次准备可能需要一些时间'
    # 仅传模型名称，沿用 Bionic 已保存的上下文、GPU 和推理参数。
    $body=@{model=$Model}|ConvertTo-Json -Compress
    $null=Invoke-RestMethod ($apiRoot+'/api/v1/models/load') -Method Post -ContentType 'application/json' -Body $body -TimeoutSec $LoadTimeoutSeconds
  }
  $modelInfo=Find-Qwen
  if(-not $modelInfo -or $modelInfo.loaded_instances.Count -eq 0){throw 'The API returned without a loaded Qwen instance.'}
  Set-State 'ready' 'Qwen 已就绪，沿用你的模型设置'
  Write-Host ('Qwen ready: '+$BaseUrl)
}catch{
  Set-State 'failed' ('Qwen 未能就绪：'+$_.Exception.Message)
  Write-Error $_.Exception.Message
  exit 1
}finally{if($ownsLock){$mutex.ReleaseMutex()};$mutex.Dispose()}
