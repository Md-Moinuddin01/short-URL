@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
if "%PORT%"=="" set PORT=3000
echo Starting Short URL Workbench on http://127.0.0.1:%PORT%
npm start
set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
