# Pixel Rig - install script
#
# Copies dist/<id>/ into the skin root scanned by Skin Center
# (default ~/.dsh/skins/). It only ADDS directories and never touches
# settings; a skin is never auto-enabled - apply it manually via
# Settings -> Skin Center.
#
# IMPORTANT: keep this file ASCII-only. Windows PowerShell 5.1 reads
# extensionless/BOM-less .ps1 as the ANSI codepage and would mangle CJK text.
#
# Usage:
#   powershell -File tools/install.ps1               install every built skin
#   powershell -File tools/install.ps1 pixel-amber   install one skin by id
#   powershell -File tools/install.ps1 -WhatIfOnly   print actions only

[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Id = '',
  [switch]$WhatIfOnly
)

$ErrorActionPreference = 'Stop'

$distRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'
if (-not (Test-Path $distRoot)) { throw "No build output at: $distRoot" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$skinRoot = Join-Path $dshHome 'skins'

$sources = Get-ChildItem $distRoot -Directory | Where-Object { $Id -eq '' -or $_.Name -eq $Id }
if ($sources.Count -eq 0) { throw "No built skin matched Id='$Id'" }

Write-Host "Skin root: $skinRoot"
if (-not (Test-Path $skinRoot)) {
  Write-Host "  does not exist yet; creating it"
  if (-not $WhatIfOnly) { New-Item -ItemType Directory -Force -Path $skinRoot | Out-Null }
}

foreach ($src in $sources) {
  $dst = Join-Path $skinRoot $src.Name
  $files = @(Get-ChildItem $src.FullName -Recurse -File)
  $bytes = ($files | Measure-Object -Property Length -Sum).Sum
  Write-Host ("  install {0}  ({1} files, {2:N2} MB)  ->  {3}" -f $src.Name, $files.Count, ($bytes / 1MB), $dst)

  if ($WhatIfOnly) { continue }
  if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $dst -Recurse -Force
}

if ($WhatIfOnly) {
  Write-Host '(-WhatIfOnly: nothing was modified)'
} else {
  Write-Host ''
  Write-Host 'Done. Open Settings -> Skin Center and reopen the card; then apply manually.'
}