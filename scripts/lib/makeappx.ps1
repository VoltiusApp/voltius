<#
.SYNOPSIS
  Locates makeappx.exe from the installed Windows SDK.

.DESCRIPTION
  Dot-source this from any script that packs or bundles an MSIX:

    . "$PSScriptRoot/lib/makeappx.ps1"
    $makeappx = Get-MakeAppxPath
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
