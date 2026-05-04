# Amazônia GeomonitoR

**Dashboard de Inteligência Territorial focado no monitoramento de alertas de degradação e desmatamento na Amazônia Legal.**

## Sobre os Dados

O painel consome dados públicos e oficiais, extraídos e processados rotineiramente:
- **Alertas DETER (INPE):** Dados do Sistema de Detecção de Desmatamento em Tempo Real. O escopo compreende alertas de diferentes tipologias de supressão de vegetação nativa, como Desmatamento (Corte Raso), Desmatamento com Vegetação, Mineração, Degradação e Cicatrizes de Queimada.
- **Limites Territoriais:** Malhas geográficas vetoriais do Bioma Amazônia e da Amazônia Legal, fornecidas pelo IBGE (incorporadas através do pacote `geobr`).

## Arquitetura Tecnológica

- **Back-end de Processamento (R):**
  - Scripts de automação (`update_all.R`) que extraem os dados vetoriais pesados via API WFS do TerraBrasilis.
  - Processamento geoespacial vetorial via `sf` para o cruzamento acurado de ocorrências sobre malhas de municípios.
  - Modelagem de densidade espacial (Kernel Density Estimation - KDE) modelada através de `spatstat` e `raster` para cálculo e traçado inteligente das isolinhas de concentração dos alertas.
  - Exportação final rigorosamente estruturada em arquivos leves estáticos (`.geojson` e `.json`).

- **Front-end do Dashboard (Vanilla JS):**
  - Interface baseada em Single Page Application (SPA), operando 100% Serverless.
  - Motor de renderização geográfica via `Leaflet.js` sobre malhas base CARTO Dark Matter.
  - Engenharia de filtro multidimensional (ano, mês e tipologia de classe) gerenciado diretamente de maneira assíncrona na memória do cliente.

## Automação da Ingestão

Para manter o painel alimentado e funcional, o script de ingestão e formatação pode ser facilmente acoplado a qualquer agendador de tarefas:

```bash
# Exemplo de Cron Job para rodar atualizações diárias às 03:00 da manhã
0 3 * * * cd /home/vagner/amazonia_geomonitor && /usr/bin/Rscript R_scripts/update_all.R
```

---
*Elaborado por [Vagner Teixeira](https://github.com/vagnertxr).*