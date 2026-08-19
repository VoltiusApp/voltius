<#
.SYNOPSIS
  Bundles the per-architecture .msix packages into one .msixbundle.

.DESCRIPTION
  A Store listing serves one artifact per architecture from a single bundle, and
  `msstore publish` takes exactly one path — so the x64 and arm64 packages built
  by build-msix.ps1 have to be bundled before submission.

.PARAMETER InDir
  Directory holding the .msix files to bundle. Anything else in it is ignored.

.EXAMPLE
  ./scripts/bundle-msix.ps1 -InDir target/msix
#>
[CmdletBinding()]
param(
  [string]$InDir = "target/msix",
  [string]$OutDir = "target/msix"
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  $packages = @(Get-ChildItem (Join-Path $InDir "*.msix") -ErrorAction SilentlyContinue)
  if ($packages.Count -eq 0) {
    throw "No .msix packages in $InDir. Run build-msix.ps1 first."
  }

  # makeappx bundles every .msix in the directory it is given, so stage exactly
  # the packages and nothing else.
  $staging = Join-Path $OutDir "bundle-staging"
  if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  $packages | ForEach-Object { Copy-Item $_.FullName $staging }

  . "$PSScriptRoot/lib/makeappx.ps1"
  $makeappx = Get-MakeAppxPath
  $version = Get-MsixVersion

  $bundle = Join-Path $OutDir "Voltius_$version.msixbundle"
  if (Test-Path $bundle) { Remove-Item $bundle -Force }

  # /bv is not optional: without it makeappx stamps the bundle identity with the
  # current date-time (2026.819.1209.0) instead of the app version. Store
  # versions only ever move forward, so one submission at a date-derived version
  # would lock the listing out of every semantic version for good.
  & $makeappx bundle /bv $version /d $staging /p $bundle /o
  if ($LASTEXITCODE -ne 0) { throw "makeappx bundle failed with exit code $LASTEXITCODE" }

  Remove-Item $staging -Recurse -Force
  Write-Host "Bundled $($packages.Count) package(s) into $bundle"
}
finally {
  Pop-Location
}
