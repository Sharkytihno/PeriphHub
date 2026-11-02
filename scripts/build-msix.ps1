# Construit le paquet MSIX destiné au Microsoft Store (non signé : le Store le signe lui-même).
# À lancer après « npx tauri build --no-bundle » et scripts/fetch-headsetcontrol.ps1.
#
#   ./scripts/build-msix.ps1 -IdentityName 12345Sharky.PeriphHub -Publisher "CN=XXXXXXXX-..." -PublisherName "Sharky"
#
# Les trois valeurs viennent du Partner Center (Produit > Gestion du produit > Identité du produit).
# Sans elles, des valeurs provisoires sont utilisées : le paquet se construit mais le Store le refusera.
param(
  [string]$IdentityName = 'PeriphHub.Provisoire',
  [string]$Publisher = 'CN=PeriphHub',
  [string]$PublisherName = 'Sharky',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$conf = Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$version = "$($conf.version).0"  # le Store exige 4 nombres, le dernier à 0
$release = Join-Path $root 'src-tauri/target/release'
$stage = Join-Path $root 'src-tauri/target/msix'
if (-not $Out) { $Out = Join-Path $release "PeriphHub_$($conf.version)_x64.msix" }

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'Assets'), (Join-Path $stage 'resources') | Out-Null

# Même disposition que l'installeur NSIS : programme + resources/headsetcontrol.exe
Copy-Item (Join-Path $release 'periphhub.exe') $stage
Copy-Item (Join-Path $root 'src-tauri/resources/headsetcontrol.exe') (Join-Path $stage 'resources')

# Logos demandés par Windows, tirés de l'icône de l'appli
$src = [System.Drawing.Image]::FromFile((Join-Path $root 'src-tauri/icons/icon.png'))
function Save-Logo([string]$name, [int]$w, [int]$h, [double]$scale) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $side = [int]([Math]::Min($w, $h) * $scale)
  $g.DrawImage($src, [int](($w - $side) / 2), [int](($h - $side) / 2), $side, $side)
  $g.Dispose()
  $bmp.Save((Join-Path $stage "Assets/$name"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
Save-Logo 'StoreLogo.png' 50 50 1.0
Save-Logo 'Square44x44Logo.png' 44 44 1.0
Save-Logo 'Square150x150Logo.png' 150 150 0.66
Save-Logo 'Wide310x150Logo.png' 310 150 0.66
$src.Dispose()

$manifest = Get-Content (Join-Path $root 'packaging/msix/AppxManifest.xml') -Raw -Encoding utf8
$manifest = $manifest.Replace('{IDENTITY_NAME}', $IdentityName).Replace('{PUBLISHER}', [Security.SecurityElement]::Escape($Publisher)).
  Replace('{PUBLISHER_NAME}', [Security.SecurityElement]::Escape($PublisherName)).Replace('{VERSION}', $version)
[IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, (New-Object Text.UTF8Encoding $false))

# makeappx du SDK Windows (présent sur les machines GitHub Actions)
$makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe introuvable : installez le SDK Windows' }
if (Test-Path $Out) { Remove-Item $Out }
& $makeappx.FullName pack /d $stage /p $Out /o | Out-Host
if ($LASTEXITCODE -ne 0) { throw "makeappx a échoué ($LASTEXITCODE)" }
Write-Host "Paquet MSIX : $Out ($version, $IdentityName)"
