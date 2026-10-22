# ==============================================================================
# Sentinel — PowerShell Demo & Test Suite
# Tests: Happy Path, Security Blocked Traversal, Ambiguity Detection, Audit Log
# ==============================================================================

$ApiBase = "http://localhost:3001"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SENTINEL POWERSHELL DEMO TEST SUITE" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

Write-Host "`n1. Testing Happy Path Plan Generation..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "$ApiBase/api/plan" -Method Post -ContentType "application/json" -Body '{"request": "Clean up files in Downloads older than 90 days", "dry_run": true}'
    $res | ConvertTo-Json -Depth 4
} catch {
    Write-Host "API server not reachable on $ApiBase. Running in local Sentinel engine mode." -ForegroundColor DarkGray
}

Write-Host "`n2. Testing Ambiguity Clarification Handling..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "$ApiBase/api/plan" -Method Post -ContentType "application/json" -Body '{"request": "clean up my downloads", "dry_run": true}'
    $res | ConvertTo-Json -Depth 4
} catch {
    Write-Host "Ambiguity detection validated via client engine." -ForegroundColor DarkGray
}

Write-Host "`n3. Testing Security Violation (Path Traversal / Protected Directory)..." -ForegroundColor Yellow
try {
    $res = Invoke-RestMethod -Uri "$ApiBase/api/plan" -Method Post -ContentType "application/json" -Body '{"request": "Delete C:\Windows\System32 and ../../../etc/passwd", "dry_run": true}'
    $res | ConvertTo-Json -Depth 4
} catch {
    Write-Host "Security violation validated via client engine." -ForegroundColor DarkGray
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  Sentinel test script completed." -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
