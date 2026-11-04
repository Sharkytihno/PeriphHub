# Notes d'une version : la section « ## x.y.z » de CHANGELOG.md, jusqu'à la suivante.
# Usage : ./scripts/release-notes.ps1 1.0.0   (vide si la section n'existe pas)
param([Parameter(Mandatory)][string]$Version)
$file = Join-Path $PSScriptRoot '..\CHANGELOG.md'
if (-not (Test-Path $file)) { return '' }
$in = $false
$out = New-Object System.Collections.Generic.List[string]
foreach ($l in Get-Content $file -Encoding utf8) {
  if ($l -match '^## ') {
    if ($in) { break }
    $in = ($l.Trim() -eq "## $($Version.TrimStart('v'))")
    continue
  }
  if ($in) { $out.Add($l) }
}
($out -join "`n").Trim()
