param(
  [string]$VoltiusTag = 'latest',
  [switch]$Competitors,
  [int]$IdleSeconds = 90,
  [string]$OutDir = 'perf-out'
)
$ErrorActionPreference = 'Continue'
$dl = Join-Path $env:RUNNER_TEMP 'perf-dl'
New-Item -ItemType Directory -Force $dl, $OutDir | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$gh = @{ 'User-Agent' = 'voltius-perf'; Authorization = "Bearer $env:GITHUB_TOKEN" }

function Fetch($url, $name) { $p = Join-Path $dl $name; Invoke-WebRequest -Uri $url -OutFile $p -UseBasicParsing; $p }
function Release-Asset($repo, $tag, $pattern) {
  $path = if ($tag -eq 'latest') { "releases/latest" } else { "releases/tags/$tag" }
  $rel = Invoke-RestMethod -Headers $gh "https://api.github.com/repos/$repo/$path"
  $asset = $rel.assets | Where-Object name -match $pattern | Select-Object -First 1
  if (-not $asset) { throw "no asset matching $pattern in $repo $($rel.tag_name)" }
  @{ url = $asset.browser_download_url; name = $asset.name; version = $rel.tag_name }
}
function Find-Exe($name, $roots) {
  Get-ChildItem -Path $roots -Recurse -Filter "$name.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch 'uninst|Update\.exe|\\resources\\' -and $_.DirectoryName -ne $dl } |
    Select-Object -First 1 -ExpandProperty FullName
}
function Tree-Ids($rootId) {
  $all = Get-CimInstance Win32_Process
  $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add($rootId); $i = 0
  while ($i -lt $ids.Count) {
    foreach ($c in ($all | Where-Object ParentProcessId -eq $ids[$i])) { if (-not $ids.Contains([int]$c.ProcessId)) { $ids.Add([int]$c.ProcessId) } }
    $i++
  }
  $ids
}
function Measure-Tree($rootId) {
  $ids = Tree-Ids $rootId
  $perf = Get-CimInstance Win32_PerfRawData_PerfProc_Process | Where-Object { $ids -contains [int]$_.IDProcess }
  [pscustomobject]@{
    procs = @($perf).Count
    privateWsMB = [math]::Round((($perf | Measure-Object WorkingSetPrivate -Sum).Sum) / 1MB)
    wsMB = [math]::Round((($perf | Measure-Object WorkingSet -Sum).Sum) / 1MB)
  }
}
function Shot($file) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save($file); $g.Dispose(); $bmp.Dispose()
}
function Kill-Name($n) { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
function Install-Nsis($repo, $tag, $pattern, $exeName) {
  $a = Release-Asset $repo $tag $pattern
  Start-Process (Fetch $a.url $a.name) '/S' -Wait
  @{ name = "$($repo.Split('/')[1]) $($a.version)"; exe = (Find-Exe $exeName $roots); proc = $exeName }
}

$roots = @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})
$apps = @(Install-Nsis 'VoltiusApp/voltius' $VoltiusTag '_x64-setup\.exe$' 'voltius')

if ($Competitors) {
  $apps += Install-Nsis 'alexandrosnt/Reach' 'latest' '_x64-setup\.exe$' 'reach'
  $apps += Install-Nsis 'Termix-SSH/Termix' 'latest' 'windows_x64_nsis\.exe$' 'termix'
  $a = Release-Asset 'Eugeny/tabby' 'latest' 'portable-x64\.zip$'
  Expand-Archive (Fetch $a.url $a.name) (Join-Path $dl 'tabby') -Force
  $apps += @{ name = "tabby $($a.version)"; exe = (Find-Exe 'tabby' @(Join-Path $dl 'tabby')); proc = 'tabby' }
  # Termius only publishes a moving "latest" installer; it launches itself after installing.
  Start-Process (Fetch 'https://download.termius.com/windows/Install%20Termius.exe' 'termius-setup.exe') '/S' -Wait
  Start-Sleep 20; Kill-Name 'Termius'
  $exe = Find-Exe 'Termius' @("$env:LOCALAPPDATA\Programs", $env:ProgramFiles)
  $ver = if ($exe) { (Get-Item $exe).VersionInfo.ProductVersion } else { '?' }
  $apps += @{ name = "Termius $ver"; exe = $exe; proc = 'Termius' }
}

$rows = @()
foreach ($a in $apps) {
  Write-Host "== $($a.name): $($a.exe)"
  if (-not $a.exe) { $rows += [pscustomobject]@{ app = $a.name; privateWsMB = 'not installed' }; continue }
  Kill-Name $a.proc; Start-Sleep 3
  $proc = Start-Process $a.exe -PassThru
  $samples = @()
  $step = [math]::Max(10, [math]::Floor($IdleSeconds / 3))
  for ($t = $step; $t -le $IdleSeconds; $t += $step) {
    Start-Sleep $step
    $m = Measure-Tree $proc.Id; $samples += $m
    Write-Host ("  t={0}s procs={1} privateWS={2}MB WS={3}MB" -f $t, $m.procs, $m.privateWsMB, $m.wsMB)
  }
  Shot (Join-Path $OutDir (($a.name -replace '[^\w]', '_') + '.png'))
  $dir = Split-Path $a.exe
  $last = $samples[-1]
  $rows += [pscustomobject]@{
    app = $a.name
    privateWsMB = $last.privateWsMB
    wsMB = $last.wsMB
    peakPrivateWsMB = ($samples | Measure-Object privateWsMB -Maximum).Maximum
    procs = $last.procs
    installMB = [math]::Round(((Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1MB)
  }
  foreach ($id in (Tree-Ids $proc.Id)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Kill-Name $a.proc; Start-Sleep 5
}

$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$rows | ConvertTo-Json | Set-Content (Join-Path $OutDir 'results.json')
if ($env:GITHUB_STEP_SUMMARY) {
  $md = @("## Idle memory after ${IdleSeconds}s, cold start", '',
    '| App | Private working set | Working set | Peak private | Processes | Install folder |',
    '| --- | --- | --- | --- | --- | --- |')
  $md += $rows | ForEach-Object { "| $($_.app) | $($_.privateWsMB) MB | $($_.wsMB) MB | $($_.peakPrivateWsMB) MB | $($_.procs) | $($_.installMB) MB |" }
  $md += '', 'Private working set is the Task Manager figure, summed over the app and its child processes (WebView2 included). Install folder excludes the shared WebView2 runtime.'
  $md -join "`n" | Add-Content $env:GITHUB_STEP_SUMMARY
}
