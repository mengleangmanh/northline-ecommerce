@echo off
setlocal

REM ==========================================================================
REM  Creates the ecommerce database and applies every schema migration.
REM
REM  Double-click this file, or run it from cmd.exe / PowerShell:
REM      .\run-migrations.bat
REM
REM  Safe to run as many times as you like - each migration checks what is
REM  already applied and skips it.
REM
REM  This does NOT load demo data. Do that afterwards with:
REM      cd ..\ecommerce-backend
REM      npm run seed
REM ==========================================================================

REM --- Edit these if your setup differs -------------------------------------
set "MYSQL=C:\xampp\mysql\bin\mysql.exe"
set "DBUSER=root"
REM Leave DBPASS empty for a default XAMPP install.
set "DBPASS="
REM --------------------------------------------------------------------------

REM Run from the folder this script lives in, so the .sql paths always resolve
REM even when the file is double-clicked from Explorer.
cd /d "%~dp0"

if not exist "%MYSQL%" (
  echo.
  echo ERROR: could not find mysql.exe at:
  echo     %MYSQL%
  echo.
  echo Open this file in Notepad and change the MYSQL line near the top to
  echo point at your XAMPP install.
  echo.
  pause
  exit /b 1
)

if defined DBPASS (
  set "AUTH=-u %DBUSER% -p%DBPASS%"
) else (
  set "AUTH=-u %DBUSER%"
)

echo.
echo Applying migrations with %MYSQL%
echo.

call :run 1 4 01-schema.sql             || exit /b 1
call :run 2 4 03-add-social-login.sql   || exit /b 1
call :run 3 4 04-security-hardening.sql || exit /b 1
call :run 4 4 05-two-factor.sql         || exit /b 1

echo.
echo ==========================================================
echo  Done. All tables and columns are in place.
echo.
echo  Next, load the demo data and accounts:
echo      cd ..\ecommerce-backend
echo      npm run seed
echo ==========================================================
echo.
pause
exit /b 0


:run
REM %1 = step number, %2 = total, %3 = filename
echo [%~1/%~2] %~3
if not exist "%~3" (
  echo         MISSING - %~3 is not in this folder.
  pause
  exit /b 1
)
"%MYSQL%" %AUTH% < "%~3"
if errorlevel 1 (
  echo.
  echo         FAILED on %~3 - see the error above.
  echo         Nothing after this point was applied.
  echo.
  pause
  exit /b 1
)
echo         ok
exit /b 0
