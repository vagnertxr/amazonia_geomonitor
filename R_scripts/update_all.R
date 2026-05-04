# Amazônia Geomonitor - Script Unificado de Processamento
# Autor: Gemini CLI

source("R_scripts/rotinas_inpe.R")
library(sf)
library(dplyr)
library(jsonlite)
library(spatstat)
library(raster)
library(geobr)

sf::sf_use_s2(FALSE)

# --- CONFIGURAÇÕES ---
ANOS_ALVO <- c(2024, 2025, 2026)
DATA_INICIO <- "2024-01-01"
LIMITE_ALERTAS <- 20000 # Aumentando para robustez
CRS_UTM <- 31981 # SIRGAS 2000 / UTM zone 21S

cat("\n=== INICIANDO ATUALIZAÇÃO: AMAZÔNIA GEOMONITOR ===\n")

# 1. Carregar Municípios (Para Cruzamento)
cat("1. Carregando limites municipais (geobr)...\n")
municipios_br <- read_municipality(year = 2020, showProgress = FALSE) %>%
  st_transform(4326)

# 2. Baixar Alertas DETER
cat("2. Baixando alertas DETER do INPE...\n")
alertas_raw <- download_deter(bioma = "amz", data_inicio = DATA_INICIO, limite_linhas = LIMITE_ALERTAS)

# 3. Processamento de Atributos e Cruzamento Espacial
cat("3. Processando atributos e cruzando com municípios...\n")
alertas_proc <- alertas_raw %>%
  st_transform(4326) %>%
  mutate(
    view_date = as.Date(view_date),
    ano = as.numeric(format(view_date, "%Y")),
    mes = as.numeric(format(view_date, "%m")),
    periodo = format(view_date, "%m/%Y"),
    # Normalizar classes para facilitar filtro
    classe = ifelse(is.na(classname), "OUTROS", toupper(classname))
  ) %>%
  # Garante que a área seja maior que 0
  filter(areamunkm > 0 | areauckm > 0)

# CORREÇÃO RANKING: st_join com validade de geometria e tratamento de NAs
alertas_validados <- st_make_valid(alertas_proc)
alertas_cruzados <- st_join(alertas_validados, municipios_br, join = st_intersects) %>%
  # Remove geometrias residuais (Pontos/Linhas) geradas pela validação ou cruzamento
  filter(as.character(st_geometry_type(.)) %in% c("POLYGON", "MULTIPOLYGON"))

# 4. Exportar GeoJSON de Alertas (Dados Brutos para o Mapa)
cat("4. Exportando data/alertas_web.geojson...\n")
arquivo_alertas <- "data/alertas_web.geojson"
if(file.exists(arquivo_alertas)) file.remove(arquivo_alertas)
st_write(alertas_cruzados, arquivo_alertas, driver = "GeoJSON", quiet = TRUE)

# 5. Gerar Ranking JSON (Multidimensional: Ano, Mês, Classe)
cat("5. Gerando Ranking JSON...\n")
# Converter colunas para tipos básicos para evitar erros no JSON
ranking_data <- alertas_cruzados %>%
  st_drop_geometry() %>%
  mutate(
    ano = as.numeric(ano),
    mes = as.numeric(mes),
    periodo = as.character(periodo),
    muni = as.character(name_muni),
    uf = as.character(abbrev_state),
    classe = as.character(classe)
  ) %>%
  group_by(ano, mes, periodo, muni, uf, classe) %>%
  summarise(
    total_alertas = n(),
    area_km2 = sum(areauckm, na.rm = TRUE),
    .groups = "drop"
  )

write_json(ranking_data, "data/ranking.json", pretty = TRUE)

# 6. Cálculo de KDE (Kernel Density) por Período
cat("6. Calculando KDE (Mensal, Anual e Global)...\n")

# Lista para armazenar todos os contornos
todos_contornos <- list()

# Cenários: Mensal (MM/YYYY)
cenarios_mensal <- alertas_cruzados %>%
  st_drop_geometry() %>%
  group_by(periodo) %>%
  summarise(n = n()) %>%
  filter(n >= 10) %>%
  pull(periodo)

# Cenários: Anual (YYYY)
cenarios_anual <- alertas_cruzados %>%
  st_drop_geometry() %>%
  mutate(ano_chr = as.character(ano)) %>%
  group_by(ano_chr) %>%
  summarise(n = n()) %>%
  filter(n >= 10) %>%
  pull(ano_chr)

cenarios <- c(cenarios_mensal, cenarios_anual, "Todos")

for (c_id in cenarios) {
  cat(sprintf(" - Processando KDE para %s...\n", c_id))
  
  if (c_id == "Todos") {
    alertas_p <- alertas_cruzados %>% st_transform(CRS_UTM)
  } else if (grepl("/", c_id)) {
    alertas_p <- alertas_cruzados %>% filter(periodo == c_id) %>% st_transform(CRS_UTM)
  } else {
    alertas_p <- alertas_cruzados %>% filter(as.character(ano) == c_id) %>% st_transform(CRS_UTM)
  }
  
  if(nrow(alertas_p) < 10) next
  
  pontos_p <- st_centroid(alertas_p)
  coords <- st_coordinates(pontos_p)
  
  bbox <- st_bbox(pontos_p)
  W <- owin(xrange = c(bbox["xmin"], bbox["xmax"]), yrange = c(bbox["ymin"], bbox["ymax"]))
  
  ppp_p <- ppp(x = coords[,1], y = coords[,2], window = W)
  
  # Densidade (sigma 50km, res 5km para performance web)
  dens <- density(ppp_p, sigma = 50000, eps = 5000)
  
  r_kde <- raster(dens)
  crs(r_kde) <- st_crs(CRS_UTM)$proj4string
  r_wgs84 <- projectRaster(r_kde, crs = "+proj=longlat +datum=WGS84 +no_defs")
  
  # Isolinhas
  niveis <- seq(min(values(r_wgs84), na.rm=T), max(values(r_wgs84), na.rm=T), length.out = 8)
  contornos <- rasterToContour(r_wgs84, levels = niveis)
  contornos_sf <- st_as_sf(contornos) %>% mutate(periodo = c_id)
  
  todos_contornos[[c_id]] <- contornos_sf
}

# Unificar todos os KDEs em um único GeoJSON
cat("7. Unificando e exportando KDE GeoJSON...\n")
kde_final <- do.call(rbind, todos_contornos)
arquivo_kde <- "data/kde_isolinhas.geojson"
if(file.exists(arquivo_kde)) file.remove(arquivo_kde)
st_write(kde_final, arquivo_kde, driver = "GeoJSON", quiet = TRUE)

cat("\n=== ATUALIZAÇÃO CONCLUÍDA COM SUCESSO! ===\n")
cat("Arquivos gerados: alertas_web.geojson, ranking.json, kde_isolinhas.geojson\n")
