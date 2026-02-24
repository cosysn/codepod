@echo off
setlocal

set VERSION=%1
set INSTALL_DIR=%INSTALL_DIR%
if "%INSTALL_DIR%"=="" set INSTALL_DIR=%USERPROFILE%\.codepod

echo Installing CodePod %VERSION% to %INSTALL_DIR%...

mkdir "%INSTALL_DIR%" 2>nul

echo Extracting packages...
for %%f in (codepod-cli-*.zip codepod-server-*.zip codepod-agent-*.zip codepod-runner-*.zip) do (
    powershell -Command "Expand-Archive -Path '%%f' -DestinationPath '%INSTALL_DIR%' -Force"
)

echo Adding to PATH...
setx PATH "%INSTALL_DIR%\bin;%PATH%" >nul

echo.
echo Installation complete!
echo Version: %VERSION%
echo Install location: %INSTALL_DIR%
echo.
echo Please restart your terminal for PATH changes to take effect.
