#!/bin/bash
# Script para cron job: Atualiza dados e prepara front-end
# Log file: /home/vagner/amazonia_geomonitor/cron.log

PROJECT_DIR="/home/vagner/amazonia_geomonitor"
cd $PROJECT_DIR

echo "--- Iniciando atualização: $(date) ---" >> cron.log

# Rodar o processamento em R
/usr/bin/Rscript R_scripts/update_all.R >> cron.log 2>&1

# Verificar se houve erro no R
if [ $? -eq 0 ]; then
    echo "Processamento R concluído com sucesso. Enviando para o GitHub..." >> cron.log
    
    # Comandos git para subir pro github pages
    git add data/*.geojson data/*.json
    git commit -m "Automated data update: $(date +'%Y-%m-%d')"
    git push origin main >> cron.log 2>&1
    
    echo "Dashboard atualizado e enviado com sucesso!" >> cron.log
else
    echo "Erro no processamento R. Verifique o log." >> cron.log
fi

echo "--- Fim da rotina: $(date) ---" >> cron.log
