Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$defaultRepoUrl = "https://github.com/webrpc/ridl-vscode.git"
$repoUrl = if ($env:RIDL_VSCODE_REPO) { $env:RIDL_VSCODE_REPO } else { $defaultRepoUrl }
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ridl-vscode-install-" + [System.Guid]::NewGuid().ToString("N"))
$cloneDir = Join-Path $tempDir "repo"

function Require-Command {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command -Name $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Host "==> $Message" -ForegroundColor Blue
}

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Host "  -> $Message" -ForegroundColor Cyan
}

New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    Require-Command git
    Require-Command npm
    Require-Command code

    Write-Info "Cloning repository"
    Write-Step "$repoUrl -> $cloneDir"
    git clone --depth 1 $repoUrl $cloneDir
    if ($LASTEXITCODE -ne 0) {
        throw "git clone failed."
    }

    Push-Location $cloneDir
    try {
        Write-Info "Installing dependencies"
        npm ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed."
        }

        Write-Info "Building extension package"
        npm run package
        if ($LASTEXITCODE -ne 0) {
            throw "npm run package failed."
        }

        Write-Info "Installing extension into VS Code"
        npm run install:local
        if ($LASTEXITCODE -ne 0) {
            throw "npm run install:local failed."
        }
    } finally {
        Pop-Location
    }

    Write-Host "success: RIDL extension installed successfully" -ForegroundColor Green
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
}
