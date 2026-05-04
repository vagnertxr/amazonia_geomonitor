# <img src="https://raw.githubusercontent.com/vagnertxr/amazonia_geomonitor/1e17c8b98211d7532eef9f587eee8da89b0d9646/favicon.svg" width="32" valign="middle"> GeomonitoR da Amazônia

**Dashboard de Inteligência Territorial focado no monitoramento de alertas de degradação e desmatamento na Amazônia Legal, com processamentos feitos em R.**

## Sobre os Dados

O painel consome dados públicos e oficiais, extraídos e processados rotineiramente:
- **Alertas DETER (INPE):** Dados do Sistema de Detecção de Desmatamento em Tempo Real (DETER) do Instituto Nacional de Pesquisas Espaciais (INPE). O escopo compreende alertas de diferentes tipologias de supressão de vegetação nativa, como Desmatamento (Corte Raso), Desmatamento com Vegetação, Mineração, Degradação e Cicatrizes de Queimada.
- **Limites Territoriais:** Malhas geográficas vetoriais dos Estados e Municípios brasileiros, do Bioma Amazônia e da Amazônia Legal, fornecidas pelo IBGE (incorporadas através do pacote `geobr`).

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

## Automação da Atualização

Os dados do painel são atualizados de forma automatizada. Um *cron job* está configurado no servidor para executar o pipeline de extração, processamento e deploy **no dia 1 de cada mês**.

```bash
# Cron Job configurado para atualização mensal automática
0 3 1 * * /home/vagner/amazonia_geomonitor/R_scripts/update_and_deploy.sh
```
