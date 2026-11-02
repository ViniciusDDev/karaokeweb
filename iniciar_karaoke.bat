@echo off
chcp 65001 > nul 2>&1
title OpenKaraoke - Plug and Play

:: 0. Fixa o diretorio de trabalho na pasta deste arquivo .bat
cd /d "%~dp0"

echo ========================================================
echo   OpenKaraoke (Plug and Play) - Inicializando...
echo ========================================================
echo.

:: 0.1 Atualizacao automatica via Git
if not exist ".git" goto skip_git_pull
git --version >nul 2>&1
if errorlevel 1 goto skip_git_pull

echo [GIT] Verificando e atualizando repositorio (git pull)...
git pull --no-rebase
echo.

:skip_git_pull

:: 1. Deteccao Inteligente do Python
set "PYTHON_CMD="

py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3.12" & goto python_found

py -3.11 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3.11" & goto python_found

py -3.10 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3.10" & goto python_found

py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py -3" & goto python_found

python -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=python" & goto python_found

py -c "import sys" >nul 2>&1
if not errorlevel 1 set "PYTHON_CMD=py" & goto python_found

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
if exist ".venv\Scripts\python.exe" goto venv_ready

echo [1/4] Criando ambiente virtual Python (.venv)...
%PYTHON_CMD% -m venv --system-site-packages .venv
if errorlevel 1 goto error_create_venv
goto activate_venv

:venv_ready
:: Habilita visualizacao de pacotes globais no pyvenv.cfg caso tenha sido criado sem ele
%PYTHON_CMD% -c "p=__import__('pathlib').Path('.venv/pyvenv.cfg'); p.write_text(p.read_text(encoding='utf-8').replace('include-system-site-packages = false','include-system-site-packages = true'), encoding='utf-8') if p.exists() else None" >nul 2>&1

:activate_venv
echo [2/4] Ativando ambiente virtual...
if not exist ".venv\Scripts\activate.bat" goto error_no_activate

call ".venv\Scripts\activate.bat"
if errorlevel 1 goto error_activate

:: 3. Verificacao de PyTorch e Aceleracao GPU CUDA
echo [3/4] Verificando integridade de IA e aceleracao por hardware...

:: Teste 1: PyTorch ja esta instalado e com CUDA funcional?
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 (
    ".venv\Scripts\python.exe" -c "import torch; print('[GPU] PyTorch com CUDA ja ativo e pronto: ' + torch.cuda.get_device_name(0) + ' (v' + torch.__version__ + ')')"
    goto install_project_deps
)

:: Se nao validou CUDA de primeira, diagnostica o estado atual
".venv\Scripts\python.exe" -c "import torch; print('[INFO] PyTorch atual: v' + torch.__version__ + ' | CUDA disponivel: ' + str(torch.cuda.is_available()))" 2>nul

:: Verifica presenca de GPU NVIDIA no computador
set "HAS_NVIDIA="
nvidia-smi >nul 2>&1
if not errorlevel 1 set "HAS_NVIDIA=1"

if not defined HAS_NVIDIA (
    if exist "%ProgramFiles%\NVIDIA Corporation\NVSMI\nvidia-smi.exe" set "HAS_NVIDIA=1"
)
if not defined HAS_NVIDIA (
    if exist "%SystemRoot%\System32\nvidia-smi.exe" set "HAS_NVIDIA=1"
)

if not defined HAS_NVIDIA goto cpu_mode

echo.
echo ========================================================
echo [GPU] GPU NVIDIA detectada no computador!
echo [GPU] Configurando PyTorch oficial para aceleracao CUDA 12.8...
echo ========================================================
echo.
".venv\Scripts\python.exe" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 (
    echo [GPU] Sucesso! CUDA 12.8 ativado.
    goto install_project_deps
)

echo.
echo [AVISO] CUDA 12.8 nao inicializou nesta GPU. Testando CUDA 12.4...
".venv\Scripts\python.exe" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
".venv\Scripts\python.exe" -c "import torch; assert torch.cuda.is_available(); torch.zeros(1, device='cuda')" >nul 2>&1
if not errorlevel 1 (
    echo [GPU] Sucesso! CUDA 12.4 ativado.
    goto install_project_deps
)

:cpu_mode
echo [INFO] Executando em modo CPU multithreaded.

:install_project_deps
echo.
echo Verificando dependencias da aplicacao (requirements.txt)...
".venv\Scripts\python.exe" -m pip install --prefer-binary -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 goto error_install_deps

echo instalado > ".venv\installed.flag"
echo Todas as dependencias estao prontas!
echo.
goto prepare_temp

:error_create_venv
echo.
echo ========================================================
echo [ERRO] Falha ao criar o ambiente virtual .venv.
echo Verifique se ha permissoes de escrita nesta pasta: %CD%
echo ========================================================
echo.
pause
exit /b 1

:error_install_deps
echo.
echo ========================================================
echo [ERRO] Falha ao instalar as dependencias.
echo Dicas para solucao:
echo 1. Verifique sua conexao com a internet.
echo 2. Certifique-se de que o Python e de 64 bits.
echo ========================================================
echo.
pause
exit /b 1

:error_no_activate
echo.
echo ========================================================
echo [ERRO] Script de ativacao .venv\Scripts\activate.bat nao encontrado!
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

:prepare_temp
echo [4/4] Preparando diretorio temporario e iniciando aplicacao...
if exist "temp" rmdir /s /q "temp" >nul 2>&1
mkdir "temp" >nul 2>&1
if not exist "cache" mkdir "cache" >nul 2>&1

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

".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 5000
set "SERVER_EXIT_CODE=%ERRORLEVEL%"

echo.
echo ========================================================
echo Servidor finalizado (Codigo de saida: %SERVER_EXIT_CODE%).
if exist "temp" rmdir /s /q "temp" >nul 2>&1
echo Arquivos temporarios limpos com sucesso.
echo ========================================================
echo.
pause
exit /b %SERVER_EXIT_CODE%
