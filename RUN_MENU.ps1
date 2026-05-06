$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launch = Join-Path $Root "YouTube_Unified_Launcher.py"
Set-Location $Root

if (Get-Command pythonw -ErrorAction SilentlyContinue) {
    Start-Process -FilePath "pythonw" -ArgumentList @("`"$Launch`"") -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
} elseif (Get-Command pyw -ErrorAction SilentlyContinue) {
    Start-Process -FilePath "pyw" -ArgumentList @("`"$Launch`"") -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
} else {
    # pythonw/pyw가 없으면 콘솔이 잠깐 보일 수 있음
    Start-Process -FilePath "python" -ArgumentList @("`"$Launch`"") -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
}
