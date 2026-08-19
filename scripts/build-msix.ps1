<#
.SYNOPSIS
  Packs an already-built Voltius binary into an .msix for the Microsoft Store.

.DESCRIPTION
  The Store re-signs MSIX packages itself, which is the whole reason this path
  exists: it needs no code-signing certificate, whereas submitting the NSIS .exe
  would require one that chains to the Microsoft Trusted Root Program.

  Run `pnpm tauri build` first. The payload is just voltius.exe — the seeded
  plugins are compiled into the binary (see src-tauri/build.rs), so there is no
  resource tree to copy.

  IDENTITY_NAME / PUBLISHER / PUBLISHER_DISPLAY_NAME come from Partner Center
  once the app name is reserved. The defaults below build a package that can be
  installed locally with a self-signed certificate, but Partner Center rejects a
  submission whose identity does not match the reservation exactly.

.PARAMETER Arch
  x64 or arm64. Must match the binary in -ExePath.

.EXAMPLE
  pnpm tauri build
  ./scripts/build-msix.ps1 -Arch x64
#>
[CmdletBinding()]
param(
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',

  [string]$ExePath = "src-tauri/target/release/voltius.exe",

  [string]$OutDir = "target/msix",

  [string]$IdentityName = $(if ($env:MSIX_IDENTITY_NAME) { $env:MSIX_IDENTITY_NAME } else { "Voltius.Voltius" }),

  [string]$Publisher = $(if ($env:MSIX_PUBLISHER) { $env:MSIX_PUBLISHER } else { "CN=Voltius" }),

  [string]$PublisherDisplayName = $(if ($env:MSIX_PUBLISHER_DISPLAY_NAME) { $env:MSIX_PUBLISHER_DISPLAY_NAME } else { "Voltius" })
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  if (-not (Test-Path $ExePath)) {
    throw "$ExePath not found. Run 'pnpm tauri build' first."
  }

  # MSIX versions are 4-part and the Store requires the revision to be 0.
  $conf = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
  $version = "$($conf.version).0"

  $layout = Join-Path $OutDir "layout-$Arch"
  if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
  New-Item -ItemType Directory -Path (Join-Path $layout "Assets") -Force | Out-Null

  Copy-Item $ExePath (Join-Path $layout "voltius.exe")

  # `tauri icon` already emits the whole Appx logo set.
  $logos = @(
    'Square44x44Logo.png',
    'Square71x71Logo.png',
    'Square150x150Logo.png',
    'Square310x310Logo.png',
    'StoreLogo.png'
  )
  foreach ($logo in $logos) {
    Copy-Item (Join-Path "src-tauri/icons" $logo) (Join-Path $layout "Assets/$logo")
  }

  $manifest = Get-Content "packaging/msix/AppxManifest.xml" -Raw
  $manifest = $manifest.
    Replace('{{IDENTITY_NAME}}', $IdentityName).
    Replace('{{PUBLISHER}}', $Publisher).
    Replace('{{PUBLISHER_DISPLAY_NAME}}', $PublisherDisplayName).
    Replace('{{VERSION}}', $version).
    Replace('{{ARCH}}', $Arch)
  Set-Content -Path (Join-Path $layout "AppxManifest.xml") -Value $manifest -Encoding UTF8

  # makeappx ships with the Windows SDK; the newest installed version wins.
  $makeappx = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName |
    Select-Object -Last 1
  if (-not $makeappx) {
    throw "makeappx.exe not found. Install the Windows 10/11 SDK."
  }

  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  $msix = Join-Path $OutDir "Voltius_${version}_$Arch.msix"
  if (Test-Path $msix) { Remove-Item $msix -Force }

  & $makeappx.FullName pack /d $layout /p $msix /o
  if ($LASTEXITCODE -ne 0) { throw "makeappx failed with exit code $LASTEXITCODE" }

  Write-Host "Built $msix"
  Write-Host "Unsigned by design — the Store signs it on submission. To install it"
  Write-Host "locally for testing, sign it first with a self-signed certificate whose"
  Write-Host "subject matches Publisher ('$Publisher') and trust that certificate."
}
finally {
  Pop-Location
}
