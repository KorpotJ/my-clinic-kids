# =====================================================================
#  My Clinic Kids — Admin panel deploy (Phase 1: split into css + js/)
#  Place NEXT TO admin.html (in "Admin Setup"), then run:  .\deploy.ps1
# =====================================================================

$ErrorActionPreference = 'Stop'
$Bucket = 'babyplaytime-liff-app'
$DistId = 'E3JUT6DV2F2TF8'
$Here   = $PSScriptRoot

Write-Host "=== Deploying Admin Panel ===" -ForegroundColor Cyan

# 1. HTML shell
aws s3 cp (Join-Path $Here 'admin.html') "s3://$Bucket/admin.html" --content-type "text/html; charset=utf-8"

# 2. Stylesheet
aws s3 cp (Join-Path $Here 'admin.css')  "s3://$Bucket/admin.css"  --content-type "text/css; charset=utf-8"

# 3. JS modules — sync the whole admin/js folder
aws s3 sync (Join-Path $Here 'admin\js') "s3://$Bucket/admin/js" --content-type "application/javascript; charset=utf-8"

# 4. Invalidate CloudFront (wildcard covers every js file)
Write-Host "Invalidating CloudFront cache..." -ForegroundColor Cyan
aws cloudfront create-invalidation --distribution-id $DistId --paths "/admin.html" "/admin.css" "/admin/js/*" | Out-Null

Write-Host "=== Deployment Complete! Open in Incognito. ===" -ForegroundColor Green
