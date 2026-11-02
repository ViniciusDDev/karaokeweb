@echo off
chcp 65001 > nul 2>&1
title OpenKaraoke - Plug and Play

:: 0. Fixa o diretorio de trabalho na pasta deste arquivo .bat
cd /d "%~dp0"

echo ========================================================
echo   OpenKaraoke (Plug and Play) - Inicializando...
echo ========================================================
echo.

:: 1. Deteccao Inteligente do Python
set "PYTHON_CMD="

:: Teste 1: py -3.12
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3.12"
    goto python_found
)

:: Teste 2: py -3.11
py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3.11"
    goto python_found
)

:: Teste 3: py -3.10
py -3.10 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3.10"
    goto python_found
)

:: Teste 4: py -3 generico
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
    goto python_found
)

:: Teste 5: python direto no PATH
python -c "import sys" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=python"
    goto python_found
)

:: Teste 6: py launcher generico
py -c "import sys" >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py"
    goto python_found
)

:: Falha na deteccao do Python
echo ========================================================
echo [ERRO] Nenhuma instalacao valida do Python foi encontrada!
echo.
echo Por favor, instale o Python 3.11 ou 3.12 (64 bits) em:
echo https://www.python.org/downloads/
echo.
echo IMPORTANTE: Marque a opcao "Add Python to PATH" durante
echo a instalacao do Python.
echo ========================================================
echo.
pause
exit /b 1

:python_found
echo Interpretador detectado: %PYTHON_CMD%
%PYTHON_CMD% --version
echo.

:: 2. Criacao e Validacao do Ambiente Virtual (.venv)
if not exist ".venv\installed.flag" goto clean_or_create_venv
if not exist ".venv\Scripts\python.exe" goto clean_or_create_venv
goto activate_venv

:clean_or_create_venv
if not exist ".venv" goto create_venv
echo Limpando ambiente virtual incompleto ou corrompido para evitar conflitos...
rmdir /s /q ".venv" >nul 2>&1

:create_venv
echo [1/4] Criando ambiente virtual Python (.venv)...
%PYTHON_CMD% -m venv .venv
if errorlevel 1 goto error_create_venv
goto install_dependencies

:error_create_venv
echo.
echo ========================================================
echo [ERRO] Falha ao criar o ambiente virtual .venv.
echo Verifique se ha permissoes de escrita nesta pasta.
echo Caminho atual: %CD%
echo ========================================================
echo.
pause
exit /b 1

:: 3. Instalacao de Dependencias
:install_dependencies
echo.
echo [2/4] Atualizando ferramentas e instalando dependencias...
echo Atualizando pip, setuptools e wheel...
".venv\Scripts\python.exe" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 echo [AVISO] Falha ao atualizar o pip. Prosseguindo com a instalacao...

echo.
echo Instalando pacotes do requirements.txt com wheels pre-compiladas...
".venv\Scripts\python.exe" -m pip install --prefer-binary -r requirements.txt
if errorlevel 1 goto error_install_deps

echo instalado > ".venv\installed.flag"
echo Dependencias instaladas com sucesso!
echo.
goto activate_venv

:error_install_deps
echo.
echo ========================================================
echo [ERRO] Falha ao instalar as dependencias.
echo.
echo Dicas para solucao:
echo 1. Verifique sua conexao com a internet.
echo 2. Certifique-se de que o Python e de 64 bits.
echo 3. Tente executar o comando manualmente para mais detalhes:
echo    .venv\Scripts\python.exe -m pip install -r requirements.txt
echo ========================================================
echo.
pause
exit /b 1

:: 4. Ativacao do Ambiente Virtual
:activate_venv
echo [3/4] Ativando ambiente virtual...
if not exist ".venv\Scripts\activate.bat" goto error_no_activate

call ".venv\Scripts\activate.bat"
if errorlevel 1 goto error_activate

:: Verificacao e Ativacao Automatica de GPU NVIDIA CUDA
nvidia-smi >nul 2>&1
if errorlevel 1 goto prepare_temp

:: Testa se PyTorch ja executa tensores na GPU com sucesso
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 goto gpu_validated

echo.
echo ========================================================
echo [GPU] GPU NVIDIA detectada no sistema.
echo [GPU] Configurando PyTorch com aceleracao CUDA moderna...
echo ========================================================

:: Tentativa 1: CUDA 12.8 (ideal para serie RTX 50 Blackwell e placas recentes)
echo [GPU] Instalando PyTorch compativel com CUDA 12.8...
".venv\Scripts\python.exe" -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu128
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 goto gpu_validated

:: Tentativa 2: CUDA 12.6
echo [GPU] Testando versao alternativa CUDA 12.6...
".venv\Scripts\python.exe" -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu126
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 goto gpu_validated

:: Tentativa 3: CUDA 12.1
echo [GPU] Testando versao alternativa CUDA 12.1...
".venv\Scripts\python.exe" -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu121
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 goto gpu_validated

echo [AVISO] Nao foi possivel ativar kernel CUDA na GPU. O sistema utilizara CPU.
goto prepare_temp

:gpu_validated
echo [GPU] Sucesso! Aceleracao por GPU NVIDIA CUDA ativada e validada!
goto prepare_temp

:error_no_activate
echo.
echo ========================================================
echo [ERRO] Script de ativacao .venv\Scripts\activate.bat nao encontrado!
echo Recomendado apagar a pasta .venv e reiniciar o script.
echo ========================================================
echo.
pause
exit /b 1

:error_activate
echo.
echo ========================================================
echo [ERRO] Falha ao ativar o ambiente virtual .venv.
echo ========================================================
echo.
pause
exit /b 1

:: 5. Preparacao de Diretorio Temporario
:prepare_temp
echo [4/4] Preparando diretorio temporario e iniciando aplicacao...
if exist "temp" rmdir /s /q "temp" >nul 2>&1
mkdir "temp" >nul 2>&1
if not exist "cache" mkdir "cache" >nul 2>&1

:: 6. Abertura do Navegador e Inicializacao do Servidor
echo Abrindo navegador em http://localhost:5000 ...
start "" http://localhost:5000

echo.
echo ========================================================
echo   OpenKaraoke esta pronto e em execucao!
echo   Acesse no navegador: http://localhost:5000
echo.
echo   Para encerrar, feche esta janela ou pressione CTRL+C.
echo   Os arquivos temporarios serao limpos automaticamente.
echo ========================================================
echo.

:: Execucao do Servidor FastAPI via Uvicorn
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 5000
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

:: 7. Limpeza pos-encerramento
echo.
echo ========================================================
echo Servidor finalizado (Codigo de saida: %SERVER_EXIT_CODE%).
if exist "temp" rmdir /s /q "temp" >nul 2>&1
echo Arquivos temporarios limpos com sucesso.
echo ========================================================
echo.
pause
exit /b %SERVER_EXIT_CODE%
