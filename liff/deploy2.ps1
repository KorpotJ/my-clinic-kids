# ตั้งค่าตัวแปร
$BUCKET_NAME = "babyplaytime-liff-app"
$DISTRIBUTION_ID = "E3JUT6DV2F2TF8"
$ErrorActionPreference = "Stop"

# 1) สร้างไฟล์ index.html ตัวเดียวจาก src\ ก่อนเสมอ (กันไฟล์เก่าค้าง)
Write-Host "🔨 Building index.html from src\ ..."
& "$PSScriptRoot\build.ps1"

Write-Host "🚀 Starting deployment for index.html..."

# 2) อัปโหลดไฟล์ที่เพิ่ง build ขึ้น S3
aws s3 cp "$PSScriptRoot\index.html" "s3://$BUCKET_NAME/index.html" `
  --cache-control "max-age=0, no-cache, no-store, must-revalidate" `
  --content-type "text/html"

Write-Host "🔄 Invalidating CloudFront cache..."
aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/index.html"

Write-Host "✅ Deployment completed successfully!"
