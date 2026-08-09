# Run this from inside the extracted "exam-platform-milestone3" folder:
#   powershell -ExecutionPolicy Bypass -File run-frontend.ps1
$root = $PSScriptRoot
Set-Location "$root\frontend"
npm run dev
