$proc = Start-Process "$env:ComSpec" -ArgumentList "/c", "npm run dev > dev-out.log 2>&1" -PassThru -WindowStyle Hidden
Write-Output "launched pid $($proc.Id)"
$ok = $false
foreach ($i in 1..60) {
  Start-Sleep 3
  try {
    Invoke-WebRequest -Uri http://localhost:3000/api/me -UseBasicParsing -ErrorAction Stop | Out-Null
    $ok = $true
    break
  } catch {
    $code = $null
    try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 401) { $ok = $true; break }
  }
}
Write-Output "server up: $ok"
if (-not $ok) {
  Write-Output "--- log ---"
  Get-Content dev-out.log -ErrorAction SilentlyContinue | Select-Object -Last 25
}
