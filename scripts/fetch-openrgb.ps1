# Télécharge OpenRGB (GPL-2.0, version portable officielle) dans src-tauri/resources/openrgb et
# vérifie son empreinte. À lancer une fois avant de compiler (la CI le fait aussi). Changer de version :
# mettre à jour $Version, $Url et $Sha256 ici ET la table FILES de src-tauri/src/openrgb.rs
# (empreinte de chaque fichier, vérifiée avant chaque lancement).
$ErrorActionPreference = 'Stop'
$Version = '1.1'
$Url = 'https://codeberg.org/OpenRGB/OpenRGB/releases/download/release_1.1/OpenRGB_1.1_Windows_64_8e16de2.zip'
$Sha256 = '63291726c6fc84eb479ef2ee752e97e1187f6ce9c49fd27eee40ded588a8172a'

# PawnIO (pilote signé qui donne à OpenRGB l'accès à la mémoire et aux puces de la carte mère) :
# son installeur officiel est livré tel quel, lancé seulement quand l'utilisateur active la mémoire.
# Changer de version : $PawnVersion, $PawnSha256 ici ET PAWNIO_SHA256 dans src-tauri/src/openrgb.rs.
$PawnVersion = '2.2.0'
$PawnSha256 = '1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032'
$pawn = Join-Path $PSScriptRoot '..\src-tauri\resources\PawnIO_setup.exe'
if (-not ((Test-Path $pawn) -and (Get-FileHash $pawn -Algorithm SHA256).Hash -eq $PawnSha256)) {
  Invoke-WebRequest "https://github.com/namazso/PawnIO.Setup/releases/download/$PawnVersion/PawnIO_setup.exe" -OutFile $pawn -UseBasicParsing
  $h = (Get-FileHash $pawn -Algorithm SHA256).Hash
  if ($h -ne $PawnSha256) { Remove-Item $pawn; throw "Empreinte inattendue pour PawnIO $PawnVersion : $h" }
  Write-Host "PawnIO $PawnVersion téléchargé et vérifié"
}

$dest = Join-Path $PSScriptRoot '..\src-tauri\resources\openrgb'
$stamp = Join-Path $dest '.version'
if ((Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $Sha256) {
  Write-Host "OpenRGB $Version déjà présent"
  exit 0
}
$zip = Join-Path ([System.IO.Path]::GetTempPath()) "openrgb-$Version.zip"
Invoke-WebRequest $Url -OutFile $zip -UseBasicParsing
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
if ($hash -ne $Sha256) {
  Remove-Item $zip
  throw "Empreinte inattendue pour OpenRGB $Version : $hash"
}
# Le zip contient un seul dossier (« OpenRGB Windows 64-bit ») : son contenu va dans resources/openrgb
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "openrgb-$Version"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Move-Item $inner.FullName $dest
Set-Content $stamp $Sha256 -NoNewline
Remove-Item $zip, $tmp -Recurse -Force
Write-Host "OpenRGB $Version téléchargé et vérifié"
