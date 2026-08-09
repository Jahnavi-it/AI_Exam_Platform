# Run this from inside the extracted "exam-platform-milestone3" folder:
#   powershell -ExecutionPolicy Bypass -File run-backend.ps1
$root = $PSScriptRoot
Set-Location "$root\backend"
& "$root\backend\venv\Scripts\Activate.ps1"
uvicorn app.main:app --reload --port 8000
