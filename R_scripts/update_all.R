# =============================================================================
# Amazônia Geomonitor - Script Unificado de Processamento
# -----------------------------------------------------------------------------
# Exporta os dados no formato COLUNAR consumido pelo front-end: arrays paralelos
# em vez de GeoJSON. O GeoJSON de centroides chegou a 89 MB com 276 mil feicoes,
# perto do limite duro de 100 MB por arquivo do GitHub; o formato colunar cai
# para ~9 MB carregando exatamente a mesma informacao.
#
# O KDE deixou de ser pre-calculado aqui. Em vez de isolinhas prontas (que nao
# respondem ao filtro de classe), exportamos uma grade esparsa de contagens por
# mes x classe e o navegador calcula a densidade sob demanda. Por isso este
# script nao depende mais de spatstat nem de raster.
# =============================================================================

source("R_scripts/rotinas_inpe.R")
library(sf)
library(dplyr)
library(jsonlite)
library(geobr)

sf::sf_use_s2(FALSE)

# --- CONFIGURAÇÕES ---
DATA_INICIO <- "2020-01-01"
CRS_UTM     <- 31981  # SIRGAS 2000 / UTM zone 21S

carregar_municipios_com_retry <- function(max_tentativas = 3, pausa_segundos = 20) {
  for (tentativa in seq_len(max_tentativas)) {
    cat(sprintf("   Tentativa %d/%d para carregar municípios...\n", tentativa, max_tentativas))

    resultado <- tryCatch({
      read_municipality(year = 2020, showProgress = FALSE) %>%
        st_transform(4326)
    }, error = function(e) {
      cat(sprintf("   Falha na tentativa %d: %s\n", tentativa, conditionMessage(e)))
      NULL
    })

    if (!is.null(resultado) && nrow(resultado) > 0) {
      return(resultado)
    }

    if (tentativa < max_tentativas) {
      cat(sprintf("   Aguardando %d segundos antes da próxima tentativa...\n", pausa_segundos))
      Sys.sleep(pausa_segundos)
    }
  }

  stop("Não foi possível carregar os limites municipais após várias tentativas.")
}

cat("\n=== INICIANDO ATUALIZAÇÃO: AMAZÔNIA GEOMONITOR ===\n")
cat(sprintf("Timestamp: %s\n", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))

# =============================================================================
# 1. Carregar Municípios (para cruzamento espacial)
# =============================================================================
cat("\n1. Carregando limites municipais (geobr)...\n")
municipios_br <- carregar_municipios_com_retry()

# =============================================================================
# 2. Download com Paginação por Ano (sem limite de features)
# =============================================================================
cat("\n2. Baixando alertas DETER (paginação por ano, sem limite)...\n")

anos_download <- seq(
  as.numeric(format(as.Date(DATA_INICIO), "%Y")),
  as.numeric(format(Sys.Date(), "%Y"))
)

alertas_lista <- list()

for (ano_dl in anos_download) {
  cat(sprintf("   Baixando %d... ", ano_dl))

  filtro_ano <- sprintf(
    "view_date >= '%d-01-01' AND view_date <= '%d-12-31'",
    ano_dl, ano_dl
  )

  resultado <- tryCatch({
    download_terrabrasilis_wfs(
      layer_name   = "deter-amz:deter_amz",
      cql_filter   = filtro_ano,
      max_features = NULL
    )
  }, error = function(e) {
    cat(sprintf("FALHOU (%s)\n", conditionMessage(e)))
    return(NULL)
  })

  if (!is.null(resultado) && nrow(resultado) > 0) {
    alertas_lista[[as.character(ano_dl)]] <- resultado
    cat(sprintf("%d registros\n", nrow(resultado)))
  } else {
    cat("0 registros\n")
  }
}

if (length(alertas_lista) == 0) {
  stop("Nenhum dado baixado. Verifique a conexão com o TerraBrasilis.")
}

alertas_raw <- do.call(rbind, alertas_lista)
cat(sprintf("\n   Total bruto: %d registros\n", nrow(alertas_raw)))

# =============================================================================
# 3. Processamento de Atributos e Cruzamento Espacial
# =============================================================================
cat("\n3. Processando atributos e cruzando com municípios...\n")

alertas_proc <- alertas_raw %>%
  st_transform(4326) %>%
  mutate(
    view_date = as.Date(view_date),
    ano       = as.numeric(format(view_date, "%Y")),
    mes       = as.numeric(format(view_date, "%m")),
    periodo   = format(view_date, "%m/%Y"),
    classe    = ifelse(is.na(classname), "OUTROS", toupper(classname))
  ) %>%
  filter(areamunkm > 0 | areauckm > 0)

alertas_validados <- tryCatch(
  st_make_valid(alertas_proc),
  error = function(e) {
    cat(sprintf("   st_make_valid falhou em lote (%s).\n", conditionMessage(e)))
    cat("   Isolando geometria por geometria para descartar registros degenerados...\n")
    NULL
  }
)

if (is.null(alertas_validados)) {
  geoms   <- st_geometry(alertas_proc)
  n       <- length(geoms)
  geoms_lista <- vector("list", n)
  falhas  <- logical(n)

  for (i in seq_len(n)) {
    geom_valida <- tryCatch(st_make_valid(geoms[[i]]), error = function(e) NULL)
    if (is.null(geom_valida) || st_is_empty(geom_valida)) {
      falhas[i] <- TRUE
      geoms_lista[[i]] <- geoms[[i]]
    } else {
      geoms_lista[[i]] <- geom_valida
    }
  }

  if (any(falhas)) {
    cat(sprintf("   AVISO: %d de %d geometria(s) degenerada(s) descartada(s) (%.3f%%).\n",
        sum(falhas), n, 100 * sum(falhas) / n))
  }

  st_geometry(alertas_proc) <- st_sfc(geoms_lista, crs = st_crs(alertas_proc))
  alertas_validados <- alertas_proc[!falhas, ]
}

alertas_cruzados <- st_join(alertas_validados, municipios_br, join = st_intersects) %>%
  filter(as.character(st_geometry_type(.)) %in% c("POLYGON", "MULTIPOLYGON"))

cat(sprintf("   %d polígonos válidos após cruzamento\n", nrow(alertas_cruzados)))

# =============================================================================
# 4. Converter para Centroides + Selecionar só colunas necessárias
# =============================================================================
# Centroides são pontos — muito menores que polígonos.
# 270k pontos com 7 atributos → ~15 MB vs 200+ MB dos polígonos.
# A área do alerta é preservada como atributo para escalar o raio do círculo.
# =============================================================================
cat("\n4. Convertendo polígonos para centroides...\n")

alertas_centroides <- alertas_cruzados %>%
  # Calcular área real do polígono antes de converter para ponto
  mutate(
    area_km2 = as.numeric(pmax(
      ifelse(is.na(areamunkm), 0, areamunkm),
      ifelse(is.na(areauckm),  0, areauckm)
    ))
  ) %>%
  # Manter só colunas que o app.js usa
  dplyr::select(
    classname, classe, view_date,
    area_km2,
    name_muni, abbrev_state,
    ano, mes, periodo
  ) %>%
  # Converter geometria para centroide
  st_centroid()

cat(sprintf("   %d centroides gerados\n", nrow(alertas_centroides)))

# =============================================================================
# 5. Cruzamento com Áreas Protegidas (Terras Indígenas e Unidades de Conservação)
# =============================================================================
cat("\n5. Cruzando com áreas protegidas...\n")

RES_KDE  <- 0.15     # grau; ~16 km na latitude da Amazônia
LON0_KDE <- -74.0
LAT0_KDE <- -18.0
NX_KDE   <- 200
NY_KDE   <- 155

# As camadas vêm do TerraBrasilis, não do geobr: são a mesma fonte dos alertas,
# já vêm recortadas para a Amazônia Legal, e o servidor de dados do geobr
# (ipea.gov.br) responde 404 para o endpoint que a versão instalada usa.
carregar_protegidas <- function() {
  baixar <- function(camada, tipo, col_nome) {
    x <- tryCatch(download_terrabrasilis_wfs(camada),
                  error = function(e) {
                    cat(sprintf("   %s indisponível (%s)\n", tipo, conditionMessage(e)))
                    NULL
                  })
    if (is.null(x) || nrow(x) == 0) return(NULL)
    x %>% st_transform(4326) %>%
      transmute(tipo = tipo, nome = as.character(.data[[col_nome]]))
  }

  ti <- baixar("prodes-legal-amz:indigenous_area_legal_amazon",  "TI", "terrai_nom")
  uc <- baixar("prodes-legal-amz:conservation_units_legal_amazon", "UC", "nome")

  partes <- Filter(Negate(is.null), list(ti, uc))
  if (length(partes) == 0) return(NULL)

  extrair_poligonos(validar_geometrias(do.call(rbind, partes)))
}

# st_make_valid em lote aborta com TopologyException por causa de um único
# polígono degenerado — foi o que derrubou a rotina de cron em 01/08/2026.
# Isolar geometria por geometria descarta só o registro problemático.
validar_geometrias <- function(x) {
  ok <- tryCatch(st_make_valid(x), error = function(e) NULL)
  if (!is.null(ok)) return(ok[!st_is_empty(ok), ])

  cat("   st_make_valid falhou em lote; validando individualmente...\n")
  g <- st_geometry(x)
  ruim <- logical(length(g))
  for (i in seq_along(g)) {
    v <- tryCatch(st_make_valid(g[[i]]), error = function(e) NULL)
    if (is.null(v) || st_is_empty(v)) ruim[i] <- TRUE else g[[i]] <- v
  }
  cat(sprintf("   %d de %d geometria(s) degenerada(s) descartada(s)\n", sum(ruim), length(g)))
  st_geometry(x) <- st_sfc(g, crs = st_crs(x))
  x[!ruim, ]
}

# st_make_valid devolve GEOMETRYCOLLECTION quando o polígono de origem tem
# resíduo degenerado (pontos e linhas coladas na borda). Guardar a coleção
# inteira faz o Leaflet desenhar esses resíduos como marcadores; descartar a
# feição apagaria áreas reais — Raposa Serra do Sol e Vale do Javari caem aqui.
# A saída correta é ficar só com a parte poligonal.
extrair_poligonos <- function(x) {
  g <- st_geometry(x)
  convertidos <- 0
  for (i in seq_along(g)) {
    if (as.character(st_geometry_type(g[i])) != "GEOMETRYCOLLECTION") next
    p <- tryCatch(st_collection_extract(g[i], "POLYGON"), error = function(e) NULL)
    if (!is.null(p) && length(p) > 0) {
      g[i] <- st_combine(p)
      convertidos <- convertidos + 1
    }
  }
  st_geometry(x) <- g
  if (convertidos > 0) cat(sprintf("   %d GEOMETRYCOLLECTION convertida(s) em polígono\n", convertidos))

  manter <- as.character(st_geometry_type(x)) %in% c("POLYGON", "MULTIPOLYGON")
  if (any(!manter)) cat(sprintf("   %d feição(ões) sem parte poligonal removida(s)\n", sum(!manter)))
  x[manter & !st_is_empty(x), ]
}

protegidas <- carregar_protegidas()
alertas_centroides$protegida <- NA_character_

if (!is.null(protegidas)) {
  cat(sprintf("   %d polígonos de áreas protegidas (%d TI, %d UC)\n",
      nrow(protegidas), sum(protegidas$tipo == "TI"), sum(protegidas$tipo == "UC")))

  # Marca cada alerta com o tipo de área protegida que o contém.
  idx <- st_intersects(alertas_centroides, protegidas)
  primeiro <- vapply(idx, function(v) if (length(v)) v[1] else NA_integer_, integer(1))
  alertas_centroides$protegida <- protegidas$tipo[primeiro]

  # Geometria simplificada: o mapa não precisa do traçado original, e a
  # tolerância derruba o arquivo de dezenas de MB para poucos MB.
  # 0.01 grau (~1,1 km) mantém a silhueta nos zooms usados e entrega ~1 MB.
  # A simplificação pode degenerar geometrias, então extrai polígonos de novo.
  prot_simples <- extrair_poligonos(
    st_simplify(protegidas, dTolerance = 0.01, preserveTopology = TRUE))

  arq_prot <- "data/areas_protegidas.geojson"
  if (file.exists(arq_prot)) file.remove(arq_prot)
  st_write(prot_simples, arq_prot, driver = "GeoJSON",
           layer_options = "COORDINATE_PRECISION=4", quiet = TRUE)
  cat(sprintf("   areas_protegidas.geojson: %.1f MB\n", file.size(arq_prot) / 1e6))
}

# =============================================================================
# 6. Exportar Alertas em Formato Colunar
# =============================================================================
cat("\n6. Exportando data/alertas.json (colunar)...\n")

EPOCA <- as.Date("2020-01-01")

coords_xy <- st_coordinates(alertas_centroides)

tabela <- alertas_centroides %>%
  st_drop_geometry() %>%
  mutate(
    lon = round(coords_xy[, 1], 4),
    lat = round(coords_xy[, 2], 4)
  ) %>%
  mutate(
    muni_nome = ifelse(is.na(name_muni), "—", as.character(name_muni)),
    uf_sigla  = ifelse(is.na(abbrev_state), "", as.character(abbrev_state)),
    classe    = as.character(classe)
  )

# Tabelas de lookup: o nome do município aparecia por extenso em cada uma das
# 276 mil feições; como índice, ocupa poucos bytes.
munis_tab <- tabela %>%
  distinct(muni_nome, uf_sigla) %>%
  arrange(muni_nome) %>%
  distinct(muni_nome, .keep_all = TRUE)

ORDEM_CLASSES <- c("DESMATAMENTO_CR", "DESMATAMENTO_VEG", "DEGRADACAO", "MINERACAO",
                   "CS_DESORDENADO", "CS_GEOMETRICO", "CICATRIZ_DE_QUEIMADA", "OUTROS")
classes_tab <- c(intersect(ORDEM_CLASSES, unique(tabela$classe)),
                 setdiff(unique(tabela$classe), ORDEM_CLASSES))

tabela <- tabela %>%
  mutate(
    i_muni = match(muni_nome, munis_tab$muni_nome) - 1L,
    i_cls  = match(classe, classes_tab) - 1L,
    i_dia  = as.integer(as.Date(view_date) - EPOCA),
    i_area = as.integer(round(area_km2 * 10000))   # km² × 10 000 (precisão de 100 m²)
  )

alertas_json <- list(
  epoca   = format(EPOCA, "%Y-%m-%d"),
  classes = classes_tab,
  munis   = munis_tab$muni_nome,
  ufs     = munis_tab$uf_sigla,
  lon     = tabela$lon,
  lat     = tabela$lat,
  dia     = tabela$i_dia,
  cls     = tabela$i_cls,
  muni    = tabela$i_muni,
  area    = tabela$i_area
)

write(toJSON(alertas_json, auto_unbox = TRUE, digits = 4), "data/alertas.json")
cat(sprintf("   %.1f MB | %d alertas | %d municípios\n",
    file.size("data/alertas.json") / 1e6, nrow(tabela), nrow(munis_tab)))

# =============================================================================
# 7. Ranking Municipal
# =============================================================================
cat("\n7. Gerando data/ranking.json...\n")

ranking_data <- tabela %>%
  group_by(ano, mes, muni = muni_nome, uf = uf_sigla, classe) %>%
  summarise(n = n(), area = round(sum(area_km2, na.rm = TRUE), 3), .groups = "drop") %>%
  mutate(ano = as.integer(ano), mes = as.integer(mes))

write(toJSON(ranking_data, dataframe = "rows", digits = 3), "data/ranking.json")
cat(sprintf("   %.1f MB | %d linhas\n", file.size("data/ranking.json") / 1e6, nrow(ranking_data)))

# =============================================================================
# 8. Série Mensal por Classe (alimenta os gráficos)
# =============================================================================
cat("\n8. Gerando data/series.json...\n")

tabela <- tabela %>% mutate(mes_id = sprintf("%04d-%02d", as.integer(ano), as.integer(mes)))
meses_tab <- sort(unique(tabela$mes_id))

serie <- tabela %>%
  group_by(mes_id, i_cls) %>%
  summarise(n = n(), area = sum(area_km2, na.rm = TRUE), .groups = "drop")

mat_n <- matrix(0L, nrow = length(meses_tab), ncol = length(classes_tab))
mat_a <- matrix(0,  nrow = length(meses_tab), ncol = length(classes_tab))
for (k in seq_len(nrow(serie))) {
  lin <- match(serie$mes_id[k], meses_tab)
  col <- serie$i_cls[k] + 1L
  mat_n[lin, col] <- as.integer(serie$n[k])
  mat_a[lin, col] <- round(serie$area[k], 3)
}

write(toJSON(list(meses = meses_tab, classes = classes_tab,
                  n = mat_n, area = mat_a),
             auto_unbox = TRUE, digits = 3, matrix = "rowmajor"),
      "data/series.json")
cat(sprintf("   %d meses x %d classes\n", length(meses_tab), length(classes_tab)))

# =============================================================================
# 9. Grade Esparsa para o KDE do Navegador
# =============================================================================
# Agregação por (célula x mês x classe): a granularidade mínima que permite ao
# front-end reconstruir qualquer combinação de ano, mês e classes selecionadas.
# O índice da célula usa delta-encoding, o que encolhe muito o JSON.
# =============================================================================
cat("\n9. Gerando data/kde_grid.json...\n")

grade <- tabela %>%
  mutate(
    ix = as.integer(floor((lon - LON0_KDE) / RES_KDE)),
    iy = as.integer(floor((lat - LAT0_KDE) / RES_KDE))
  ) %>%
  filter(ix >= 0, ix < NX_KDE, iy >= 0, iy < NY_KDE) %>%
  mutate(celula = iy * NX_KDE + ix, i_mes = match(mes_id, meses_tab) - 1L) %>%
  group_by(i_mes, i_cls, celula) %>%
  summarise(n = n(), area_ha = as.integer(round(sum(area_km2, na.rm = TRUE) * 100)),
            .groups = "drop") %>%
  arrange(i_mes, i_cls, celula)

dados_grade <- list()
n_tuplas <- 0
for (mi in unique(grade$i_mes)) {
  bloco_mes <- grade[grade$i_mes == mi, ]
  por_classe <- list()

  for (ci in unique(bloco_mes$i_cls)) {
    b <- bloco_mes[bloco_mes$i_cls == ci, ]
    delta <- c(b$celula[1], diff(b$celula))
    # Intercala [delta, contagem, área] numa lista plana.
    por_classe[[as.character(ci)]] <- as.integer(as.vector(rbind(delta, b$n, b$area_ha)))
    n_tuplas <- n_tuplas + nrow(b)
  }
  dados_grade[[as.character(mi)]] <- por_classe
}

write(toJSON(list(
  res = RES_KDE, lon0 = LON0_KDE, lat0 = LAT0_KDE, nx = NX_KDE, ny = NY_KDE,
  classes = classes_tab, meses = meses_tab, dados = dados_grade
), auto_unbox = TRUE, digits = 4), "data/kde_grid.json")

cat(sprintf("   %.2f MB | %d tuplas (célula x mês x classe)\n",
    file.size("data/kde_grid.json") / 1e6, n_tuplas))

# =============================================================================
# 10. Metadados — a fonte da data exibida no painel
# =============================================================================
# Gravado no mesmo commit dos dados, então nunca diverge deles. Antes a data era
# injetada no index.html por `sed` no script de cron: se o R falhasse, ou se
# alguém atualizasse os dados à mão, o site anunciava uma data errada.
# =============================================================================
cat("\n10. Gerando data/meta.json...\n")

pct_protegida <- NA_real_
if (any(!is.na(tabela$protegida))) {
  pct_protegida <- round(
    100 * sum(tabela$area_km2[!is.na(tabela$protegida)], na.rm = TRUE) /
          sum(tabela$area_km2, na.rm = TRUE), 2)
}

meta <- list(
  gerado_em      = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  ultimo_alerta  = format(max(as.Date(tabela$view_date), na.rm = TRUE), "%Y-%m-%d"),
  primeiro_alerta = format(min(as.Date(tabela$view_date), na.rm = TRUE), "%Y-%m-%d"),
  total_alertas  = nrow(tabela),
  area_total_km2 = round(sum(tabela$area_km2, na.rm = TRUE), 2),
  pct_area_protegida = pct_protegida,
  fonte          = "DETER / INPE — TerraBrasilis"
)
write(toJSON(meta, auto_unbox = TRUE, digits = 2, na = "null", pretty = TRUE),
      "data/meta.json")
cat(sprintf("   dados até %s | %.2f%% da área em áreas protegidas\n",
    meta$ultimo_alerta, ifelse(is.na(pct_protegida), 0, pct_protegida)))

# =============================================================================
# 11. Limpeza dos formatos antigos
# =============================================================================
for (obsoleto in c("data/alertas_web.geojson", "data/kde_isolinhas.geojson")) {
  if (file.exists(obsoleto)) {
    file.remove(obsoleto)
    cat(sprintf("\n   removido formato antigo: %s\n", obsoleto))
  }
}

# =============================================================================
# Resumo
# =============================================================================
cat("\n=== ATUALIZAÇÃO CONCLUÍDA COM SUCESSO! ===\n")
cat("Gerados: alertas.json, ranking.json, series.json, kde_grid.json, meta.json\n")
cat(sprintf("Timestamp: %s\n\n", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))
