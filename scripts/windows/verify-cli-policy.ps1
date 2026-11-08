param(
    [Parameter(Mandatory)][string]$Nsis,
    [Parameter(Mandatory)][string]$Msi
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version 3.0

$Work = 'C:\Users\Public\voltius-verify'
$Logs = Join-Path $Work 'logs'
$Fixtures = Join-Path $Work 'fixtures'
$Scratch = Join-Path $Work 'scratch'
$ProgramData = 'C:\ProgramData'
$PolicyDir = Join-Path $ProgramData 'Voltius'
$PolicyFile = Join-Path $PolicyDir 'policy.json'
$NsisDir = Join-Path $env:LOCALAPPDATA 'Voltius'
$StdName = 'voltius-std'
$EvilFixture = Join-Path $Fixtures 'evil.json'
$ReviewedFixture = Join-Path $Fixtures 'reviewed.json'
$HolderScript = Join-Path $Work 'holder.ps1'
$EnvKeys = @{
    User    = 'HKCU:\Environment'
    Machine = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
}
$TaskPending = 0x41301, 0x41303
$DllInitFailed = -1073741502
$HardenedRules = (@('S-1-5-18:Allow:0x1F01FF', 'S-1-5-32-544:Allow:0x1F01FF', 'S-1-5-32-545:Allow:0x1200A9') | Sort-Object) -join ','

$script:Scenario = 'setup'
$script:Seq = 0
$script:Holders = [System.Collections.Generic.List[object]]::new()
$script:UserCreated = $false
$script:MsiDir = $null

function Show-PolicyAcl {
    foreach ($path in $PolicyDir, $PolicyFile) {
        if (Test-Path -LiteralPath $path) { icacls $path | Out-Host }
    }
    Get-ChildItem -LiteralPath $ProgramData -Force -Filter 'Voltius*' | Format-Table Name, Attributes | Out-Host
}

function Assert-True([string]$Id, [bool]$Condition, [string]$Observed, [string]$Expected = 'true', [string]$Detail = '') {
    if ($Condition) {
        Write-Host "PASS $Id $Observed"
        return
    }
    Write-Host "FAIL $Id $Expected $Observed"
    if ($Detail) { Write-Host $Detail }
    Show-PolicyAcl
    throw "FAIL $Id"
}

function Assert-Code([string]$Id, [long[]]$Expected, $Result) {
    Assert-True $Id ($Result.Code -in $Expected) "code=$($Result.Code)" "code=$($Expected -join ',')" "stdout: $($Result.Out)`nstderr: $($Result.Err)"
}

function Wait-Until([int]$Seconds, [scriptblock]$Condition) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 250
    }
    [bool](& $Condition)
}

function Get-RegistryPath([ValidateSet('User', 'Machine')][string]$Scope) {
    ConvertTo-Text (Get-Item -LiteralPath $EnvKeys[$Scope]).GetValue('Path', '', 'DoNotExpandEnvironmentNames')
}

function Update-SessionPath {
    $env:Path = [Environment]::ExpandEnvironmentVariables((Get-RegistryPath Machine) + ';' + (Get-RegistryPath User))
}

function ConvertTo-PathKey([string]$Entry) {
    $Entry.Trim().TrimEnd('\').ToLowerInvariant()
}

function Test-PathEntry([string]$Raw, [string]$Dir) {
    $want = ConvertTo-PathKey $Dir
    @($Raw -split ';' | Where-Object { (ConvertTo-PathKey $_) -eq $want }).Count -gt 0
}

function Assert-PathEntry([string]$Id, [string]$Scope, [string]$Dir, [bool]$Present) {
    $raw = Get-RegistryPath $Scope
    $found = Test-PathEntry $raw $Dir
    Assert-True $Id ($found -eq $Present) "present=$found" "present=$Present" "$Scope Path: $raw"
}

function Resolve-Cli {
    Update-SessionPath
    $cmd = Get-Command voltius-cli -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $cmd.Source } else { $null }
}

function Assert-Installed([string]$Id, [string]$Dir) {
    $cli = Join-Path $Dir 'voltius-cli.exe'
    Assert-True "$Id.installed" (Test-Path -LiteralPath $cli) $cli
    $resolved = Resolve-Cli
    $got = if ($resolved) { Split-Path -Parent $resolved } else { '<not found>' }
    Assert-True "$Id.resolves" ((ConvertTo-PathKey $got) -eq (ConvertTo-PathKey $Dir)) $got $Dir
}

function Join-CommandLine([string[]]$Parts) {
    ($Parts | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
}

function New-LogBase([string]$Who) {
    $script:Seq++
    Join-Path $Logs ('{0:D3}-{1}-{2}' -f $script:Seq, $script:Scenario, $Who)
}

function ConvertTo-Text($Value) {
    if ($null -eq $Value) { '' } else { [string]$Value }
}

function Read-Log([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
    ConvertTo-Text (Get-Content -LiteralPath $Path -Raw)
}

function Read-Result([string]$Who, [string]$Line, $Code, [string]$Base) {
    if ($null -eq $Code) { throw "[$Who] returned no exit code: $Line" }
    $result = [pscustomobject]@{
        Code = [long]$Code
        Out  = Read-Log $(if ($Base) { "$Base.out" })
        Err  = Read-Log $(if ($Base) { "$Base.err" })
    }
    Write-Host "  [$Who] $Line -> $($result.Code)"
    if ($result.Err.Trim()) { Write-Host "    stderr: $($result.Err.Trim())" }
    if ($result.Code -eq $DllInitFailed) {
        throw "[$Who] STATUS_DLL_INIT_FAILED: the logon cannot reach this window station; switch Invoke-AsUser to Invoke-ViaTask"
    }
    $result
}

function New-StartArgs([string]$Base, [string]$FilePath, [string]$ArgumentList, [pscredential]$Credential) {
    $start = @{
        FilePath               = $FilePath
        ArgumentList           = $ArgumentList
        WorkingDirectory       = $Work
        RedirectStandardOutput = "$Base.out"
        RedirectStandardError  = "$Base.err"
    }
    # Without -UseNewEnvironment the user inherits this session's environment (PATH, TEMP, profile dirs).
    if ($Credential) { $start += @{ Credential = $Credential; LoadUserProfile = $true; UseNewEnvironment = $true } }
    else { $start.NoNewWindow = $true }
    $start
}

function Start-Tracked([hashtable]$Start) {
    $process = Start-Process @Start -PassThru
    if (-not $process) { throw "did not start: $($Start.FilePath) $($Start.ArgumentList)" }
    # Open the handle now; a PID-only Process loses ExitCode once a short-lived child has exited.
    $null = $process.Handle
    $process
}

function Wait-Exit($Process, [string]$Line, [int]$Seconds) {
    if (-not $Process.WaitForExit($Seconds * 1000)) {
        taskkill /pid $Process.Id /t /f | Out-Host
        throw "timed out after $Seconds s and killed: $Line"
    }
    $Process.ExitCode
}

function Invoke-Process([string]$Who, [string]$Line, [pscredential]$Credential) {
    $base = New-LogBase $Who
    $start = New-StartArgs $base $env:ComSpec "/d /s /c `"$Line`"" $Credential
    $code = Wait-Exit (Start-Tracked $start) "[$Who] $Line" 120
    Read-Result $Who $Line $code $base
}

function Invoke-ViaTask([string]$Who, [string]$Line, [hashtable]$Principal) {
    $base = New-LogBase $Who
    $name = "voltius-verify-$([guid]::NewGuid().ToString('N'))"
    $action = New-ScheduledTaskAction -Execute $env:ComSpec -WorkingDirectory $Work `
        -Argument "/d /s /c `"$Line > `"$base.out`" 2> `"$base.err`"`""
    Register-ScheduledTask -TaskName $name -Action $action @Principal -Force | Out-Null
    try {
        Start-ScheduledTask -TaskName $name
        $done = Wait-Until 180 {
            (Get-ScheduledTask -TaskName $name).State -eq 'Ready' -and
            (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult -notin $TaskPending
        }
        if (-not $done) {
            Stop-ScheduledTask -TaskName $name
            throw "[$Who] scheduled task did not finish within 180 s: $Line"
        }
        Read-Result $Who $Line (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult $base
    }
    finally {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
}

function Invoke-AsUser {
    param([Parameter(Position = 0)][string[]]$ArgumentList, [switch]$Cli)
    Invoke-Process 'user' (Join-CommandLine (@(if ($Cli) { 'voltius-cli' }) + $ArgumentList)) $StdCred
}

function Invoke-AsAdmin([string[]]$ArgumentList) {
    Update-SessionPath
    Invoke-Process 'admin' (Join-CommandLine (@('voltius-cli') + $ArgumentList))
}

function Invoke-AsSystem([string[]]$ArgumentList) {
    $cli = Resolve-Cli
    if (-not $cli) { throw 'voltius-cli is not on PATH for the SYSTEM run' }
    Invoke-ViaTask 'system' (Join-CommandLine (@($cli) + $ArgumentList)) @{ User = 'NT AUTHORITY\SYSTEM'; RunLevel = 'Highest' }
}

function Invoke-Installer([string]$File, [string[]]$ArgumentList) {
    $line = "$File $ArgumentList"
    $code = Wait-Exit (Start-Tracked @{ FilePath = $File; ArgumentList = $ArgumentList }) $line 600
    Read-Result 'installer' $line $code ''
}

function Start-Holder([string]$Path, [ValidateSet('File', 'Dir')][string]$Kind) {
    $base = New-LogBase "holder-$Kind"
    $signal = Join-Path $Scratch ('holder-{0}' -f $script:Seq)
    $pwsh = Join-Path $PSHOME 'pwsh.exe'
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$HolderScript`" -Path `"$Path`" -Kind $Kind -Signal `"$signal`""
    $start = New-StartArgs $base $pwsh $arguments $StdCred
    $proc = Start-Tracked $start
    $script:Holders.Add([pscustomobject]@{ Process = $proc; Signal = $signal })
    $ready = Wait-Until 120 { (Test-Path -LiteralPath "$signal.ready") -or $proc.HasExited }
    if (-not $ready -or $proc.HasExited) {
        throw "holder for $Path did not start: $(Read-Log "$base.err")"
    }
    Write-Host "  [holder] $Kind $Path held by pid $($proc.Id)"
}

function Stop-AllHolders {
    foreach ($holder in $script:Holders) {
        New-Item -ItemType File -Force -Path "$($holder.Signal).release" | Out-Null
        if (-not $holder.Process.WaitForExit(30000)) { Stop-Process -Id $holder.Process.Id -Force }
    }
    $script:Holders.Clear()
}

function Join-Names([object[]]$Items) {
    (@($Items) | ForEach-Object FullName) -join ', '
}

function Get-PolicyEntries {
    Get-ChildItem -LiteralPath $ProgramData -Force -Filter 'Voltius*'
}

function Get-UntrustedDirs {
    Get-ChildItem -LiteralPath $ProgramData -Force -Directory -Filter 'Voltius.untrusted-*'
}

function Reset-PolicyState {
    Stop-AllHolders
    foreach ($item in Get-PolicyEntries) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            cmd /d /c rmdir "$($item.FullName)" | Out-Host
            continue
        }
        takeown /f $item.FullName /r /d y | Out-Null
        icacls $item.FullName /reset /t /c /q | Out-Null
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
    }
    if (Test-Path -LiteralPath $Scratch) { Remove-Item -LiteralPath $Scratch -Recurse -Force }
    New-Item -ItemType Directory -Path $Scratch | Out-Null
    $left = @(Get-PolicyEntries)
    Assert-True "$script:Scenario.reset" ($left.Count -eq 0) "left=$($left.Count)" 'left=0' (Join-Names $left)
}

function Get-AclSummary([string]$Path) {
    $sid = [System.Security.Principal.SecurityIdentifier]
    $acl = Get-Acl -LiteralPath $Path
    $rules = @($acl.GetAccessRules($true, $true, $sid))
    $aces = @($rules | ForEach-Object { '{0}:{1}:0x{2:X}' -f $_.IdentityReference.Value, $_.AccessControlType, [int]$_.FileSystemRights } | Sort-Object)
    $inherited = @($rules | Where-Object { $_.IsInherited }).Count
    'owner={0} protected={1} inherited={2} rules={3}' -f $acl.GetOwner($sid).Value, $acl.AreAccessRulesProtected, $inherited, ($aces -join ',')
}

function Assert-HardenedAcl([string]$Id, [string]$Path) {
    $want = "owner=S-1-5-32-544 protected=True inherited=0 rules=$HardenedRules"
    $got = Get-AclSummary $Path
    Assert-True $Id ($got -eq $want) $got $want
}

function Get-OwnerSid([string]$Path) {
    (Get-Acl -LiteralPath $Path).GetOwner([System.Security.Principal.SecurityIdentifier]).Value
}

function Get-Layers([string]$Text) {
    $doc = try { ConvertFrom-Json $Text -AsHashtable } catch { $null }
    if ($null -eq $doc) { return "<unparseable: $Text>" }
    $entries = foreach ($layer in 'policy', 'defaults') {
        $map = $doc[$layer]
        if ($map) { foreach ($key in $map.Keys) { "$layer.$key=$(ConvertTo-Json $map[$key] -Compress)" } }
    }
    (@($entries) | Sort-Object) -join ';'
}

function Assert-Layers([string]$Id, [string]$Path, [string]$Fixture) {
    $want = Get-Layers (Read-Log $Fixture)
    $got = Get-Layers (Read-Log $Path)
    Assert-True $Id ($got -eq $want) $got $want
}

function Get-Snapshot([string]$Path) {
    $items = @(Get-Item -LiteralPath $Path -Force)
    if ($items[0].PSIsContainer) { $items += @(Get-ChildItem -LiteralPath $Path -Recurse -Force) }
    ($items | ForEach-Object {
        $hash = if ($_.PSIsContainer) { '-' } else { (Get-FileHash -LiteralPath $_.FullName).Hash }
        '{0}|{1}|{2}' -f $_.FullName, $hash, (Get-Acl -LiteralPath $_.FullName).Sddl
    }) -join "`n"
}

function Assert-Unchanged([string]$Id, [string]$Path, [string]$Before) {
    $after = Get-Snapshot $Path
    Assert-True $Id ($after -eq $Before) $after $Before
}

function Assert-OneUntrusted([string]$Id) {
    $aside = @(Get-UntrustedDirs)
    Assert-True $Id ($aside.Count -eq 1) "count=$($aside.Count)" 'count=1' (Join-Names $aside)
    $aside[0].FullName
}

function Invoke-AdminSet([string]$Value = 'false') {
    Invoke-AsAdmin policy, set, sshConfig.import, $Value
}

function Invoke-UserCheck {
    Invoke-AsUser -Cli policy, check
}

function Set-HardenedPolicy {
    Assert-Code "$script:Scenario.admin-set" 0 (Invoke-AdminSet)
}

function New-UserPolicyDir([switch]$Planted) {
    Assert-Code "$script:Scenario.user-mkdir" 0 (Invoke-AsUser mkdir, $PolicyDir)
    if ($Planted) { Copy-AsUser $EvilFixture $PolicyFile }
}

function Copy-AsUser([string]$From, [string]$To) {
    Assert-Code "$script:Scenario.user-copy" 0 (Invoke-AsUser copy, '/y', $From, $To)
}

function New-StandardUser {
    $classes = 'ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '-_.!@#'
    $all = -join $classes
    $chars = @($classes | ForEach-Object { $_[[Security.Cryptography.RandomNumberGenerator]::GetInt32($_.Length)] })
    $chars += 1..20 | ForEach-Object { $all[[Security.Cryptography.RandomNumberGenerator]::GetInt32($all.Length)] }
    $password = -join $chars
    Write-Host "::add-mask::$password"
    # ADSI instead of `net user`: no password on a command line and no >14-character prompt.
    $computer = [ADSI]"WinNT://$env:COMPUTERNAME,computer"
    $user = $computer.Create('User', $StdName)
    $user.SetPassword($password)
    $user.SetInfo()
    $users = [ADSI]"WinNT://$env:COMPUTERNAME/Users,group"
    $member = "WinNT://$env:COMPUTERNAME/$StdName,user"
    if (-not $users.IsMember($member)) { $users.Add($member) }
    $script:UserCreated = $true
    $script:StdCred = [pscredential]::new($StdName, (ConvertTo-SecureString $password -AsPlainText -Force))
    $script:StdSid = ([System.Security.Principal.NTAccount]$StdName).Translate([System.Security.Principal.SecurityIdentifier]).Value
}

function Initialize-Run {
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
    New-Item -ItemType Directory -Path $Work, $Logs, $Fixtures, $Scratch | Out-Null
    New-StandardUser
    icacls $Work /grant "${StdName}:(OI)(CI)M" | Out-Host
    if ($LASTEXITCODE) { throw "icacls grant on $Work failed: $LASTEXITCODE" }
    [IO.File]::WriteAllText($EvilFixture, '{"version":1,"policy":{"server.url":"https://evil.example"}}')
    [IO.File]::WriteAllText($ReviewedFixture, '{"version":1,"policy":{"sshConfig.import":false}}')
    [IO.File]::WriteAllText($HolderScript, @'
param([string]$Path, [string]$Kind, [string]$Signal)
$ErrorActionPreference = 'Stop'
if ($Kind -eq 'Dir') {
    Add-Type -Namespace VoltiusVerify -Name Native -MemberDefinition @"
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
"@
    # GENERIC_READ, FILE_SHARE_READ|FILE_SHARE_WRITE, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS
    $handle = [VoltiusVerify.Native]::CreateFileW($Path, [uint32]2147483648, 3, [IntPtr]::Zero, 3, 0x02000000, [IntPtr]::Zero)
    if ($handle.IsInvalid) { throw "CreateFileW $Path failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
}
else {
    $handle = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
}
[IO.File]::WriteAllText("$Signal.ready", '')
while (-not (Test-Path -LiteralPath "$Signal.release")) { Start-Sleep -Milliseconds 200 }
$handle.Dispose()
'@)
    Set-Service -Name seclogon -StartupType Manual
    Start-Service -Name seclogon
    $who = Invoke-AsUser whoami
    Assert-Code 'setup.whoami-code' 0 $who
    Assert-True 'setup.whoami' ($who.Out.Trim() -like "*\$StdName") $who.Out.Trim() "*\$StdName"
}

$Scenarios = [ordered]@{
    A  = {
        Assert-Code 'A.install' 0 (Invoke-Installer $Nsis '/S')
        Assert-PathEntry 'A.user-path' User $NsisDir $true
        Assert-Installed 'A' $NsisDir
        Assert-Code 'A.version' 0 (Invoke-AsAdmin '--version')
    }
    B  = {
        $uninstaller = Join-Path $NsisDir 'uninstall.exe'
        Assert-Code 'B.uninstall' 0 (Invoke-Installer $uninstaller '/S')
        $gone = Wait-Until 60 { -not (Test-Path -LiteralPath $uninstaller) }
        Assert-True 'B.removed' $gone "gone=$gone"
        Assert-PathEntry 'B.user-path' User $NsisDir $false
        Clear-InstallState
    }
    C  = {
        Assert-Code 'C.install' 0 (Invoke-Installer msiexec.exe '/i', "`"$Msi`"", '/qn', '/l*v', "`"$Work\msi-install.log`"")
        $script:MsiDir = Get-MsiInstallDir
        $perMachine = (ConvertTo-PathKey $script:MsiDir).StartsWith((ConvertTo-PathKey $env:ProgramFiles) + '\')
        Assert-True 'C.per-machine' $perMachine $script:MsiDir "under $env:ProgramFiles"
        Assert-PathEntry 'C.machine-path' Machine $script:MsiDir $true
        Assert-Installed 'C' $script:MsiDir
        Assert-Code 'C.admin-version' 0 (Invoke-AsAdmin '--version')
        Assert-Code 'C.user-version' 0 (Invoke-AsUser -Cli '--version')
    }
    E  = {
        Set-HardenedPolicy
        Assert-HardenedAcl 'E.dir-acl' $PolicyDir
        Assert-HardenedAcl 'E.file-acl' $PolicyFile
    }
    F  = {
        Set-HardenedPolicy
        Assert-Code 'F.user-check' 0 (Invoke-UserCheck)
    }
    G1 = {
        Set-HardenedPolicy
        Assert-Code 'G1.user-set' 4 (Invoke-AsUser -Cli policy, set, sshConfig.import, true)
    }
    G2 = {
        Assert-Code 'G2.user-set' 4 (Invoke-AsUser -Cli policy, set, sshConfig.import, false)
        Assert-True 'G2.no-folder' (-not (Test-Path -LiteralPath $PolicyDir)) "exists=$(Test-Path -LiteralPath $PolicyDir)" 'exists=False'
    }
    H1 = {
        New-UserPolicyDir
        $check = Invoke-UserCheck
        Write-Host "RECORD H1.user-check code=$($check.Code)"
        Assert-Code 'H1.admin-set' 0 (Invoke-AdminSet)
        Assert-OneUntrusted 'H1.moved-aside' | Out-Null
        Assert-HardenedAcl 'H1.dir-acl' $PolicyDir
    }
    H2 = {
        New-UserPolicyDir -Planted
        Assert-Code 'H2.user-check' 3 (Invoke-UserCheck)
        Assert-Code 'H2.admin-set' 3 (Invoke-AdminSet)
        $owner = Get-OwnerSid $PolicyDir
        Assert-True 'H2.still-user-owned' ($owner -eq $StdSid) "owner=$owner" "owner=$StdSid"
        Assert-Code 'H2.import' 0 (Invoke-AsAdmin policy, import, '--replace', $ReviewedFixture)
        $aside = Assert-OneUntrusted 'H2.moved-aside'
        $planted = Read-Log (Join-Path $aside 'policy.json')
        Assert-True 'H2.planted-kept' ($planted -match 'evil\.example') $planted.Trim() 'evil.example'
        Assert-Layers 'H2.content' $PolicyFile $ReviewedFixture
    }
    I  = {
        New-Item -ItemType Directory -Path $PolicyDir | Out-Null
        Copy-AsUser $EvilFixture $PolicyFile
        Assert-Code 'I.user-check' 3 (Invoke-UserCheck)
        Assert-Code 'I.admin-set' 3 (Invoke-AdminSet)
        Assert-Code 'I.import' 0 (Invoke-AsAdmin policy, import, '--replace', $ReviewedFixture)
        Assert-Layers 'I.content' $PolicyFile $ReviewedFixture
    }
    J  = {
        $target = Join-Path $Scratch 'target'
        Assert-Code 'J.user-mkdir' 0 (Invoke-AsUser mkdir, $target)
        Copy-AsUser $EvilFixture (Join-Path $target 'policy.json')
        Assert-Code 'J.user-junction' 0 (Invoke-AsUser mklink, '/J', $PolicyDir, $target)
        $before = Get-Snapshot $target
        $check = Invoke-UserCheck
        Assert-Code 'J.user-check' 3 $check
        Assert-True 'J.user-link' ($check.Err -match 'link') $check.Err.Trim() 'link'
        Assert-Code 'J.admin-set' 4 (Invoke-AdminSet)
        Assert-Unchanged 'J.target-unchanged' $target $before
    }
    K  = {
        New-Item -ItemType Directory -Path $PolicyDir | Out-Null
        $real = Join-Path $Scratch 'real.json'
        [IO.File]::WriteAllText($real, '{"version":1,"policy":{}}')
        New-Item -ItemType HardLink -Path $PolicyFile -Target $real | Out-Null
        $before = Get-Snapshot $real
        Assert-Code 'K.admin-set' 4 (Invoke-AdminSet)
        Assert-Unchanged 'K.real-unchanged' $real $before
    }
    L  = {
        Set-HardenedPolicy
        $fake = Join-Path $Scratch 'fake'
        Assert-Code 'L.user-mkdir' 0 (Invoke-AsUser mkdir, (Join-Path $fake 'Voltius'))
        Copy-AsUser $EvilFixture (Join-Path $fake 'Voltius\policy.json')
        $check = Invoke-AsUser 'set', "ProgramData=$fake&&", 'voltius-cli', 'policy', 'check', '--json'
        Assert-Code 'L.user-check' 0 $check
        $path = try { ConvertTo-Text ($check.Out | ConvertFrom-Json).path } catch { '<unparseable>' }
        Assert-True 'L.path' ($path -eq $PolicyFile) $path $PolicyFile
    }
    M  = {
        Assert-Code 'M.system-set' 0 (Invoke-AsSystem policy, set, sshConfig.import, false)
        Assert-Code 'M.user-check' 0 (Invoke-UserCheck)
    }
    N  = {
        New-UserPolicyDir
        try {
            Start-Holder $PolicyDir Dir
            $set = Invoke-AdminSet
            Assert-Code 'N.admin-set' 4 $set
            Assert-True 'N.held-message' ($set.Err -match 'held open') $set.Err.Trim() 'held open'
        }
        finally {
            Stop-AllHolders
        }
    }
    O  = {
        Set-HardenedPolicy
        $before = Get-Snapshot $PolicyDir
        try {
            Start-Holder $PolicyFile File
            $set = Invoke-AdminSet 'true'
            Assert-Code 'O.admin-set' 4 $set
            Assert-True 'O.held-message' ($set.Err -match 'held open' -and $set.Err -notmatch 'needs root') $set.Err.Trim() 'held open, no "needs root"'
        }
        finally {
            Stop-AllHolders
        }
        Assert-Unchanged 'O.unchanged' $PolicyDir $before
    }
    D  = {
        Assert-Code 'D.uninstall' 0 (Invoke-Installer msiexec.exe '/x', "`"$Msi`"", '/qn', '/l*v', "`"$Work\msi-uninstall.log`"")
        Assert-PathEntry 'D.machine-path' Machine $script:MsiDir $false
    }
}

function Clear-InstallState {
    $key = 'HKCU:\Software\Voltius'
    if (-not (Test-Path -LiteralPath $key)) {
        Write-Host "  [observe] nothing left under $key"
        return
    }
    Write-Host "  [observe] left under $key`:"
    Get-Item -LiteralPath $key | Out-Host
    Get-ChildItem -LiteralPath $key -Recurse | Out-Host
    Remove-Item -LiteralPath $key -Recurse -Force
}

function Get-MsiInstallDir {
    foreach ($key in 'HKLM:\Software\Voltius', 'HKLM:\Software\Voltius\Voltius', 'HKCU:\Software\Voltius\Voltius') {
        $item = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
        $dir = if ($item) { ConvertTo-Text $item.GetValue('InstallDir') } else { '' }
        if ($dir) { return $dir.TrimEnd('\') }
    }
    Join-Path $env:ProgramFiles 'Voltius'
}

$exitCode = 1
try {
    Initialize-Run
    foreach ($id in $Scenarios.Keys) {
        $script:Scenario = $id
        Write-Host "== $id"
        Reset-PolicyState
        & $Scenarios[$id]
    }
    Write-Host 'All scenarios passed'
    $exitCode = 0
}
catch {
    Write-Host "Stopped in scenario $script:Scenario`: $_"
    Write-Host $_.ScriptStackTrace
}
finally {
    Stop-AllHolders
    if ($script:UserCreated) { net user $StdName /delete | Out-Host }
}
exit $exitCode
