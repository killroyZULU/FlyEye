<#
.SYNOPSIS
Owner-operated Windows recovery for an interrupted release of a completed submission proof.
.DESCRIPTION
Use Windows PowerShell 5.1, the pinned Node runtime, the original worktree and operator.
Reserve exclusive maintenance of the local fixture and engine. Obtain separate approval
for the run UUID and SHA-256 of each original file. Never reconstruct missing evidence.
Only a v2 lock, completed workers, verified removal and identical original/fresh inventories
qualify. A retained recovery intent requires manual reconciliation. Preserve the original
receipt. Only the next independently approved normal run can establish a new baseline.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')][string]$Run,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$LockSha256,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ReceiptSha256,
    [switch]$ApproveRelease,
    [switch]$ExclusiveMaintenance
)
$ErrorActionPreference = 'Stop'
if (!$ApproveRelease -or !$ExclusiveMaintenance) { throw 'Exact approval and exclusive maintenance required.' }
if ($PSVersionTable.PSEdition -ne 'Desktop' -or !$env:TEMP -or $env:NODE_OPTIONS) { throw 'Unsupported host.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ((Get-Location).Path -ne $root) { throw 'Original worktree required.' }
$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
if ((& $node --version) -ne 'v24.14.0' -or $LASTEXITCODE -ne 0) { throw 'Pinned Node required.' }

Add-Type -Path (Join-Path $PSScriptRoot 'CredentialProofHandle.cs')
$lockPath = Join-Path $env:TEMP 'flyeye-nosend-p3d1-credential-proof.lock'
$receiptPath = Join-Path $root ".supabase/credential-proof-receipts/$Run.json"
[CredentialProofHandle]::VerifyParent($lockPath)
[CredentialProofHandle]::VerifyParent($receiptPath)
function Write-NewRecord([string]$file, [string]$outcome) {
    $row = @{ run=$Run; lockDigest=$LockSha256; receiptDigest=$ReceiptSha256; outcome=$outcome; utc=[DateTime]::UtcNow.ToString('o') }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($row | ConvertTo-Json -Compress))
    $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
}
$intent = "$receiptPath.recovery-intent"
$result = "$receiptPath.recovery-result"
$locked = [CredentialProofHandle]::new($lockPath, $true, 4096)
try {
    $receipt = [CredentialProofHandle]::new($receiptPath, $false, 4194304)
    try {
        if ((Test-Path -LiteralPath $result) -or (Test-Path -LiteralPath $intent)) { throw 'Previous recovery record exists.' }
        $inputLine = $locked.ReadBase64() + ' ' + $receipt.ReadBase64()
        $verdict = @($inputLine | & $node (Join-Path $PSScriptRoot 'credential-lock-recovery.mjs') $Run $LockSha256 $ReceiptSha256 'approved-exclusive')
        if ($LASTEXITCODE -ne 0 -or $verdict.Count -ne 1 -or $verdict[0] -cne "verified $Run $LockSha256 $ReceiptSha256") { throw 'Recovery refused. Preserve original evidence.' }
        Write-NewRecord $intent 'release-authorized'
        $locked.ReleaseInspectedLock()
    } finally { $receipt.Dispose() }
} finally { $locked.Dispose() }
try {
    [void][IO.File]::GetAttributes($lockPath)
    throw 'Lock path occupied. Preserve intent and stop.'
} catch [IO.FileNotFoundException] {
    Write-NewRecord $result 'release-confirmed'
}
Write-Output 'Release recorded. Historical receipt preserved.'
