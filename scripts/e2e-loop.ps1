foreach ($run in 1..3) {
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 3
  powershell -ExecutionPolicy Bypass -File scripts\smoke.ps1 | Out-Null
  npx tsx scripts\smoke-e2e.mts *> "run$run.log"
  if ($LASTEXITCODE -eq 0) { Write-Output "run $run : PASS" } else { Write-Output "run $run : FAIL"; Get-Content "run$run.log" | Select-Object -Last 6 }
  Remove-Item "run$run.log" -ErrorAction SilentlyContinue
}
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
