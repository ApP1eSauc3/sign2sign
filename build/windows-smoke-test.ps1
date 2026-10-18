# Smoke test for the Windows installer, run by .github/workflows/windows.yml on
# a GitHub-hosted Windows runner. It checks what a Mac-only developer cannot
# see for themselves:
#
#   1. the NSIS installer installs silently, per user (no admin rights needed)
#   2. the sign2sign:// handler is registered (Google Sheets sign-in returns here)
#   3. the window has a real title bar with minimise/close buttons
#      (titleBarStyle 'hiddenInset' removed them on Windows before 2026-10-18)
#   4. the React UI drew: the first screen's hero is brand blue (#0CAAEC), and
#      the window is still white until the bundle has loaded over app:// and
#      rendered. The window title must be exactly what the app sets (a title
#      of "undefined" passed an earlier, weaker check on 2026-10-18)
#   5. a second launch and a sign2sign:// link reuse the running window
#   6. the uninstaller removes the app and the link handler
#
# It also saves a screenshot for a person to look at.
#
#   pwsh build/windows-smoke-test.ps1 -Installer release\Sign2Site-Admin-Setup-1.0.0.exe -ExpectedTitle Sign2Site

param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ExpectedTitle,
  [string]$Screenshot = 'smoke-screenshot.png'
)

$ErrorActionPreference = 'Stop'
$ExeName = 'Sign2Site Admin'
$Brand = @{ R = 0x0C; G = 0xAA; B = 0xEC }   # colors.brand in src/utils/colors.ts
$failures = New-Object System.Collections.Generic.List[string]

function Check([bool]$ok, [string]$message) {
  if ($ok) { Write-Host "PASS  $message" } else { Write-Host "FAIL  $message"; $failures.Add($message) }
}

function Get-AppWindows {
  @(Get-Process -Name $ExeName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
'@
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Colour of the pixel 30% down and halfway across the window: inside the
# mode-select hero once React has rendered, plain white before.
function Get-HeroPixel([IntPtr]$handle) {
  $rect = New-Object Win32+RECT
  [void][Win32]::GetWindowRect($handle, [ref]$rect)
  $x = [int](($rect.Left + $rect.Right) / 2)
  $y = [int]($rect.Top + ($rect.Bottom - $rect.Top) * 0.3)
  $bitmap = New-Object System.Drawing.Bitmap 1, 1
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size 1, 1))
  $pixel = $bitmap.GetPixel(0, 0)
  $graphics.Dispose(); $bitmap.Dispose()
  $pixel
}

function Test-IsBrand($pixel) {
  [Math]::Abs($pixel.R - $Brand.R) -le 24 -and [Math]::Abs($pixel.G - $Brand.G) -le 24 -and [Math]::Abs($pixel.B - $Brand.B) -le 24
}

# ── 1. Install ──────────────────────────────────────────────────────────────
$install = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
Check ($install.ExitCode -eq 0) "installer exits 0 (got $($install.ExitCode))"

$exe = Get-ChildItem -Path "$env:LOCALAPPDATA\Programs" -Recurse -Filter "$ExeName.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1
Check ($null -ne $exe) "app installed per-user under %LOCALAPPDATA%\Programs"
if ($null -eq $exe) { throw 'Cannot continue without the installed app.' }
Write-Host "      installed at $($exe.FullName)"

# ── 2. Link handler ─────────────────────────────────────────────────────────
$command = (Get-ItemProperty -Path 'HKCU:\Software\Classes\sign2sign\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
Check ($command -like "*$ExeName.exe*") "sign2sign:// opens the installed app (registry: $command)"

# ── 3 + 4. Launch, frame, renderer ──────────────────────────────────────────
Start-Process -FilePath $exe.FullName | Out-Null
$window = $null
$pixel = $null
$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  $window = Get-AppWindows | Select-Object -First 1
  if ($window) {
    $pixel = Get-HeroPixel $window.MainWindowHandle
    if (Test-IsBrand $pixel) { break }
  }
  Start-Sleep -Milliseconds 500
}
Check ($null -ne $window) 'a window opens within 60 s'
if ($null -eq $window) { throw 'Cannot continue without a window.' }

$GWL_STYLE = -16
$WS_CAPTION = 0x00C00000
$WS_SYSMENU = 0x00080000
$WS_MINIMIZEBOX = 0x00020000
$style = [Win32]::GetWindowLong($window.MainWindowHandle, $GWL_STYLE)
Check (($style -band $WS_CAPTION) -eq $WS_CAPTION) ('window has a title bar (style 0x{0:X8})' -f $style)
Check (($style -band $WS_SYSMENU) -ne 0) 'window has the close button / system menu'
Check (($style -band $WS_MINIMIZEBOX) -ne 0) 'window has a minimise button'
Check ($null -ne $pixel -and (Test-IsBrand $pixel)) ('first screen rendered (hero pixel R{0} G{1} B{2}, expected brand blue)' -f $pixel.R, $pixel.G, $pixel.B)
Start-Sleep -Seconds 2   # the title updates in an effect after the first paint
$window.Refresh()
$title = $window.MainWindowTitle
Check ($title -ceq $ExpectedTitle) "window title is '$ExpectedTitle' (got '$title')"

# ── 5. Single instance + link forwarding ───────────────────────────────────
Start-Process -FilePath $exe.FullName | Out-Null
Start-Sleep -Seconds 5
Start-Process 'sign2sign://oauth?smoke=1' | Out-Null
Start-Sleep -Seconds 5
$windows = Get-AppWindows
Check ($windows.Count -eq 1) "second launch and sign2sign:// link reuse the open window ($($windows.Count) window(s))"

# Screenshot after the second launch, so it also shows the window was
# brought to the front rather than duplicated.
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save((Join-Path (Get-Location) $Screenshot), [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
Write-Host "      screenshot saved to $Screenshot"

Get-Process -Name $ExeName -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

# ── 6. Uninstall ────────────────────────────────────────────────────────────
$uninstaller = Get-ChildItem -Path $exe.DirectoryName -Filter 'Uninstall*.exe' | Select-Object -First 1
Check ($null -ne $uninstaller) 'uninstaller present'
if ($uninstaller) {
  # The NSIS uninstaller copies itself to %TEMP% and returns at once, so poll.
  Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  while ((Test-Path $exe.FullName) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  Check (-not (Test-Path $exe.FullName)) 'uninstall removes the app'
  Check (-not (Test-Path 'HKCU:\Software\Classes\sign2sign')) 'uninstall removes the sign2sign:// handler'
}

if ($failures.Count -gt 0) {
  Write-Host "`n$($failures.Count) check(s) failed."
  exit 1
}
Write-Host "`nAll checks passed."
