@echo off
cd /d "%~dp0"
call "%~dp0run-python.cmd" server.py %*
