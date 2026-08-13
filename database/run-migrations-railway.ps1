# run-migrations-railway.ps1
#
# Applies the schema migrations to a REMOTE database (Railway), not to XAMPP.
# Use run-migrations.ps1 for your local XAMPP database instead.
#
#   cd database
#   .\run-migrations-railway.ps1
#
# If PowerShell blocks the script:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

$ErrorActionPreference = 'Stop'

# XAMPP ships a MySQL client, so you probably do not need to install one.
$MysqlExe = 'C:\xampp\mysql\bin\mysql.exe'

if (-not (Test-Path $MysqlExe)) {
  Write-Host "Could not find the MySQL client at:" -ForegroundColor Red
  Write-Host "  $MysqlExe"
  Write-Host ""
  Write-Host "Edit the `$MysqlExe line at the top of this script, or use Railway's"
  Write-Host "built-in editor instead: MySQL service -> Data tab -> Query."
  exit 1
}

Write-Host ""
Write-Host "Railway connection details" -ForegroundColor Cyan
Write-Host "Take these from the MySQL service -> Variables tab."
Write-Host "Use RAILWAY_TCP_PROXY_DOMAIN and RAILWAY_TCP_PROXY_PORT,"
Write-Host "NOT MYSQLHOST and MYSQLPORT - those are the private network."
Write-Host ""

$DbHost = Read-Host "Proxy host (e.g. monorail.proxy.rlwy.net)"
$DbPort = Read-Host "Proxy port (a random 5-digit number, never 3306)"
$DbUser = Read-Host "User [root]"
if ([string]::IsNullOrWhiteSpace($DbUser)) { $DbUser = 'root' }

$SecurePass = Read-Host "Password" -AsSecureString
$DbPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass)
)

$DbName = Read-Host "Database [railway]"
if ([string]::IsNullOrWhiteSpace($DbName)) { $DbName = 'railway' }

if ($DbPort -eq '3306') {
  Write-Host ""
  Write-Host "WARNING: port 3306 is Railway's INTERNAL port. The public proxy uses a" -ForegroundColor Yellow
  Write-Host "         random high port. This will almost certainly fail to connect." -ForegroundColor Yellow
  $go = Read-Host "Continue anyway? (y/N)"
  if ($go -ne 'y') { exit 1 }
}

# Note: no space after -p. "-p secret" means "prompt me, then open database secret".
$ConnArgs = @('-h', $DbHost, '-P', $DbPort, '-u', $DbUser, "-p$DbPass", $DbName)

Write-Host ""
Write-Host "Testing the connection..." -ForegroundColor Cyan
'SELECT VERSION();' | & $MysqlExe $ConnArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Could not connect. Nothing was applied." -ForegroundColor Red
  Write-Host "  - Is public networking enabled? Settings -> Networking"
  Write-Host "  - Did you use the PROXY host and port?"
  Write-Host "  - If you see 'caching_sha2_password cannot be loaded', the XAMPP client"
  Write-Host "    is MariaDB and cannot talk to MySQL 8. Use Railway's Data -> Query tab."
  exit 1
}

# 02-seed.sql is deliberately absent. It writes a known admin password and
# bypasses the model hooks that hash and encrypt. Use `npm run seed` instead.
$Migrations = @(
  '01-schema.sql',
  '03-add-social-login.sql',
  '04-security-hardening.sql',
  '05-two-factor.sql'
)

Write-Host ""
foreach ($file in $Migrations) {
  if (-not (Test-Path $file)) {
    Write-Host "MISSING $file - are you running this from the database folder?" -ForegroundColor Red
    exit 1
  }

  Write-Host "Applying $file ..." -NoNewline
  Get-Content -Raw $file | & $MysqlExe $ConnArgs

  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "FAILED on $file - see the error above." -ForegroundColor Red
    Write-Host "Nothing after this point was applied." -ForegroundColor Red
    exit 1
  }
  Write-Host " ok" -ForegroundColor Green
}

Write-Host ""
Write-Host "Schema applied." -ForegroundColor Green
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Edit 06-create-app-user.sql and set a real password, then run:"
Write-Host "       Get-Content -Raw 06-create-app-user.sql | & '$MysqlExe' <same args>"
Write-Host "  2. Seed the products as root, from the ecommerce-backend folder:"
Write-Host "       npm run seed"
Write-Host "  3. Check the result:"
Write-Host "       node test-db.mjs   (expect 12 total, 11 published)"
Write-Host ""
Write-Host "Do NOT run 02-seed.sql. It sets a publicly known admin password." -ForegroundColor Yellow
Write-Host ""
