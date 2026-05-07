# =============================================================================
# Amazônia Geomonitor - Script Unificado de Processamento
# Abordagem: centroides (pontos) em vez de polígonos
# Vantagens: arquivo ~15-20 MB vs 200+ MB dos polígonos originais
# =============================================================================

source("R_scripts/rotinas_inpe.R")
library(sf)
library(dplyr)
library(jsonlite)
library(spatstat)
library(raster)
library(geobr)

sf::sf_use_s2(FALSE)

# --- CONFIGURAÇÕES ---
DATA_INICIO <- "2020-01-01"
CRS_UTM     <- 31981  # SIRGAS 2000 / UTM zone 21S

cat("\n=== INICIANDO ATUALIZAÇÃO: AMAZÔNIA GEOMONITOR ===\n")
cat(sprintf("Timestamp: %s\n", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))

# =============================================================================
# 1. Carregar Municípios (para cruzamento espacial)
# =============================================================================
cat("\n1. Carregando limites municipais (geobr)...\n")
municipios_br <- read_municipality(year = 2020, showProgress = FALSE) %>%
  st_transform(4326)

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

alertas_validados <- st_make_valid(alertas_proc)

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
  select(
    classname, classe, view_date,
    area_km2,
    name_muni, abbrev_state,
    ano, mes, periodo
  ) %>%
  # Converter geometria para centroide
  st_centroid()

cat(sprintf("   %d centroides gerados\n", nrow(alertas_centroides)))

# =============================================================================
# 5. Exportar GeoJSON de Alertas (pontos)
# =============================================================================
cat("\n5. Exportando data/alertas_web.geojson...\n")

arquivo_alertas <- "data/alertas_web.geojson"
if (file.exists(arquivo_alertas)) file.remove(arquivo_alertas)
st_write(alertas_centroides, arquivo_alertas, driver = "GeoJSON",
         layer_options = "COORDINATE_PRECISION=5",
         quiet = TRUE)

tamanho_mb <- file.size(arquivo_alertas) / 1e6
cat(sprintf("   %.1f MB\n", tamanho_mb))

# =============================================================================
# 6. Gerar Ranking JSON
# =============================================================================
cat("\n6. Gerando data/ranking.json...\n")

ranking_data <- alertas_centroides %>%
  st_drop_geometry() %>%
  mutate(
    ano     = as.numeric(ano),
    mes     = as.numeric(mes),
    periodo = as.character(periodo),
    muni    = as.character(name_muni),
    uf      = as.character(abbrev_state),
    classe  = as.character(classe)
  ) %>%
  group_by(ano, mes, periodo, muni, uf, classe) %>%
  summarise(
    total_alertas = n(),
    area_km2      = sum(area_km2, na.rm = TRUE),
    .groups       = "drop"
  )

write_json(ranking_data, "data/ranking.json", pretty = TRUE)
cat(sprintf("   %d linhas exportadas\n", nrow(ranking_data)))

# =============================================================================
# 7. Cálculo de KDE por Período
# =============================================================================
# Centroides já são pontos — não precisa mais de st_centroid() no loop
# =============================================================================
cat("\n7. Calculando KDE (Mensal, Anual e Global)...\n")

todos_contornos <- list()

cenarios_mensal <- alertas_centroides %>%
  st_drop_geometry() %>%
  group_by(periodo) %>%
  summarise(n = n()) %>%
  filter(n >= 10) %>%
  pull(periodo)

cenarios_anual <- alertas_centroides %>%
  st_drop_geometry() %>%
  mutate(ano_chr = as.character(ano)) %>%
  group_by(ano_chr) %>%
  summarise(n = n()) %>%
  filter(n >= 10) %>%
  pull(ano_chr)

cenarios <- c(cenarios_mensal, cenarios_anual, "Todos")
cat(sprintf("   %d cenários (%d mensais, %d anuais, + global)\n",
    length(cenarios), length(cenarios_mensal), length(cenarios_anual)))

for (c_id in cenarios) {
  cat(sprintf("   - %s ... ", c_id))

  if (c_id == "Todos") {
    alertas_p <- alertas_centroides %>% st_transform(CRS_UTM)
  } else if (grepl("/", c_id)) {
    alertas_p <- alertas_centroides %>% filter(periodo == c_id) %>% st_transform(CRS_UTM)
  } else {
    alertas_p <- alertas_centroides %>% filter(as.character(ano) == c_id) %>% st_transform(CRS_UTM)
  }

  if (nrow(alertas_p) < 10) { cat("pulado\n"); next }

  # Centroides já são pontos — usar coordenadas diretamente
  coords <- st_coordinates(alertas_p)
  bbox   <- st_bbox(alertas_p)

  W     <- owin(xrange = c(bbox["xmin"], bbox["xmax"]),
                yrange = c(bbox["ymin"], bbox["ymax"]))
  ppp_p <- tryCatch(ppp(x = coords[,1], y = coords[,2], window = W), error = function(e) NULL)
  if (is.null(ppp_p)) { cat("erro ppp\n"); next }

  dens <- tryCatch(density(ppp_p, sigma = 50000, eps = 5000), error = function(e) NULL)
  if (is.null(dens)) { cat("erro density\n"); next }

  r_kde      <- raster(dens)
  crs(r_kde) <- st_crs(CRS_UTM)$proj4string
  r_wgs84    <- tryCatch(
    projectRaster(r_kde, crs = "+proj=longlat +datum=WGS84 +no_defs"),
    error = function(e) NULL
  )
  if (is.null(r_wgs84)) { cat("erro reproj\n"); next }

  niveis    <- seq(min(values(r_wgs84), na.rm = TRUE),
                   max(values(r_wgs84), na.rm = TRUE),
                   length.out = 8)
  contornos <- tryCatch(rasterToContour(r_wgs84, levels = niveis), error = function(e) NULL)
  if (is.null(contornos)) { cat("erro contorno\n"); next }

  todos_contornos[[c_id]] <- st_as_sf(contornos) %>% mutate(periodo = c_id)
  cat(sprintf("OK (%d isolinhas)\n", nrow(todos_contornos[[c_id]])))
}

# =============================================================================
# 8. Exportar KDE GeoJSON
# =============================================================================
cat("\n8. Exportando data/kde_isolinhas.geojson...\n")

if (length(todos_contornos) > 0) {
  kde_final   <- do.call(rbind, todos_contornos)
  arquivo_kde <- "data/kde_isolinhas.geojson"
  if (file.exists(arquivo_kde)) file.remove(arquivo_kde)
  st_write(kde_final, arquivo_kde, driver = "GeoJSON", quiet = TRUE)
  cat(sprintf("   %d features | %.1f MB\n",
      nrow(kde_final), file.size(arquivo_kde) / 1e6))
} else {
  cat("   AVISO: nenhum KDE gerado.\n")
}

# =============================================================================
# Resumo
# =============================================================================
cat("\n=== ATUALIZAÇÃO CONCLUÍDA COM SUCESSO! ===\n")
cat("Arquivos gerados: alertas_web.geojson, ranking.json, kde_isolinhas.geojson\n")
cat(sprintf("Timestamp: %s\n\n", format(Sys.time(), "%Y-%m-%d %H:%M:%S")))