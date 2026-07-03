@echo off
chcp 65001 > nul
echo.
echo  scatter — установка
echo  ───────────────────────────────────

:: определить папку где лежит этот bat файл
set "PROJ=%~dp0"
cd /d "%PROJ%"

echo  папка проекта: %PROJ%
echo.

:: проверить node
node --version > nul 2>&1
if errorlevel 1 (
  echo  ОШИБКА: node.js не найден.
  echo  Скачай с https://nodejs.org и установи, потом запусти снова.
  pause
  exit /b 1
)

echo  node.js найден. устанавливаю зависимости...
echo.
npm install
echo.
echo  ───────────────────────────────────
echo  готово! запускаю сервер...
echo  открой в браузере: http://localhost:3000
echo  код доступа: scatter
echo.
echo  чтобы остановить — закрой это окно или нажми Ctrl+C
echo  ───────────────────────────────────
echo.
node server.js
pause
