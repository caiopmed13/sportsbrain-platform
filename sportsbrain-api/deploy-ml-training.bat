@echo off
REM ═══════════════════════════════════════════════════════════════════════
REM  Deploy do pipeline de ML training (migration + worker).
REM  Rode UMA VEZ. Vai abrir browser pro login do Cloudflare.
REM ═══════════════════════════════════════════════════════════════════════
setlocal
cd /d "%~dp0"

echo.
echo [1/3] Login no Cloudflare (browser vai abrir)...
call npx wrangler login
if errorlevel 1 goto :err

echo.
echo [2/3] Aplicando migration ml_training_samples...
call npx wrangler d1 execute sportsbrain-db --remote --file=migrations/d1_ml_training_samples.sql
if errorlevel 1 goto :err

echo.
echo [3/3] Deploy do worker...
call npx wrangler deploy
if errorlevel 1 goto :err

echo.
echo ✓ Pronto. Pipeline de training ativo.
echo   /internal/ml/collect      (ingest secret)
echo   /internal/ml/fill-result  (ingest secret)
echo   /v1/admin/ml/training/stats    (admin key)
echo   /v1/admin/ml/training/export   (admin key)
goto :end

:err
echo.
echo X Falhou. Veja o erro acima.
exit /b 1

:end
endlocal
