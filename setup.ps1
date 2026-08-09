# Exam Platform - Milestone 3 - One-shot setup
# Run this from inside the extracted "exam-platform-milestone3" folder:
#   powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==> Setting up backend..." -ForegroundColor Cyan
Set-Location "$root\backend"

python -m venv venv
& "$root\backend\venv\Scripts\pip.exe" install -r requirements.txt

Write-Host "==> Backend .env already included and pre-filled. Nothing to edit." -ForegroundColor Green

Write-Host "==> Setting up frontend..." -ForegroundColor Cyan
Set-Location "$root\frontend"
npm install

Write-Host ""
Write-Host "==> Setup complete!" -ForegroundColor Green
Write-Host "Next, run these in TWO SEPARATE terminals:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Terminal 1 (backend):"
Write-Host "    cd $root\backend"
Write-Host "    .\venv\Scripts\Activate.ps1"
Write-Host "    uvicorn app.main:app --reload --port 8000"
Write-Host ""
Write-Host "  Terminal 2 (frontend):"
Write-Host "    cd $root\frontend"
Write-Host "    npm run dev"
Write-Host ""
Write-Host "Then open http://localhost:3000 in your browser." -ForegroundColor Yellow
