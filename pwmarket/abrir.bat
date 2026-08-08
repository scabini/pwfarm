@echo off
REM Sobe o servidor local do pwmarket e abre o painel no navegador.
REM Neste modo os precos vao direto para data\precos.js — sem exportar na mao.
REM Ctrl+C encerra. Feche esta janela e o servidor cai junto.
REM
REM Aceita as opcoes do servidor.py, por exemplo:
REM     abrir.bat --porta 9000
REM     abrir.bat --sem-navegador

cd /d "%~dp0"
title pwmarket - servidor local

REM O launcher "py" vem com o instalador oficial; sem ele tenta o python do PATH.
where /q py && (py servidor.py %* & goto :fim)
where /q python && (python servidor.py %* & goto :fim)

echo.
echo Nao achei o Python nesta maquina.
echo Instale em https://www.python.org/downloads/ marcando "Add to PATH".
echo.

:fim
REM Se o servidor caiu por erro, a janela fica aberta para dar tempo de ler.
if errorlevel 1 pause
