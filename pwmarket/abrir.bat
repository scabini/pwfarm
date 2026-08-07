@echo off
REM Sobe o servidor local e abre o painel no navegador.
REM Neste modo os precos vao direto para data\precos.js — sem exportar na mao.
cd /d "%~dp0"
py servidor.py %*
