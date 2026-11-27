<#
  Faro · retirar el servicio del sistema en Windows. En PowerShell como administrador:
    powershell -ExecutionPolicy Bypass -File desinstalar-windows.ps1          conserva el vínculo
    powershell -ExecutionPolicy Bypass -File desinstalar-windows.ps1 -Todo    borra también el vínculo

  Para volver a instalarlo basta con instalar-windows.ps1: si conservó el vínculo, no pide código.
  El equipo sigue en el panel de LADME (aparece sin conexión) hasta que lo retire allí.
#>
param([switch]$Todo)
$ErrorActionPreference = "Stop"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Ejecútelo en PowerShell como administrador." }

$nombre = "ladme-faro"
$dir = Join-Path $env:ProgramFiles "LADME Faro"
$datos = Join-Path $env:ProgramData "LADME Faro"

if (Get-Service -Name $nombre -ErrorAction SilentlyContinue) {
  Stop-Service -Name $nombre -Force -ErrorAction SilentlyContinue
  & sc.exe delete $nombre | Out-Null
}
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq "ladme-faro" -or $_.Path -like "$dir\*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
$ruta = [Environment]::GetEnvironmentVariable("Path", "Machine")
$nueva = (($ruta -split ";") | Where-Object { $_ -and $_ -ne $dir }) -join ";"
if ($nueva -ne $ruta) { [Environment]::SetEnvironmentVariable("Path", $nueva, "Machine") }

if ($Todo) {
  Remove-Item $datos -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Faro quedó retirado de este equipo, con su vínculo." -ForegroundColor Green
} else {
  Write-Host "Faro quedó retirado de este equipo. El vínculo se conserva en $datos" -ForegroundColor Green
  Write-Host "(para borrarlo también: desinstalar-windows.ps1 -Todo)."
}
