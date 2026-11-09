# One-time setup for sign translation + Thai voice (Windows, NVIDIA GPU optional).
# Everything large goes to %USERPROFILE%\.signvoice, outside the repo and OneDrive.
$ErrorActionPreference = 'Stop'
$home_ = if ($env:SIGNVOICE_HOME) { $env:SIGNVOICE_HOME } else { Join-Path $env:USERPROFILE '.signvoice' }
$venv = Join-Path $home_ 'venv'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path $python)) {
    py install 3.12
    py -V:3.12 -m venv $venv
}
& $python -m pip install --upgrade pip
& $python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu126
& $python -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
$env:PYTHONUTF8 = '1'
& $python (Join-Path $PSScriptRoot 'download.py')
if (-not (Test-Path (Join-Path $home_ 'models\tsl51\tsl51.pt'))) {
    # train_tsl.py builds the TSL-51 feature cache; train_combined.py then trains the
    # 236-class TSL-51 + TSL-ONE model the app uses (about 30-40 minutes on an RTX 3060).
    & $python (Join-Path $PSScriptRoot 'train_tsl.py')
    & $python (Join-Path $PSScriptRoot 'train_combined.py') --deploy
}
Write-Host "Ready. Run: npm run dev"
