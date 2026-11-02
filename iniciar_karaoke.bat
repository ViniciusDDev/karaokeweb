@echo off
chcp 65001 >nul
title OpenKaraoke - 1-Click Plug & Play

echo ========================================================
echo   🎤 OpenKaraoke (Plug & Play) - Inicializando...
echo ========================================================
echo.

:: 1. Verificação do Python no sistema
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    where py >nul 2>&1
    if %ERRORLEVEL% neq 0 (
        echo [ERRO] Python não foi encontrado no seu computador!
        echo Por favor, instale o Python 3.10 ou superior em python.org
        echo e marque a opção "Add Python to PATH" durante a instalação.
        echo.
        pause
        exit /b 1
    ) else (
        set PYTHON_CMD=py -3
    )
) else (
    set PYTHON_CMD=python
)

:: 2. Criação do Ambiente Virtual (.venv)
if not exist ".venv" (
    echo [1/4] Criando ambiente virtual Python (.venv)...
    %PYTHON_CMD% -m venv .venv
    if %ERRORLEVEL% neq 0 (
        echo [ERRO] Falha ao criar o ambiente virtual .venv.
        pause
        exit /b 1
    )
)

:: 3. Ativação do Ambiente Virtual
call .venv\Scripts\activate.bat

:: 4. Verificação e Instalação de Dependências
echo [2/4] Verificando dependências do aplicativo...
if not exist ".venv\installed.flag" (
    echo Instalando pacotes necessários (pode levar alguns minutos na primeira vez)...
    python -m pip install --upgrade pip >nul 2>&1
    python -m pip install -r requirements.txt
    if %ERRORLEVEL% neq 0 (
        echo [ERRO] Falha ao instalar as dependências.
        pause
        exit /b 1
    )
    echo instalado > .venv\installed.flag
)

:: 5. Limpeza de sessões anteriores
echo [3/4] Preparando diretório temporário...
if exist "temp" (
    rmdir /s /q "temp" >nul 2>&1
)
mkdir "temp" >nul 2>&1

:: 6. Abertura do Navegador
echo [4/4] Abrindo navegador em http://localhost:5000 ...
start "" http://localhost:5000

echo.
echo ========================================================
echo   🎉 OpenKaraoke está rodando!
echo   Acesse no navegador: http://localhost:5000
echo   Para encerrar a festa, feche esta janela (os temporários
echo   serão limpos automaticamente).
echo ========================================================
echo.

:: 7. Execução do Servidor FastAPI
python -m uvicorn backend.main:app --host 0.0.0.0 --port 5000

:: Limpeza pós-encerramento
if exist "temp" (
    rmdir /s /q "temp" >nul 2>&1
)
echo.
echo Sessão encerrada. Arquivos temporários limpos!
