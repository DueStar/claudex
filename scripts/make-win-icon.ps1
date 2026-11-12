<#
.SYNOPSIS
  Build the Windows icon (.ico) from the 512 px app icon.

.DESCRIPTION
  Windows picks a size from the .ico for each place it draws the icon: the tray
  (16 at 100 %, 24 at 150 %, 32 at 200 %), the taskbar (24/36/48), the Desktop
  (48/72/96) and Explorer's large views (256). An .ico holding only 256 px makes
  Windows shrink it on the fly, which smears the small sizes; one holding only
  16 px gets blown up on a scaled display. So each size is drawn separately from
  the 512 px source with high-quality resampling and stored as a PNG entry.

  Writes electron/assets/icon.ico (window, tray, shortcuts; shipped with app
  updates) and build/icon.ico (embedded into spawn.exe by electron-builder).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-win-icon.ps1
#>
param(
  [string]$Source = (Join-Path $PSScriptRoot '..\electron\assets\icon.png')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sizes = 16, 20, 24, 32, 40, 48, 64, 96, 128, 256
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$targets = @((Join-Path $root 'electron\assets\icon.ico'), (Join-Path $root 'build\icon.ico'))

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  $entries = foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingMode = 'SourceCopy'
    $g.CompositingQuality = 'HighQuality'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.SmoothingMode = 'HighQuality'
    # Clamp the edges so the outline does not fade into a transparent border
    $attrs = New-Object System.Drawing.Imaging.ImageAttributes
    $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), 0, 0, $src.Width, $src.Height, 'Pixel', $attrs)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [pscustomobject]@{ Size = $size; Bytes = $ms.ToArray() }
  }
} finally { $src.Dispose() }

# ICONDIR, then one ICONDIRENTRY per image, then the PNG data
$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
  $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$e.Bytes.Length); $w.Write([uint32]$offset)
  $offset += $e.Bytes.Length
}
foreach ($e in $entries) { $w.Write($e.Bytes) }
$w.Flush()
foreach ($t in $targets) { [System.IO.File]::WriteAllBytes($t, $out.ToArray()); Write-Output "Wrote $t ($($out.Length) bytes, sizes $($sizes -join ', '))" }
