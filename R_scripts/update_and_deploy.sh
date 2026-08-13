#!/bin/bash
# =============================================================================
# GeomonitoR — rotina de atualização automática (cron mensal)
# Log: /home/vagner/amazonia_geomonitor/cron.log
# -----------------------------------------------------------------------------
# A data exibida no site NÃO é mais injetada aqui. O pipeline R grava
# data/meta.json junto com os dados, e o front-end lê de lá. Assim a data e os
# dados entram no mesmo commit e não têm como divergir — o que acontecia quando
# um `sed` no index.html dependia de o R ter terminado com sucesso.
# =============================================================================

set -uo pipefail

PROJECT_DIR="/home/vagner/amazonia_geomonitor"
LOG="$PROJECT_DIR/cron.log"

cd "$PROJECT_DIR" || { echo "FALHA: diretório $PROJECT_DIR inacessível" >&2; exit 1; }

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "--- Iniciando atualização ---"

/usr/bin/Rscript R_scripts/update_all.R >> "$LOG" 2>&1
RC=$?

if [ "$RC" -ne 0 ]; then
    log "ERRO: processamento R terminou com código $RC. Nada foi commitado."
    log "--- Fim da rotina (com erro) ---"
    exit "$RC"
fi

log "Processamento R concluído. Preparando commit..."

git add data/

if git diff --cached --quiet; then
    log "Nenhuma mudança nos dados; commit e push dispensados."
    log "--- Fim da rotina ---"
    exit 0
fi

if ! git commit -m "Automated data update: $(date '+%Y-%m-%d %H:%M')" >> "$LOG" 2>&1; then
    log "ERRO: git commit falhou."
    log "--- Fim da rotina (com erro) ---"
    exit 1
fi

if git push origin main >> "$LOG" 2>&1; then
    log "Dashboard atualizado e enviado com sucesso."
else
    log "ERRO: git push falhou. O commit ficou local — envie manualmente."
    log "--- Fim da rotina (com erro) ---"
    exit 1
fi

log "--- Fim da rotina ---"
