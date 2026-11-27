<#
  Faro · instalación en un PC con Windows 10/11.

  Como servicio del sistema (recomendado: sirve para todas las cuentas y nadie sin la contraseña de
  administrador puede cerrarlo):
    1. Copie en una carpeta (o memoria USB) este script y el programa «faro-X.Y.Z-windows-x64.exe».
    2. Abra PowerShell como administrador y, en esa carpeta:
         powershell -ExecutionPolicy Bypass -File instalar-windows.ps1 -Codigo ABCD-EFGH
       El código sale en LADME → Administración → Faro → el equipo → Vincular (vence en 30 min).
       Si el equipo ya tenía Faro por cuenta y estaba vinculado, no hace falta código: se conserva.
    Deja:
      · C:\Program Files\LADME Faro\ladme-faro.exe   el programa (se actualiza solo) y el comando «faro»
      · el servicio «ladme-faro» (LocalSystem)       el núcleo: vínculo, estado, claves, servidor
      · C:\ProgramData\LADME Faro                    vínculo y estado (solo sistema y administradores)
    El servicio abre la isla y las pantallas en la sesión de quien use el equipo y las vuelve a abrir si
    alguien las cierra. Para retirarlo: desinstalar-windows.ps1 (como administrador).

  Solo para una cuenta (sin administrador, como antes): con el instalador «...setup.exe» junto al script,
  en la cuenta del equipo:
    powershell -ExecutionPolicy Bypass -File instalar-windows.ps1 -Codigo ABCD-EFGH
#>
param(
  [string]$Codigo = "",
  [string]$Instalador = ""
)
$ErrorActionPreference = "Stop"

$limpio = ""
if ($Codigo) {
  $limpio = ($Codigo.ToUpper() -replace '[^A-Z0-9]', '')
  if ($limpio.Length -ne 8) { throw "El código de vinculación tiene 8 caracteres (por ejemplo ABCD-EFGH)." }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

function Tiene-Token($ruta) {
  (Test-Path $ruta) -and ((Get-Content $ruta -Raw) -match '"token"')
}

# ------------------------------------------------------------------ solo para esta cuenta (sin administrador)

if (-not $admin) {
  if (Get-Service -Name "ladme-faro" -ErrorAction SilentlyContinue) {
    throw "En este equipo Faro está instalado como servicio del sistema. Para actualizarlo, ejecute este script en PowerShell como administrador."
  }
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
  if ($limpio) {
    if (Tiene-Token $archivo) {
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
  Write-Host "Para que nadie pueda cerrarlo, instálelo como servicio: este mismo script en PowerShell como administrador."
  if ($limpio) { Write-Host "En unos segundos se vincula solo; compruébelo en LADME → Administración → Faro." }
  exit 0
}

# ------------------------------------------------------------------ servicio del sistema (administrador)

$programa = Get-ChildItem -Path $PSScriptRoot -Filter "*windows-x64.exe" |
  Where-Object { $_.Name -notlike "*setup*" } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $programa) {
  throw "No encontré el programa de Faro (faro-X.Y.Z-windows-x64.exe, sin «setup») junto a este script."
}

# Faro necesita WebView2 (viene con Windows 11 y con las actualizaciones de Windows 10).
$webview = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
) | Where-Object { Test-Path $_ }
if (-not $webview) {
  Write-Host "Aviso: no encontré WebView2 en este equipo. Instálelo desde https://go.microsoft.com/fwlink/p/?LinkId=2124703 o Faro no podrá mostrar la isla." -ForegroundColor Yellow
}

$dir = Join-Path $env:ProgramFiles "LADME Faro"
$exe = Join-Path $dir "ladme-faro.exe"
$datos = Join-Path $env:ProgramData "LADME Faro"
$nombre = "ladme-faro"

# Detener el servicio y cualquier Faro abierto (el del servicio o uno por cuenta, en todas las sesiones).
if (Get-Service -Name $nombre -ErrorAction SilentlyContinue) {
  Stop-Service -Name $nombre -Force -ErrorAction SilentlyContinue
}
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq "ladme-faro" -or $_.Path -like "*\LADME Faro\*" } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

New-Item -ItemType Directory -Force -Path $dir, $datos | Out-Null
Copy-Item -Path $programa -Destination "$exe.nuevo" -Force
Move-Item -Path "$exe.nuevo" -Destination $exe -Force
Remove-Item -Path "$exe.viejo" -Force -ErrorAction SilentlyContinue

# El comando «faro» para todas las cuentas.
"@echo off`r`nrem Faro command line (faro status, faro doctor, faro logs).`r`nstart `"`" /b /wait `"$exe`" %*`r`nexit /b %errorlevel%`r`n" |
  Set-Content -Path (Join-Path $dir "faro.cmd") -Encoding ASCII -NoNewline
$ruta = [Environment]::GetEnvironmentVariable("Path", "Machine")
if (($ruta -split ";") -notcontains $dir) {
  [Environment]::SetEnvironmentVariable("Path", ($ruta.TrimEnd(";") + ";" + $dir), "Machine")
}

# Solo el sistema y los administradores leen el vínculo (por defecto, ProgramData lo leen todos).
icacls $datos /inheritance:r /grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" /T /Q | Out-Null

# Las cuentas del equipo (para trasladar el vínculo y limpiar lo de Faro por cuenta).
$perfiles = Get-ChildItem "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList" |
  ForEach-Object { [pscustomobject]@{ Sid = $_.PSChildName; Casa = (Get-ItemProperty $_.PSPath).ProfileImagePath } } |
  Where-Object { $_.Sid -like "S-1-5-21-*" -and $_.Casa -and (Test-Path $_.Casa) }

# El vínculo: el del servicio si ya existe; si no, el más reciente de Faro por cuenta; si no, el código.
$vinculo = Join-Path $datos "faro.json"
if (Tiene-Token $vinculo) {
  Write-Host "Se conserva el vínculo del servicio."
} else {
  $origen = $perfiles | ForEach-Object { Join-Path $_.Casa "AppData\Roaming\co.edu.unal.ladme.faro" } |
    Where-Object { Tiene-Token (Join-Path $_ "faro.json") } |
    Sort-Object { (Get-Item (Join-Path $_ "faro.json")).LastWriteTime } -Descending | Select-Object -First 1
  if ($origen) {
    Copy-Item (Join-Path $origen "faro.json") $vinculo -Force
    if (Test-Path (Join-Path $origen "estado.json")) { Copy-Item (Join-Path $origen "estado.json") (Join-Path $datos "estado.json") -Force }
    Write-Host "Se trasladó el vínculo de $origen al servicio."
  } elseif ($limpio) {
    ('{ "codigo_vinculo": "' + $limpio + '" }') | Set-Content -Path $vinculo -Encoding ASCII
  } else {
    Write-Host "Aviso: el equipo no está vinculado. Vincúlelo con: faro link ABCD-EFGH" -ForegroundColor Yellow
  }
}

# Faro por cuenta: su arranque al iniciar sesión, su comando «faro», su carpeta y su entrada en
# «Aplicaciones». El vínculo de la cuenta se renombra (ya está en el servicio).
foreach ($p in $perfiles) {
  $cargada = Test-Path "Registry::HKEY_USERS\$($p.Sid)"
  $raiz = "Registry::HKEY_USERS\$($p.Sid)"
  $hive = Join-Path $p.Casa "NTUSER.DAT"
  if (-not $cargada -and (Test-Path $hive)) {
    # (con cmd, para que un error de reg no detenga el script)
    cmd.exe /c "reg.exe load HKU\FaroTemporal `"$hive`" >nul 2>&1"
    if ($LASTEXITCODE -eq 0) { $raiz = "Registry::HKEY_USERS\FaroTemporal" } else { $raiz = $null }
  }
  if ($raiz) {
    $run = "$raiz\Software\Microsoft\Windows\CurrentVersion\Run"
    if (Test-Path $run) {
      $valores = Get-ItemProperty $run
      foreach ($v in $valores.PSObject.Properties) {
        if ($v.Name -notlike "PS*" -and "$($v.Value)" -match "LADME Faro|ladme-faro") {
          Remove-ItemProperty -Path $run -Name $v.Name -ErrorAction SilentlyContinue
        }
      }
    }
    Remove-Item "$raiz\Software\Microsoft\Windows\CurrentVersion\Uninstall\LADME Faro" -Recurse -Force -ErrorAction SilentlyContinue
    if ($raiz -like "*FaroTemporal") {
      [gc]::Collect()
      Start-Sleep -Milliseconds 300
      cmd.exe /c "reg.exe unload HKU\FaroTemporal >nul 2>&1"
    }
  }
  $cmd = Join-Path $p.Casa "AppData\Local\Microsoft\WindowsApps\faro.cmd"
  if ((Test-Path $cmd) -and ((Get-Content $cmd -Raw) -match "LADME Faro")) { Remove-Item $cmd -Force -ErrorAction SilentlyContinue }
  Remove-Item (Join-Path $p.Casa "AppData\Local\LADME Faro") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $p.Casa "AppData\Roaming\Microsoft\Windows\Start Menu\Programs\LADME Faro.lnk") -Force -ErrorAction SilentlyContinue
  $propio = Join-Path $p.Casa "AppData\Roaming\co.edu.unal.ladme.faro\faro.json"
  if (Test-Path $propio) { Move-Item $propio "$propio.trasladado" -Force -ErrorAction SilentlyContinue }
}

# El servicio: arranca con Windows y, si se cae o se actualiza, Windows lo vuelve a abrir.
$binario = "`"$exe`" --servicio"
if (Get-Service -Name $nombre -ErrorAction SilentlyContinue) {
  & sc.exe config $nombre binPath= $binario start= auto | Out-Null
} else {
  New-Service -Name $nombre -BinaryPathName $binario -DisplayName "Faro · LADME" -StartupType Automatic `
    -Description "Agente de los computadores de la sala LADME (UNAL Sede La Paz)." | Out-Null
}
& sc.exe failure $nombre reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
Start-Service -Name $nombre

Write-Host ""
Write-Host "Listo. Faro quedó como servicio del sistema para todas las cuentas ($exe)." -ForegroundColor Green
Write-Host "En unos segundos aparece la isla. Compruébelo con: faro status   (en una terminal nueva)"
if ($limpio) { Write-Host "En unos segundos se vincula solo; compruébelo en LADME → Administración → Faro." }
