param([Parameter(Mandatory=$true)][int]$SmokeProcessId, [string]$CaptureName = 'native-window.png')
$ErrorActionPreference = 'Stop'
if ($CaptureName -notmatch '^[a-z-]+\.png$') { throw 'Invalid capture filename.' }
$process = Get-Process -Id $SmokeProcessId
$expected = Join-Path (Get-Location) 'target\release\monocode.exe'
if ($process.Path -ne $expected) { throw 'Only the locally built isolated smoke executable may be captured.' }
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SmokeWindow {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr destination, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
}
'@
$handle = $process.MainWindowHandle
if ($handle -eq 0) { throw 'The isolated smoke app has no native window.' }
$rect = New-Object SmokeWindow+Rect
if (-not [SmokeWindow]::GetWindowRect($handle, [ref]$rect)) { throw 'Could not read native smoke bounds.' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw 'Native smoke window is minimized or empty.' }
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
    $dc = $graphics.GetHdc()
    try {
        if (-not [SmokeWindow]::PrintWindow($handle, $dc, 2)) { throw 'Native window capture is unavailable.' }
    } finally { $graphics.ReleaseHdc($dc) }
    $output = Join-Path (Get-Location) 'test-results\browser-native-smoke'
    New-Item -ItemType Directory -Force $output | Out-Null
    $bitmap.Save((Join-Path $output $CaptureName), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
}
Write-Output 'Captured only the isolated native smoke window.'
