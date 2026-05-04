# Script auxiliar para baixar limites de bioma e amazonia legal
source("rotinas_inpe.R")
library(geobr)
library(sf)
library(dplyr)

sf::sf_use_s2(FALSE)

cat("Baixando limite da Amazônia Legal...\n")
amz_legal <- read_amazon(year = 2012, showProgress = FALSE) %>% st_transform(4326)

# O arquivo GeoJSON original mantem muitos atributos, vamos exportar direto
st_write(amz_legal, "amazonia_legal.geojson", driver="GeoJSON", delete_layer=TRUE, quiet=TRUE)

cat("Baixando limite do Bioma Amazônia...\n")
biomas <- read_biomes(year = 2019, showProgress = FALSE) %>% st_transform(4326)
bioma_amz <- biomas %>% filter(name_biome == "Amazônia")
st_write(bioma_amz, "bioma_amazonia.geojson", driver="GeoJSON", delete_layer=TRUE, quiet=TRUE)

cat("Concluído!\n")