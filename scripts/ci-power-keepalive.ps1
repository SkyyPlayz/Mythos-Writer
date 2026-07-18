# Prevents the Windows host (GabesPC) from sleeping during CI runs on WSL2.
# Uses SetThreadExecutionState — no admin rights required.
#
# -Id distinguishes concurrent callers (e.g. the 4 E2E shard jobs, which run
# in parallel on the same runner): each caller gets its own sentinel file, so
# one job finishing and stopping its keep-alive can't delete a sibling job's
# still-active sentinel and let the host sleep out from under it (SKY-6906).
#
# Usage (from WSL2 bash):
#   Start: powershell.exe -NonInteractive -ExecutionPolicy Bypass -File <this-script> [-Id <name>]
#   Stop:  powershell.exe -NonInteractive -ExecutionPolicy Bypass -File <this-script> -Stop [-Id <name>]
param([switch]$Stop, [string]$Id = "")

$suffix = if ($Id) { "-$Id" } else { "" }
$sentinel = Join-Path $env:TEMP "mythos-ci-keepalive$suffix.active"

if ($Stop) {
    Remove-Item -Path $sentinel -Force -ErrorAction SilentlyContinue
    Write-Host "Keep-alive: sentinel removed, background process will exit."
    exit 0
}

Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class PowerMgmt {
    [DllImport("kernel32.dll")]
    public static extern uint SetThreadExecutionState(uint flags);
}
'@

Set-Content -Path $sentinel -Value "active" -Encoding ASCII
Write-Host "Keep-alive: sleep prevention active (polling every 30 s)."

try {
    while (Test-Path $sentinel) {
        # ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001):
        # tells Windows to keep the system in the working state until cleared.
        [PowerMgmt]::SetThreadExecutionState(0x80000001) | Out-Null
        Start-Sleep -Seconds 30
    }
} finally {
    # ES_CONTINUOUS alone: clear the system-required flag so Windows can sleep again.
    [PowerMgmt]::SetThreadExecutionState(0x80000000) | Out-Null
    Write-Host "Keep-alive: sleep prevention ended."
}
