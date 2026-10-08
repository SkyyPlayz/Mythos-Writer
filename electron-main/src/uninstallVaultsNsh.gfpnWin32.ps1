param(
  [Parameter(Mandatory = $true)]
  [string]$InFile
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MythosGfpnRef {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetFullPathNameW(
    string lpFileName,
    uint nBufferLength,
    StringBuilder lpBuffer,
    IntPtr lpFilePart
  );
  public static string Call(string path) {
    var sb = new StringBuilder(32768);
    uint n = GetFullPathNameW(path, (uint)sb.Capacity, sb, IntPtr.Zero);
    if (n == 0) {
      return "";
    }
    if (n >= (uint)sb.Capacity) {
      sb.Capacity = (int)n + 2;
      n = GetFullPathNameW(path, (uint)sb.Capacity, sb, IntPtr.Zero);
      if (n == 0) {
        return "";
      }
    }
    return sb.ToString();
  }
}
'@
$raw = [System.IO.File]::ReadAllText($InFile, [System.Text.Encoding]::UTF8)
$items = $raw | ConvertFrom-Json
$result = New-Object System.Collections.Generic.List[object]
foreach ($p in $items) {
  $result.Add([pscustomobject]@{
    input = [string]$p
    win = [MythosGfpnRef]::Call([string]$p)
  })
}
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$result | ConvertTo-Json -Compress -Depth 3
