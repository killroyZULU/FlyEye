# Windows x64 local verification derivative. Never executes the resulting CLI.
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildRoot = Join-Path $repoRoot '.supabase/no-send-cli-build'
$downloads = Join-Path $buildRoot 'downloads'
$commit = '6d4c19870ed213ba7f682f117d0345c8a40bfa94'
$compilerHash = 'b7401f1b41517428e537493316256fb7cf03c66a130a0103ab07f3a2152e2112'
$sourceHash = '8cac81470d00f822e1ccfcafa369fd8774c9027ed6006842ec4aeb849aeb0643'
function Hash([string]$file) { return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
$inputNames = @('guard.go','adapter.go','guard_test.go','adapter_test.go','build.ps1')
$inputBytes = @{}
$inputHashes = [ordered]@{}
foreach ($name in $inputNames) {
  $inputBytes[$name] = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))
  $inputHashes[$name] = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($inputBytes[$name])).ToLowerInvariant()
}
function Download([string]$url, [string]$file, [string]$expected) {
  if (-not (Test-Path -LiteralPath $file)) {
    & curl.exe --fail --location --max-time 1800 --silent --show-error $url --output $file
    if ($LASTEXITCODE -ne 0) { throw 'Pinned download failed' }
  }
  if ((Hash $file) -cne $expected) { throw 'Pinned download checksum mismatch' }
}
if (-not $IsWindows -or [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') { throw 'Windows x64 build required' }
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
Download 'https://dl.google.com/go/go1.25.11.windows-amd64.zip' (Join-Path $downloads 'go.zip') $compilerHash
Download "https://codeload.github.com/supabase/cli/zip/$commit" (Join-Path $downloads 'source-curl.zip') $sourceHash
$work = Join-Path $buildRoot ('work-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
Expand-Archive -LiteralPath (Join-Path $downloads 'go.zip') -DestinationPath (Join-Path $work 'compiler')
Expand-Archive -LiteralPath (Join-Path $downloads 'source-curl.zip') -DestinationPath (Join-Path $work 'source')
$source = Join-Path $work "source/cli-$commit/apps/cli-go"
$go = Join-Path $work 'compiler/go/bin/go.exe'
$dockerSource = Join-Path $source 'internal/utils/docker.go'
$original = [IO.File]::ReadAllText($dockerSource)
$anchor = "func DockerStart(ctx context.Context, config container.Config, hostConfig container.HostConfig, networkingConfig network.NetworkingConfig, containerName string) (string, error) {`n"
if (($original.Split($anchor, [StringSplitOptions]::None)).Count -ne 2) { throw 'Pinned DockerStart anchor changed' }
$insertion = "`tif err := flyEyeBindLoopback(config, &hostConfig, networkingConfig, containerName); err != nil {`n`t`treturn `"`", err`n`t}`n"
[IO.File]::WriteAllText($dockerSource, $original.Replace($anchor, $anchor + $insertion), [Text.UTF8Encoding]::new($false))
$guardDir = Join-Path $source 'internal/flyeyeloopback'
New-Item -ItemType Directory -Path $guardDir | Out-Null
[IO.File]::WriteAllBytes((Join-Path $guardDir 'guard.go'), $inputBytes['guard.go'])
[IO.File]::WriteAllBytes((Join-Path $guardDir 'guard_test.go'), $inputBytes['guard_test.go'])
[IO.File]::WriteAllBytes((Join-Path $source 'internal/utils/flyeye_loopback.go'), $inputBytes['adapter.go'])
$adapterTests = Join-Path $source 'internal/flyeyeloopbackadapter'
New-Item -ItemType Directory -Path $adapterTests | Out-Null
[IO.File]::WriteAllBytes((Join-Path $adapterTests 'adapter.go'), $inputBytes['adapter.go'])
[IO.File]::WriteAllBytes((Join-Path $adapterTests 'adapter_test.go'), $inputBytes['adapter_test.go'])
function Go([string[]]$Arguments, [string]$Stage) {
  $start = [Diagnostics.ProcessStartInfo]::new($go)
  $start.WorkingDirectory = $source
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.Environment.Clear()
  foreach ($key in @('SystemRoot','WINDIR','COMSPEC','SystemDrive','NUMBER_OF_PROCESSORS')) {
    if ([Environment]::GetEnvironmentVariable($key)) { $start.Environment[$key] = [Environment]::GetEnvironmentVariable($key) }
  }
  $start.Environment['PATH'] = (Split-Path $go) + ';' + (Join-Path $env:SystemRoot 'System32')
  foreach ($key in @('TEMP','TMP','GOCACHE','GOMODCACHE','GOPATH')) {
    $directory = Join-Path $buildRoot "cache/$key"
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $start.Environment[$key] = $directory
  }
  $start.Environment['GOROOT'] = Join-Path $work 'compiler/go'
  $start.Environment['GOENV'] = 'off'
  $start.Environment['GOTOOLCHAIN'] = 'local'
  $start.Environment['GOWORK'] = 'off'
  $start.Environment['GOAUTH'] = 'off'
  $start.Environment['GOPROXY'] = 'https://proxy.golang.org'
  $start.Environment['GOSUMDB'] = 'sum.golang.org'
  $start.Environment['CGO_ENABLED'] = '0'
  $start.Environment['GOFLAGS'] = '-mod=readonly'
  $start.Environment['GOMAXPROCS'] = '2'
  foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::Start($start)
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(900000)) { $process.Kill($true); throw "Build stage timed out: $Stage" }
  [IO.File]::WriteAllText((Join-Path $work "$Stage.log"), $stdout.Result + $stderr.Result)
  if ($process.ExitCode -ne 0) { throw "Build stage failed: $Stage (details retained in isolated build directory)" }
  Write-Output "Disposable CLI build: $Stage passed."
}
Go @('test','-count=1','./internal/flyeyeloopback','./internal/flyeyeloopbackadapter') 'synthetic-guard-tests'
$binary = Join-Path $work 'supabase-go-loopback.exe'
Go @('build','-trimpath','-buildvcs=false','-ldflags=-X github.com/supabase/cli/internal/utils.Version=2.109.1-flyeye-loopback.1','-o',$binary,'.') 'compile'
Go @('mod','verify') 'module-integrity'
$compiledInputs = @{
  'guard.go'=(Join-Path $guardDir 'guard.go'); 'guard_test.go'=(Join-Path $guardDir 'guard_test.go')
  'adapter.go'=(Join-Path $source 'internal/utils/flyeye_loopback.go'); 'adapter_test.go'=(Join-Path $adapterTests 'adapter_test.go')
}
foreach ($name in $inputNames) {
  if ((Hash (Join-Path $PSScriptRoot $name)) -cne $inputHashes[$name]) { throw 'Patch input changed during build' }
  if ($compiledInputs.ContainsKey($name) -and (Hash $compiledInputs[$name]) -cne $inputHashes[$name]) { throw 'Compiled patch input mismatch' }
}
if ((Hash (Join-Path $adapterTests 'adapter.go')) -cne $inputHashes['adapter.go']) { throw 'Tested adapter input mismatch' }
$receipt = [ordered]@{
  schemaVersion=1; upstreamCommit=$commit; cliVersion='2.109.1'; compilerVersion='go1.25.11'
  compilerArchiveSha256=$compilerHash; sourceArchiveSha256=$sourceHash; compilerExeSha256=(Hash $go)
  binarySha256=(Hash $binary); sources=$inputHashes
}
Copy-Item -LiteralPath $binary -Destination (Join-Path $buildRoot 'supabase-go-loopback.exe') -Force
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $buildRoot 'receipt.json') -Encoding utf8
Write-Output 'Build receipt written; review and pin its hashes before harness use. No CLI startup executed.'
