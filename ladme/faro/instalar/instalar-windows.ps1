<#
  Faro · instalación en un PC con Windows 10/11, para la cuenta en la que se ejecuta
  (por ejemplo «estudiantes»). No necesita permisos de administrador.

  1. Copie en una carpeta (o memoria USB) este script y el instalador «...setup.exe».
  2. Inicie sesión en la cuenta del equipo y, en esa carpeta:
       powershell -ExecutionPolicy Bypass -File instalar-windows.ps1 -Codigo ABCD-EFGH
     El código sale en LADME → Administración → Faro → el equipo → Vincular (vence en 30 min).
     Sin -Codigo, Faro abre la ventana para escribirlo a mano.

  Instala en silencio, deja el código para que Faro se vincule solo y abre Faro.
  Faro se agrega al inicio de sesión de la cuenta y se actualiza solo.
#>
param(
  [string]$Codigo = "",
  [string]$Instalador = ""
)
$ErrorActionPreference = "Stop"

if (-not $Instalador) {
  $Instalador = Get-ChildItem -Path $PSScriptRoot -Filter "*setup.exe" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $Instalador -or -not (Test-Path $Instalador)) {
  throw "No encontré el instalador de Faro (*setup.exe) junto a este script."
}

$carpeta = Join-Path $env:APPDATA "co.edu.unal.ladme.faro"
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
$archivo = Join-Path $carpeta "faro.json"

if ($Codigo) {
  $limpio = ($Codigo.ToUpper() -replace '[^A-Z0-9]', '')
  if ($limpio.Length -ne 8) { throw "El código de vinculación tiene 8 caracteres (por ejemplo ABCD-EFGH)." }
  if ((Test-Path $archivo) -and ((Get-Content $archivo -Raw) -match '"token"')) {
    Write-Host "Este equipo ya estaba vinculado: se conserva el vínculo actual." -ForegroundColor Yellow
  } else {
    ('{ "codigo_vinculo": "' + $limpio + '" }') | Set-Content -Path $archivo -Encoding ASCII
  }
}

# Si Faro ya estaba abierto (reinstalación), se cierra para poder reemplazarlo.
Get-Process | Where-Object { $_.Path -like "*\LADME Faro\*" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Instalando Faro…"
Start-Process -FilePath $Instalador -ArgumentList "/S" -Wait

$destino = Join-Path $env:LOCALAPPDATA "LADME Faro"
$exe = Get-ChildItem -Path $destino -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "uninstall*" } | Select-Object -First 1
if (-not $exe) { throw "La instalación no dejó Faro en $destino. Revise el instalador." }

Start-Process -FilePath $exe.FullName
Write-Host "Listo. Faro quedó instalado en $destino y se abrirá en cada inicio de sesión." -ForegroundColor Green
if ($Codigo) { Write-Host "En unos segundos se vincula solo; compruébelo en LADME → Administración → Faro." }
