<#
.SYNOPSIS
  Create or remove the Claudex shortcut on the Desktop.

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
  # Where Claudex is installed. Defaults to the install-local.cmd target.
  [string] $InstallDir = (Join-Path $env:LOCALAPPDATA 'Claudex'),
  # Delete the shortcut instead of creating it.
  [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path $desktop)) {
  Write-Error "Could not find the Desktop folder."
  exit 1
}
$link = Join-Path $desktop 'Claudex.lnk'

if ($Remove) {
  if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Output "Removed $link"
  } else {
    Write-Output "No shortcut at $link"
  }
  exit 0
}

$exe = Join-Path $InstallDir 'Claudex.exe'
if (-not (Test-Path $exe)) {
  Write-Error "Claudex.exe not found at $exe - install it first."
  exit 1
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $InstallDir
$shortcut.IconLocation = "$exe,0"
$shortcut.Description = 'Claudex'
$shortcut.Save()

Write-Output "Created $link"
