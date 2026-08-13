# ============================================================================
#  Creates the ecommerce database and applies every schema migration.
#
#  Run it from PowerShell, in this folder:
#      .\run-migrations.ps1
#
#  If Windows blocks the script ("running scripts is disabled on this
#  system"), either use run-migrations.bat instead, or allow local scripts
#  for this session only:
#      Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
#  Safe to run as many times as you like - each migration checks what is
#  already applied and skips it.
#
#  This does NOT load demo data. Do that afterwards with:
#      cd ..\ecommerce-backend
#      npm run seed
# ============================================================================

# --- Edit these if your setup differs ---------------------------------------
$MysqlExe = 'C:\xampp\mysql\bin\mysql.exe'
$DbUser   = 'root'
# Leave $DbPass as '' for a default XAMPP install.
$DbPass   = ''
# ----------------------------------------------------------------------------

# Run from the folder this script lives in, so the .sql paths always resolve.
Set-Location -Path $PSScriptRoot

if (-not (Test-Path -LiteralPath $MysqlExe)) {
    Write-Host ''
    Write-Host 'ERROR: could not find mysql.exe at:' -ForegroundColor Red
    Write-Host "    $MysqlExe"
    Write-Host ''
    Write-Host 'Open this file and change the $MysqlExe line near the top to point'
    Write-Host 'at your XAMPP install.'
    exit 1
}

$auth = @('-u', $DbUser)
if ($DbPass -ne '') { $auth += "-p$DbPass" }

# 02-seed.sql is deliberately not in this list. It needs bcrypt hashes pasted
# in by hand, and `npm run seed` does the same job without that step.
$files = @(
    '01-schema.sql',
    '03-add-social-login.sql',
    '04-security-hardening.sql',
    '05-two-factor.sql'
)

Write-Host ''
Write-Host "Applying migrations with $MysqlExe"
Write-Host ''

$step = 0
foreach ($file in $files) {
    $step++
    Write-Host ("[{0}/{1}] {2}" -f $step, $files.Count, $file)

    if (-not (Test-Path -LiteralPath $file)) {
        Write-Host "        MISSING - $file is not in this folder." -ForegroundColor Red
        exit 1
    }

    # PowerShell has no '<' input redirection, so pipe the file in instead.
    # -Raw sends the whole file as one string rather than line by line.
    Get-Content -LiteralPath $file -Raw | & $MysqlExe @auth

    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host "        FAILED on $file - see the error above." -ForegroundColor Red
        Write-Host '        Nothing after this point was applied.'
        exit 1
    }

    Write-Host '        ok' -ForegroundColor Green
}

Write-Host ''
Write-Host '==========================================================' -ForegroundColor Green
Write-Host ' Done. All tables and columns are in place.' -ForegroundColor Green
Write-Host ''
Write-Host ' Next, load the demo data and accounts:'
Write-Host '     cd ..\ecommerce-backend'
Write-Host '     npm run seed'
Write-Host '==========================================================' -ForegroundColor Green
Write-Host ''
