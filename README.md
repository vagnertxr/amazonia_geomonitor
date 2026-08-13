# <img src="https://raw.githubusercontent.com/vagnertxr/amazonia_geomonitor/1e17c8b98211d7532eef9f587eee8da89b0d9646/favicon.svg" width="32" valign="middle"> GeomonitoR da Amazônia

**Painel de inteligência territorial para monitoramento de desmatamento e degradação florestal na Amazônia Legal, com processamento em R e visualização 100% estática.**

🇬🇧 [English version below](#-amazon-geomonitor)

---

## Sobre os dados

O painel consome dados públicos e oficiais, atualizados por rotina automatizada:

- **Alertas DETER (INPE)** — Sistema de Detecção de Desmatamento em Tempo Real. Abrange corte raso, corte raso com vegetação, degradação, mineração, corte seletivo (desordenado e geométrico) e cicatrizes de queimada.
- **Limites territoriais (IBGE)** — malhas de municípios, Bioma Amazônia e Amazônia Legal, via pacote `geobr`.
- **Áreas protegidas** — Terras Indígenas e Unidades de Conservação, também via `geobr`.

## Funcionalidades

- **Mapa interativo** com alertas dimensionados pela área e coloridos pela classe DETER.
- **Densidade de kernel (KDE) calculada no navegador**, reagindo simultaneamente a ano, mês e classe.
- **Ranking municipal** por área absoluta ou por aceleração (variação contra o ano anterior).
- **Série temporal** com comparação ano a ano, **heatmap de sazonalidade** e **municípios em alta**.
- **Animação temporal** percorrendo os meses da série.
- **Interface bilíngue** português / inglês.

## Arquitetura

### Processamento (R)

- Extração via API WFS do TerraBrasilis (`update_all.R`).
- Cruzamento espacial com municípios e áreas protegidas via `sf`.
- Conversão dos polígonos em centroides, preservando a área como atributo.
- Exportação em formatos compactos: colunar para os alertas, grade esparsa para o KDE, matrizes para as séries.

### Front-end (Vanilla JS + Leaflet)

Sem framework, sem etapa de build, sem biblioteca de gráficos — os gráficos são SVG gerado em JS.

**Formato colunar.** Os alertas trafegam como arrays paralelos em vez de GeoJSON. Municípios e classes viram índices numéricos, a data vira deslocamento inteiro em dias e a área vira inteiro. O GeoJSON de centroides tinha chegado a 89 MB com 276 mil feições — perto do limite duro de 100 MB por arquivo do GitHub. O colunar carrega a mesma informação em ~9 MB e é lido direto para arrays tipados, o que torna a filtragem uma varredura de poucos milissegundos.

**KDE no navegador.** Em vez de isolinhas pré-calculadas (13 MB, e insensíveis ao filtro de classe), o pipeline exporta uma grade esparsa de contagens por célula × mês × classe — 0,84 MB, cerca de 290 KB servidos com gzip. O navegador acumula o recorte ativo, aplica uma convolução gaussiana separável e extrai as isolinhas por *marching squares*. O ciclo completo leva de 12 a 35 ms, então o KDE pode ser recalculado a cada mudança de filtro.

A largura de banda é adaptativa: escala com `n^(-1/6)`, de modo que recortes esparsos são mais suavizados que densos. Os níveis são quantis da densidade positiva, o que elimina o anel de ruído que antes consumia metade dos vértices do arquivo.

### Acessibilidade

A paleta categórica foi validada quanto à separação para daltonismo, contraste e faixa de luminosidade. No mapa, onde os pontos são dispersos e todos os pares de cor precisam se distinguir, as oito classes DETER são agrupadas em três famílias — o máximo que passa nos critérios. Todos os controles são operáveis por teclado, com foco visível.

## Atualização

Um *cron job* executa o pipeline no dia 1 de cada mês. A data exibida no painel vem de `data/meta.json`, gravado pelo próprio pipeline e commitado junto com os dados — então a data e os dados nunca divergem.

## Rodando localmente

```bash
python3 -m http.server 8085
```

---

# 🇬🇧 Amazon GeomonitoR

**Territorial intelligence dashboard for monitoring deforestation and forest degradation in the Brazilian Legal Amazon. Processing in R, fully static delivery.**

## About the data

- **DETER alerts (INPE)** — Brazil's near-real-time deforestation detection system: clear-cut, clear-cut with vegetation, degradation, mining, selective logging (disordered and geometric) and burn scars.
- **Territorial boundaries (IBGE)** — municipalities, Amazon biome and Legal Amazon, via the `geobr` package.
- **Protected areas** — Indigenous Lands and Conservation Units.

## Features

- Interactive map with alerts scaled by area, coloured by DETER class.
- **Kernel density estimation computed in the browser**, responding to year, month and class at once.
- Municipal ranking by absolute area or by acceleration against the previous year.
- Monthly time series with year-over-year comparison, seasonality heatmap and rising municipalities.
- Time animation stepping through the series.
- Bilingual interface (Portuguese / English).

## Architecture

**Columnar format.** Alerts travel as parallel arrays instead of GeoJSON. Municipalities and classes become numeric indices, dates become integer day offsets, areas become integers. The centroid GeoJSON had reached 89 MB across 276k features — close to GitHub's hard 100 MB per-file limit. The columnar payload carries the same information in ~9 MB and loads straight into typed arrays.

**Browser-side KDE.** Rather than pre-computed contours (13 MB, and blind to the class filter), the pipeline exports a sparse grid of counts per cell × month × class — 0.84 MB, about 290 KB gzipped. The browser accumulates the active selection, applies a separable Gaussian convolution and extracts contours via marching squares, in 12–35 ms. Bandwidth is adaptive, scaling with `n^(-1/6)`; levels are quantiles of the positive density.

**Accessibility.** The eight DETER classes carry the same colour across filter chips, legend and map marks. Since a scatter map requires every one of the 28 pairs to separate, the palette was optimised to maximise the minimum separation under protanopia, deuteranopia and tritanopia: the worst pair sits at ΔE 10.9 (floor 8) and ΔE 19.5 under normal vision (floor 15). That required varying lightness across classes — the only channel that survives colour-vision deficiency at eight categories. Colour encodes class, circle size encodes area; no variable is encoded twice. All controls are keyboard operable with visible focus.

## Updates

A cron job runs the pipeline on the 1st of each month. The date shown in the dashboard comes from `data/meta.json`, written by the pipeline and committed alongside the data, so the two can never drift apart.

## Running locally

```bash
python3 -m http.server 8085
```
