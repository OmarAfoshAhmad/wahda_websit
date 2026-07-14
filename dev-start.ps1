# dev-start.ps1
# يحل مشكلة .next/dev/lock ويشغل خادم التطوير

Write-Host "جاري البحث عن عمليات Next.js المفتوحة..." -ForegroundColor Yellow

$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*waad_temp_website*' }

if ($processes) {
    foreach ($p in $processes) {
        Write-Host "  إيقاف العملية: PID $($p.ProcessId)" -ForegroundColor Red
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Write-Host "  تم إيقاف جميع العمليات." -ForegroundColor Green
} else {
    Write-Host "  لا توجد عمليات مفتوحة." -ForegroundColor Green
}

$lockPath = Join-Path $PSScriptRoot ".next\dev\lock"
if (Test-Path $lockPath) {
    Remove-Item $lockPath -Force
    Write-Host "تم حذف ملف القفل: $lockPath" -ForegroundColor Green
} else {
    Write-Host "ملف القفل غير موجود، لا حاجة للحذف." -ForegroundColor Gray
}

Write-Host ""
Write-Host "تشغيل خادم التطوير..." -ForegroundColor Cyan
npm run dev
