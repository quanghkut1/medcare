# Sao lưu PostgreSQL đang chạy trong Docker ra file .sql
# Cách dùng:  .\backup-db.ps1
# Khôi phục:  Get-Content backups\<file>.sql | docker compose exec -T db psql -U medcare -d medcare

$ErrorActionPreference = "Stop"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$dir   = "backups"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir | Out-Null }
$out = Join-Path $dir "medcare_$stamp.sql"

Write-Host "Đang sao lưu database -> $out ..."
docker compose exec -T db pg_dump -U medcare medcare | Out-File -Encoding utf8 $out
Write-Host "✅ Đã sao lưu: $out"
