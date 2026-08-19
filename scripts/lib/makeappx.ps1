<#
.SYNOPSIS
  Shared helpers for the MSIX pack and bundle scripts.

.DESCRIPTION
  Dot-source this from any script that packs or bundles an MSIX:

    . "$PSScriptRoot/lib/makeappx.ps1"
    $makeappx = Get-MakeAppxPath
    $version = Get-MsixVersion
#>

function Get-MakeAppxPath {
  # The SDK installs one copy per version; the newest wins.
  $makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    Select-Object -Last 1

  if (-not $makeappx) {
    throw "makeappx.exe not found. Install the Windows 10/11 SDK."
  }

  return $makeappx.FullName
}

function Get-MsixVersion {
  # MSIX versions are 4-part and the Store requires the revision to be 0. The
  # package and the bundle must carry the same one, so both scripts read it here.
  # Relative to the repository root, which every caller has pushed into.
  $conf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
  return "$($conf.version).0"
}
