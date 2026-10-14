@echo off
cd /d "%~dp0"
call "%~dp0run-python.cmd" -m unittest discover -s tests -v
