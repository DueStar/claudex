<#
.SYNOPSIS
  Create or remove the spawn shortcut on the Desktop.

.DESCRIPTION
  The Desktop is read from the shell folder rather than "$env:USERPROFILE\Desktop":
  with OneDrive Backup turned on the real Desktop lives under OneDrive, and its
  name is localised, so the literal path is often wrong.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\desktop-shortcut.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\desktop-shortcut.ps1 -Remove
#>
[CmdletBinding()]
param(
  # Where spawn is installed. Defaults to the install-local.cmd target.
  [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'spawn'),
  # Delete the shortcut instead of creating it.
  [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path $desktop)) {
  Write-Error "Could not find the Desktop folder."
  exit 1
}
$link = Join-Path $desktop 'spawn.lnk'

if ($Remove) {
  if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Output "Removed $link"
  } else {
    Write-Output "No shortcut at $link"
  }
  exit 0
}

$exe = Join-Path $InstallDir 'spawn.exe'
# An install updated from Claudex (1.3.35 and older) still runs Claudex.exe
if (-not (Test-Path $exe)) { $exe = Join-Path $InstallDir 'Claudex.exe' }
if (-not (Test-Path $exe)) {
  Write-Error "spawn.exe not found in $InstallDir - install it first."
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $InstallDir
# The icon file that app updates replace (the exe's own icon never changes after install)
$ico = Join-Path $InstallDir 'resources\app\electron\assets\icon.ico'
$shortcut.IconLocation = if (Test-Path $ico) { "$ico,0" } else { "$exe,0" }
$shortcut.Description = 'spawn'
$shortcut.Save()

Write-Output "Created $link"
