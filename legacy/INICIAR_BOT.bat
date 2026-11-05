@echo off
title Automação Ótica - Painel de Controle
cls

echo ====================================================
echo      INICIANDO SISTEMA DE AUTOMAÇÃO ÓTICA
echo ====================================================
echo.

:: Verifica se o Node.js está instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js não encontrado! Por favor, instale o Node.js primeiro.
    pause
    exit
)

:: Verifica se a pasta node_modules existe, se não, instala
if not exist "node_modules\" (
    echo [INFO] Instalando bibliotecas necessarias... Isso pode levar um minuto...
    npm install
)

echo [SUCESSO] Iniciando servidor e abrindo painel...
echo.

:: Abre o navegador automaticamente
start http://localhost:3000

:: Inicia o servidor
npm run ui

pause
