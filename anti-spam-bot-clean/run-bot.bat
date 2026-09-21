@echo off
REM run-bot.bat — starts the anti-spam bot, restarts on exit, logs output to logs\bot.log

pushd "%~dp0"
if not exist logs mkdir logs







goto looptimeout /t 5 /nobreak >nulecho Bot exited with code %ERRORLEVEL% at %date% %time% >> logs\bot.lognode index.js >> logs\bot.log 2>&1echo Starting bot at %date% %time% >> logs\bot.logn:loop