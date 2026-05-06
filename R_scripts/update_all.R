# Amazônia Geomonitor - Script Unificado de Processamento
# Autor: Gemini CLI

source("R_scripts/rotinas_inpe.R")
library(sf)
library(dplyr)
library(jsonlite)
library(spatstat)
library(raster)

sf::sf_use_s2(FALSE)

# --- CONFIGURAÇÕES ---
ANOS_ALVO <- c(2024, 2025, 2026)
DATA_INICIO <- "2024-01-01"
LIMITE_ALERTAS <- 20000 # Aumentando para robustez
CRS_UTM <- 31981 # SIRGAS 2000 / UTM zone 21S

cat("\n=== INICIANDO ATUALIZAÇÃO: AMAZÔNIA GEOMONITOR ===\n")

# 1. Baixar Alertas DETER
cat("1. Baixando alertas DETER do INPE...\n")
alertas_raw <- download_deter(bioma = "amz", data_inicio = DATA_INICIO, limite_linhas = LIMITE_ALERTAS)

# 2. Processamento de Atributos
cat("2. Processando atributos...\n")
alertas_proc <- alertas_raw %>%
  st_transform(4326) %>%
  # Remover geometrias pontuais para evitar erros de renderização
  filter(as.character(st_geometry_type(geometry)) %in% c("POLYGON", "MULTIPOLYGON")) %>%
  mutate(
    view_date = as.Date(view_date),
    ano = as.numeric(format(view_date, "%Y")),
    mes = as.numeric(format(view_date, "%m")),
    periodo = format(view_date, "%m/%Y"),
    # Usar colunas padrão do WFS DETER
    muni = as.character(municipality),
    uf_sigla = as.character(uf),
    # Preencher name_muni e abbrev_state para retrocompatibilidade no app.js
    name_muni = as.character(municipality),
    abbrev_state = as.character(uf),
    # Normalizar classes para facilitar filtro
    classe = ifelse(is.na(classname), "OUTROS", toupper(classname))
  ) %>%
  # Garante que a área seja maior que 0
  filter(areamunkm > 0 | areauckm > 0)

alertas_validados <- st_make_valid(alertas_proc)

# 3. Exportar GeoJSON de Alertas
cat("3. Exportando data/alertas_web.geojson...\n")
arquivo_alertas <- "data/alertas_web.geojson"
if(file.exists(arquivo_alertas)) file.remove(arquivo_alertas)
st_write(alertas_validados, arquivo_alertas, driver = "GeoJSON", quiet = TRUE)

# 4. Gerar Ranking JSON
cat("4. Gerando Ranking JSON...\n")
ranking_data <- alertas_validados %>%
  st_drop_geometry() %>%
  group_by(ano, mes, periodo, muni, uf_sigla, classe) %>%
  summarise(
    total_alertas = n(),
    area_km2 = sum(areamunkm, na.rm = TRUE),
    .groups = "drop"
  ) %>%
  rename(uf = uf_sigla)

write_json(ranking_data, "data/ranking.json", pretty = TRUE)

# 5. Cálculo de KDE (Kernel Density) por Período
cat("5. Calculando KDE (Mensal, Anual e Global)...\n")

todos_contornos <- list()

# Cenários: Mensal (MM/YYYY)
cenarios_mensal <- alertas_validados %>%
  st_drop_geometry() %>%
  group_by(periodo) %>%
  summarise(n = n()) %>%
  filter(n >= 10) %>%
  pull(periodo)

# Cenários: Anual (YYYY)
cenarios_anual <- alertas_validados %>%
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
    alertas_p <- alertas_validados %>% st_transform(CRS_UTM)
  } else if (grepl("/", c_id)) {
    alertas_p <- alertas_validados %>% filter(periodo == c_id) %>% st_transform(CRS_UTM)
  } else {
    alertas_p <- alertas_validados %>% filter(as.character(ano) == c_id) %>% st_transform(CRS_UTM)
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
cat("6. Unificando e exportando KDE GeoJSON...\n")
kde_final <- do.call(rbind, todos_contornos)
arquivo_kde <- "data/kde_isolinhas.geojson"
if(file.exists(arquivo_kde)) file.remove(arquivo_kde)
st_write(kde_final, arquivo_kde, driver = "GeoJSON", quiet = TRUE)

cat("\n=== ATUALIZAÇÃO CONCLUÍDA COM SUCESSO! ===\n")