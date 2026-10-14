@echo off
setlocal
where python >nul 2>nul
if not errorlevel 1 (
  python %*
  exit /b
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys" >nul 2>nul
  if not errorlevel 1 (
    py -3 %*
    exit /b
  )
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" %*
  exit /b
)
echo Python nao encontrado. Instale Python 3.10 ou superior e tente novamente.
exit /b 1
