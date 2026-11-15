param([int]$Port = 8765)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$LookoutPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (!(Test-Path -LiteralPath $LookoutPython)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw "Python 3.10+ is required." }
}
& $LookoutPython -m pip install -r companion/requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
& $LookoutPython -m companion.setup_models
if ($LASTEXITCODE -ne 0) { throw "Model verification failed." }
Write-Host "Open http://127.0.0.1:$Port"
Write-Host "AWS setup: .venv\Scripts\python.exe -m companion.configure"
& $LookoutPython -m companion --port $Port
