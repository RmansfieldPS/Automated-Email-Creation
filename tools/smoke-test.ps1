# Marketo API smoke test - verifies credentials + token endpoints BEFORE any UI work.
# Read-only by default. Pass -CloneTo <folderId> to also test a real clone (creates
# a program in Marketo named "API Smoke Test <time>" - delete it afterward or pass -Cleanup).
# ASCII only in this file: PS 5.1 reads BOM-less files as ANSI and mangles unicode.
#
# Usage:
#   .\smoke-test.ps1 -BaseUrl "https://123-ABC-456.mktorest.com" -ClientId "..." -ClientSecret "..."
#   .\smoke-test.ps1 ... -ProgramId 1234                       # also list that program's tokens
#   .\smoke-test.ps1 ... -ProgramId 1234 -CloneTo 5678         # also clone + write one token
#   .\smoke-test.ps1 ... -ProgramId 1234 -CloneTo 5678 -Cleanup # ...then delete the test clone
param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$ClientId,
  [Parameter(Mandatory=$true)][string]$ClientSecret,
  [int]$ProgramId = 0,
  [int]$CloneTo = 0,
  [switch]$Cleanup
)

$BaseUrl = $BaseUrl.TrimEnd('/')
if ($BaseUrl.EndsWith('/rest')) { $BaseUrl = $BaseUrl.Substring(0, $BaseUrl.Length - 5) }

Write-Host "1) Authenticating against $BaseUrl ..." -ForegroundColor Cyan
$auth = Invoke-RestMethod -Uri "$BaseUrl/identity/oauth/token?grant_type=client_credentials&client_id=$ClientId&client_secret=$ClientSecret"
if (-not $auth.access_token) { Write-Host "FAILED: $($auth | ConvertTo-Json -Compress)" -ForegroundColor Red; exit 1 }
Write-Host "   OK - token expires in $($auth.expires_in)s, scope: $($auth.scope)" -ForegroundColor Green
$H = @{ Authorization = "Bearer $($auth.access_token)" }

Write-Host "2) Listing first folders (asset read check)..." -ForegroundColor Cyan
$folders = Invoke-RestMethod -Uri "$BaseUrl/rest/asset/v1/folders.json?maxDepth=1&maxReturn=10" -Headers $H
if ($folders.success -ne $true) { Write-Host "FAILED: $($folders.errors | ConvertTo-Json -Compress)" -ForegroundColor Red; exit 1 }
$folders.result | ForEach-Object { Write-Host ("   [{0}] {1}" -f $_.id, $_.name) }

if ($ProgramId -gt 0) {
  Write-Host "3) Tokens on program $ProgramId ..." -ForegroundColor Cyan
  # NOTE: /program/{id}/tokens.json 610s on this instance; the folder endpoint with
  # folderType=Program is the one that works.
  $tk = Invoke-RestMethod -Uri "$BaseUrl/rest/asset/v1/folder/$ProgramId/tokens.json?folderType=Program" -Headers $H
  if ($tk.success -ne $true) { Write-Host "FAILED: $($tk.errors | ConvertTo-Json -Compress)" -ForegroundColor Red; exit 1 }
  $tokens = $tk.result
  if ($tokens -and $tokens[0].tokens) { $tokens = $tokens[0].tokens }   # some API versions nest
  if (-not $tokens) { Write-Host "   (no My Tokens on this program)" -ForegroundColor Yellow }
  else { $tokens | ForEach-Object { Write-Host ("   {0}  [{1}] = {2}" -f $_.name, $_.type, $_.value) } }

  if ($CloneTo -gt 0) {
    $name = "API Smoke Test $(Get-Date -Format 'MM-dd HHmm')"
    Write-Host "4) Cloning program $ProgramId -> folder $CloneTo as '$name' ..." -ForegroundColor Cyan
    $folderJson = '{"id":' + $CloneTo + ',"type":"Folder"}'
    $body = "name=$([uri]::EscapeDataString($name))&folder=$([uri]::EscapeDataString($folderJson))"
    $clone = Invoke-RestMethod -Uri "$BaseUrl/rest/asset/v1/program/$ProgramId/clone.json" -Headers $H -Method Post -ContentType "application/x-www-form-urlencoded" -Body $body
    if ($clone.success -ne $true) { Write-Host "FAILED: $($clone.errors | ConvertTo-Json -Compress)" -ForegroundColor Red; exit 1 }
    $newId = $clone.result[0].id
    Write-Host "   OK - new program id $newId" -ForegroundColor Green

    if ($tokens) {
      $t = $tokens[0]
      Write-Host "5) Writing token '$($t.name)' on clone ..." -ForegroundColor Cyan
      $tbody = "folderType=Program&name=$([uri]::EscapeDataString($t.name))&type=$([uri]::EscapeDataString($t.type))&value=$([uri]::EscapeDataString('SMOKE TEST VALUE'))"
      $tw = Invoke-RestMethod -Uri "$BaseUrl/rest/asset/v1/folder/$newId/tokens.json" -Headers $H -Method Post -ContentType "application/x-www-form-urlencoded" -Body $tbody
      if ($tw.success -ne $true) { Write-Host "FAILED: $($tw.errors | ConvertTo-Json -Compress)" -ForegroundColor Red; exit 1 }
      Write-Host "   OK - token written." -ForegroundColor Green

      Write-Host "   Verifying token round-trip on clone..." -ForegroundColor Cyan
      $vk = Invoke-RestMethod -Uri "$BaseUrl/rest/asset/v1/folder/$newId/tokens.json?folderType=Program" -Headers $H
      $vt = $vk.result
      if ($vt -and $vt[0].tokens) { $vt = $vt[0].tokens }
      $hit = $vt | Where-Object { $_.name -eq $t.name }
      Write-Host ("   Clone token '{0}' = '{1}'" -f $hit.name, $hit.value) -ForegroundColor Green
    }

    if ($Cleanup) {
      Write-Host "6) Deleting test clone $newId ..." -ForegroundColor Cyan
      $del = Invoke-RestMethod -Uri "$BaseUrl/rest/asset/v1/program/$newId/delete.json" -Headers $H -Method Post
      if ($del.success -ne $true) { Write-Host "FAILED to delete (remove program $newId manually): $($del.errors | ConvertTo-Json -Compress)" -ForegroundColor Red }
      else { Write-Host "   OK - test clone deleted." -ForegroundColor Green }
    } else {
      Write-Host "   NOTE: test program $newId left in place - review it in Marketo, then delete." -ForegroundColor Yellow
    }
  }
}

Write-Host ""
Write-Host "Smoke test passed." -ForegroundColor Green
