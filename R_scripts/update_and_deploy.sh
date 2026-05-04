#!/bin/bash
# Script para cron job: Atualiza dados e prepara front-end
cd /home/vagner/amazonia_geomonitor
Rscript R_scripts/update_all.R
# Aqui entrariam os comandos git para subir pro github pages se configurado
# git add .
# git commit -m "Automated update: \$(date)"
# git push origin main
