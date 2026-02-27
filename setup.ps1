# TutorManager For Notion - 새 컴퓨터 설정 스크립트
# 사용법: 프로젝트 폴더에서 PowerShell로 실행
#   powershell -ExecutionPolicy Bypass -File setup.ps1

$ProjectDir = $PSScriptRoot

Write-Host "=== TutorManager For Notion 설치 시작 ===" -ForegroundColor Cyan
Write-Host "프로젝트 경로: $ProjectDir"
Write-Host ""

# ─── Node.js 경로 탐지 ──────────────────────────────────────────
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $NodeExe) {
    $NodeExe = "C:\Program Files\nodejs\node.exe"
}
if (-not (Test-Path $NodeExe)) {
    Write-Warning "Node.js를 찾을 수 없습니다."
    Write-Host "  → https://nodejs.org 에서 LTS 버전 설치 후 다시 실행해주세요." -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Node.js 감지: $NodeExe"

# ─── run_sync.bat 생성 ──────────────────────────────────────────
$batContent = @"
@echo off
"$NodeExe" "$ProjectDir\sync_student_status.mjs" >> "$ProjectDir\sync_log.txt" 2>&1
"$NodeExe" "$ProjectDir\check_conflicts.mjs" >> "$ProjectDir\sync_log.txt" 2>&1
"@
Set-Content -Path "$ProjectDir\run_sync.bat" -Value $batContent -Encoding ASCII
Write-Host "[OK] run_sync.bat 생성 완료"

# ─── run_daemon.vbs 생성 ────────────────────────────────────────
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c """"$NodeExe"""" """"$ProjectDir\check_conflicts_daemon.mjs"""" >> """"$ProjectDir\sync_log.txt"""" 2>&1", 0, False
Set WshShell = Nothing
"@
Set-Content -Path "$ProjectDir\run_daemon.vbs" -Value $vbsContent -Encoding ASCII
Write-Host "[OK] run_daemon.vbs 생성 완료"

# ─── 작업 스케줄러 등록 (매일 자정) ────────────────────────────
Write-Host ""
Write-Host "작업 스케줄러 등록 시도 중..." -ForegroundColor Cyan
try {
    $action   = New-ScheduledTaskAction -Execute "$ProjectDir\run_sync.bat"
    $trigger  = New-ScheduledTaskTrigger -Daily -At "00:00"
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
    Register-ScheduledTask `
        -TaskName "TutorManager_SyncStudentStatus" `
        -Action $action -Trigger $trigger -Settings $settings `
        -Force -ErrorAction Stop | Out-Null
    Write-Host "[OK] 작업 스케줄러 등록 완료: TutorManager_SyncStudentStatus (매일 00:00)"
} catch {
    Write-Warning "작업 스케줄러 등록 실패 (관리자 권한 필요)"
    Write-Host "  → 관리자 권한 PowerShell에서 아래 명령을 실행하세요:" -ForegroundColor Yellow
    Write-Host "    Register-ScheduledTask -TaskName 'TutorManager_SyncStudentStatus' -Action (New-ScheduledTaskAction -Execute '$ProjectDir\run_sync.bat') -Trigger (New-ScheduledTaskTrigger -Daily -At '00:00') -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Force"
}

# ─── 시작 프로그램 등록 (로그인 시 데몬 자동 실행) ─────────────
Write-Host ""
Write-Host "시작 프로그램 등록 중..." -ForegroundColor Cyan
try {
    $StartupFolder = [Environment]::GetFolderPath("Startup")
    $ShortcutPath  = "$StartupFolder\TutorManager_ConflictDaemon.lnk"
    $WScriptShell  = New-Object -ComObject WScript.Shell
    $Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath       = "$ProjectDir\run_daemon.vbs"
    $Shortcut.WorkingDirectory = $ProjectDir
    $Shortcut.Save()
    Write-Host "[OK] 시작 프로그램 등록 완료: $ShortcutPath"
} catch {
    Write-Warning "시작 프로그램 등록 실패: $_"
}

# ─── 완료 메시지 ────────────────────────────────────────────────
Write-Host ""
Write-Host "=== 설치 완료 ===" -ForegroundColor Green
Write-Host ""
Write-Host "자동화 항목:" -ForegroundColor Cyan
Write-Host "  - 매일 자정: sync_student_status.mjs + check_conflicts.mjs (작업 스케줄러)"
Write-Host "  - 로그인 시: check_conflicts_daemon.mjs 백그라운드 실행 (시작 프로그램)"
Write-Host "  - 로그 파일: $ProjectDir\sync_log.txt"
Write-Host ""
Write-Host "데몬 즉시 시작하려면:" -ForegroundColor Cyan
Write-Host "  cscript `"$ProjectDir\run_daemon.vbs`""
Write-Host ""
