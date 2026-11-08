# Module capteurs (températures, ventilateurs) : télécharge LibreHardwareMonitorLib 0.9.6 (MPL-2.0) et
# ses dépendances depuis nuget.org, vérifie l'empreinte de chaque paquet, puis compile
# sensors/PeriphHubSensors.cs avec le compilateur C# livré dans Windows (.NET Framework 4.8, pas de SDK).
# Résultat : src-tauri/resources/sensors/ (hors git). À lancer avant de compiler (la CI le fait aussi).
# src-tauri/build.rs relève l'empreinte de chaque fichier produit : l'installation du service
# (src-tauri/src/sensors.rs) refuse tout fichier différent.
# Changer de version : $Packages ci-dessous (nom, version, empreinte du .nupkg, dossier de la DLL).
$ErrorActionPreference = 'Stop'
$Packages = @(
  @('LibreHardwareMonitorLib', '0.9.6', '60db5e0d9135f4658b385cae139d3b9eaeac0a8e867d322d20b5dbe4c4039197', 'runtimes/win-x64/lib/net472'),
  @('DiskInfoToolkit', '1.1.2', 'a997f0b3701e20b2ab9296e07ee4f74f877e75015277fb6bd314ade1e2c4db13', 'lib/net472'),
  @('HidSharp', '2.6.4', 'cf55d4b4d7b42dc1d8496b7b592ba00d1ecd48a70bc07bd8dabd3e9976d108e7', 'lib/netstandard2.0'),
  @('RAMSPDToolkit-NDD', '1.4.2', '57c893824a68c71538055f242586616d4205a671c300897c21b2a6f88270ce64', 'lib/net472'),
  @('BlackSharp.Core', '1.0.7', '4f713fe18ee7c85a7c49f28309adaa815714333326aa81fd4d4a81619ecaa0ab', 'lib/net472'),
  @('System.Memory', '4.6.3', '26078aeb758c9ae985e8bf851f973026061da6a5eb4837204d0c2d2204c72955', 'lib/net462'),
  @('System.Buffers', '4.6.1', 'b00451e91d016fbec091ad1e361f3a7015e1d91d4047f7e48a74455b2a673d79', 'lib/net462'),
  @('System.Numerics.Vectors', '4.6.1', '2bc500a86dcb02f2032d6d877f9e2d6e9e4a79080e57239b4198679d4031f2c7', 'lib/net462'),
  @('System.Runtime.CompilerServices.Unsafe', '6.1.2', '5f6a7f53af3465f92beb6da873ebe0e496206c313313b98badee4355a6b25937', 'lib/net462')
)
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'sensors\PeriphHubSensors.cs'
$dest = Join-Path $root 'src-tauri\resources\sensors'
# Déjà à jour : mêmes paquets et même source
$want = (($Packages | ForEach-Object { $_[2] }) -join ',') + ',' + (Get-FileHash $src -Algorithm SHA256).Hash
$stamp = Join-Path $dest '.version'
if ((Test-Path (Join-Path $dest 'PeriphHubSensors.exe')) -and (Test-Path $stamp) -and (Get-Content $stamp -Raw).Trim() -eq $want) {
  Write-Host 'Module capteurs déjà présent'
  exit 0
}
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) 'periphhub-sensors'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force $tmp | Out-Null
foreach ($p in $Packages) {
  $name, $ver, $sha, $lib = $p
  $pkg = Join-Path $tmp "$name.$ver.zip"
  Invoke-WebRequest "https://www.nuget.org/api/v2/package/$name/$ver" -OutFile $pkg -UseBasicParsing
  $h = (Get-FileHash $pkg -Algorithm SHA256).Hash
  if ($h -ne $sha) { throw "Empreinte inattendue pour $name $ver : $h" }
  $x = Join-Path $tmp $name
  Expand-Archive $pkg $x
  Copy-Item (Join-Path $x "$lib\*.dll") $dest
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc -nologo -optimize+ -platform:x64 -target:exe "-out:$(Join-Path $dest 'PeriphHubSensors.exe')" `
  "-r:$(Join-Path $dest 'LibreHardwareMonitorLib.dll')" -r:System.ServiceProcess.dll -r:System.Core.dll $src
if ($LASTEXITCODE) { throw "Compilation du module capteurs impossible ($LASTEXITCODE)" }
Remove-Item $tmp -Recurse -Force
Set-Content $stamp $want -Encoding ascii -NoNewline
Write-Host "Module capteurs prêt : $((Get-ChildItem $dest -Filter *.dll).Count) bibliothèques + PeriphHubSensors.exe"
