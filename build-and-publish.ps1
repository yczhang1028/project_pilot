# Project Pilot - Build and Publish to Open VSX
param([switch]$Force)

Write-Host "Project Pilot - Build and Publish" -ForegroundColor Cyan

# Load token from .env
if (!(Test-Path ".env")) {
    Write-Host "ERROR: .env file not found! Please create .env with OPEN_VSX_TOKEN=your_token" -ForegroundColor Red
    exit 1
}

$envContent = Get-Content ".env" | Where-Object { $_ -match "OPEN_VSX_TOKEN=" }
if (!$envContent) {
    Write-Host "ERROR: OPEN_VSX_TOKEN not found in .env!" -ForegroundColor Red
    exit 1
}

$token = ($envContent -split "=")[1].Trim('"').Trim("'")
$version = (Get-Content package.json | ConvertFrom-Json).version
$vsixFile = "builds/project-pilot-$version.vsix"

Write-Host "Version: $version" -ForegroundColor Green

# Step 1: Build
Write-Host "Building extension..." -ForegroundColor Blue
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed!" -ForegroundColor Red
    exit 1
}

# Step 2: Package
Write-Host "Packaging VSIX..." -ForegroundColor Blue
npx vsce package --out builds/
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Package failed!" -ForegroundColor Red
    exit 1
}

# Step 3: Publish
Write-Host "Publishing to Open VSX..." -ForegroundColor Blue
$env:OPEN_VSX_TOKEN = $token

if ($Force) {
    Write-Host "Note: ovsx publish doesn't support force flag. Will attempt normal publish..." -ForegroundColor Yellow
}

npx ovsx publish $vsixFile -p $token

if ($LASTEXITCODE -eq 0) {
    Write-Host "SUCCESS: Published v$version!" -ForegroundColor Green
    Write-Host "View at: https://open-vsx.org/extension/yczhang1028/project-pilot" -ForegroundColor Cyan
} else {
    Write-Host "ERROR: Publishing failed!" -ForegroundColor Red
    if (!$Force) {
        Write-Host "If version already exists, you may need to increment version number in package.json" -ForegroundColor Yellow
    }
    exit 1
}