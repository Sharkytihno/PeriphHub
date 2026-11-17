# Télécharge le module casques (HeadsetControl, GPL-3.0) dans src-tauri/resources et vérifie son
# empreinte. À lancer une fois avant de compiler (la CI le fait aussi). Changer de version :
# mettre à jour $Version et $Sha256 ici ET dans src-tauri/src/headset.rs (VERSION, SHA256).
$ErrorActionPreference = 'Stop'
$Version = '4.3.0'
$Sha256 = 'e371da043710ddb8fc70af77f2ccad1cd03f8c6f49ba423e08764ad7a94a3c40'

$dest = Join-Path $PSScriptRoot '..\src-tauri\resources\headsetcontrol.exe'
New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
if ((Test-Path $dest) -and (Get-FileHash $dest -Algorithm SHA256).Hash -eq $Sha256) {
  Write-Host "HeadsetControl $Version déjà présent"
  exit 0
}
$url = "https://github.com/Sapd/HeadsetControl/releases/download/$Version/headsetcontrol-windows-x86_64.exe"
Invoke-WebRequest $url -OutFile $dest -UseBasicParsing
$hash = (Get-FileHash $dest -Algorithm SHA256).Hash
if ($hash -ne $Sha256) {
  Remove-Item $dest
  throw "Empreinte inattendue pour HeadsetControl $Version : $hash"
}
Write-Host "HeadsetControl $Version téléchargé et vérifié"
