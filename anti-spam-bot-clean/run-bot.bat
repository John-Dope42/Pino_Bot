@echo off
REM Startet den Bot nach einem Absturz erneut und schreibt die Ausgabe nach logs\bot.log.
pushd "%~dp0"
if not exist logs mkdir logs

:loop
echo Starting bot at %date% %time% >> logs\bot.log
node index.js >> logs\bot.log 2>&1
echo Bot exited with code %ERRORLEVEL% at %date% %time% >> logs\bot.log
timeout /t 5 /nobreak >nul
goto loop
