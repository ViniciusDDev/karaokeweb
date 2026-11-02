@echo off
chcp 65001 > nul
title OpenKaraoke - Plug and Play

echo ========================================================
echo   OpenKaraoke (Plug and Play) - Inicializando...
echo ========================================================
echo.

:: 1. Deteccao Inteligente da Versao do Python
:: Prioriza Python 3.12 ou 3.11 via py launcher para garantir compatibilidade com wheels pre-compiladas
set PYTHON_CMD=

py -3.12 --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=py -3.12
    goto python_found
)

py -3.11 --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=py -3.11
    goto python_found
)

py -3.10 --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=py -3.10
    goto python_found
)

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=python
    goto python_found
)

where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PYTHON_CMD=py
    goto python_found
)

echo [ERRO] Nenhuma instalacao de Python foi encontrada no seu computador!
echo Por favor, instale o Python 3.11 ou 3.12 (64-bit) em python.org
echo e marque a opcao "Add Python to PATH" durante a instalacao.
echo.
pause
exit /b 1

:python_found
echo Utilizando interpretador: %PYTHON_CMD%
%PYTHON_CMD% --version

:: 2. Criacao / Validacao do Ambiente Virtual (.venv)
if not exist ".venv\installed.flag" (
    if exist ".venv" (
        echo Limpando ambiente virtual anterior para evitar conflito de pacotes...
        rmdir /s /q ".venv" >nul 2>&1
    )
    echo [1/4] Criando ambiente virtual Python (.venv)...
    %PYTHON_CMD% -m venv .venv
    if %ERRORLEVEL% neq 0 (
        echo [ERRO] Falha ao criar o ambiente virtual .venv.
        pause
        exit /b 1
    )
)

:: 3. Ativacao do Ambiente Virtual
call .venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 (
    echo [ERRO] Falha ao ativar o ambiente virtual .venv.
    pause
    exit /b 1
)

:: 4. Atualizacao das ferramentas de empacotamento e Instalacao de Dependencias
echo [2/4] Verificando dependencias pre-compiladas...
if not exist ".venv\installed.flag" (
    echo Atualizando pip, setuptools e wheel (essencial para reconhecer wheels binarias)...
    python -m pip install --upgrade pip setuptools wheel

    echo.
    echo Baixando pacotes binarios pre-compilados (sem compilacao C++)...
    python -m pip install --prefer-binary -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo.
        echo [ERRO] Falha ao instalar as dependencias.
        echo Dica: Certifique-se de que esta utilizando Python 3.11 ou 3.12 de 64 bits.
        echo.
        pause
        exit /b 1
    )
    echo instalado > .venv\installed.flag
)

:: 5. Limpeza de sessoes anteriores
echo [3/4] Preparando diretorio temporario...
if exist "temp" (
    rmdir /s /q "temp" >nul 2>&1
)
mkdir "temp" >nul 2>&1

:: 6. Abertura do Navegador
echo [4/4] Abrindo navegador em http://localhost:5000 ...
echo Iniciando o servidor...
start "" http://localhost:5000

echo.
echo ========================================================
echo   OpenKaraoke esta rodando!
echo   Acesse no navegador: http://localhost:5000
echo   Para encerrar a festa, feche esta janela.
echo   Os arquivos temporarios serao limpos automaticamente.
echo ========================================================
echo.

:: 7. Execucao do Servidor FastAPI
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000

:: Limpeza pos-encerramento
if exist "temp" (
    rmdir /s /q "temp" >nul 2>&1
)
echo.
echo Sessao encerrada. Arquivos temporarios limpos!
