$ErrorActionPreference='Stop'
try { $r=Invoke-RestMethod 'http://127.0.0.1:1234/v1/models' -TimeoutSec 2; if($r.data){Write-Host 'Qwen API is already running.'; exit} } catch { }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$modelWindow=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq 'Bionic' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if(-not $modelWindow){throw 'Open the existing model application first. No model or runtime will be installed.'}
$shellControl=New-Object -ComObject WScript.Shell
$shellControl.AppActivate($modelWindow.Id) | Out-Null
Start-Sleep -Milliseconds 300
$rootElement=[System.Windows.Automation.AutomationElement]::FromHandle($modelWindow.MainWindowHandle)
function Find-Button([string]$label){
  $condition=New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,$label)),(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Button)))
  return $rootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants,$condition)
}
$serverButton=Find-Button '本地API服务器'
if(-not $serverButton){
  $settingsButton=Find-Button '设置'
  if($settingsButton){($settingsButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke();Start-Sleep -Milliseconds 500}
  $apiButton=Find-Button '本地模型API'
  if(-not $apiButton){throw 'Cannot locate the API page in this application version.'}
  $apiButton.SetFocus();$shellControl.SendKeys('{ENTER}');Start-Sleep -Milliseconds 700
  $serverButton=Find-Button '本地API服务器'
}
if(-not $serverButton){throw 'Cannot locate the local API switch.'}
$toggle=$serverButton.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
if($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off){$toggle.Toggle()}
for($i=0;$i -lt 12;$i++){
  Start-Sleep -Milliseconds 400
  try{$r=Invoke-RestMethod 'http://127.0.0.1:1234/v1/models' -TimeoutSec 1;if($r.data){Write-Host 'Qwen API ready: http://127.0.0.1:1234/v1';exit}}catch{}
}
throw 'API has not started. Check the application server page.'
