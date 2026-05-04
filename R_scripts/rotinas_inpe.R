# Rotinas para acessar a API do TerraBrasilis (INPE) via WFS
# Autor: Gemini CLI

# Configurar biblioteca local
.libPaths(c('~/amazonia_geomonitor/R_libs', .libPaths()))

library(sf)
library(dplyr)
library(httr)

#' Função genérica para baixar dados do INPE (TerraBrasilis) via API WFS
#' 
#' @param layer_name Nome da camada no GeoServer (ex: "deter-amz:deter_amz")
#' @param cql_filter Filtro CQL opcional para reduzir o download (ex: "uf='MT' AND year=2023")
#' @param max_features Limite de polígonos a baixar (ótimo para testes). Deixe NULL para baixar tudo.
#' @return Objeto sf com os dados solicitados
download_terrabrasilis_wfs <- function(layer_name, cql_filter = NULL, max_features = NULL) {
  
  base_url <- "https://terrabrasilis.dpi.inpe.br/geoserver/ows"
  
  # Parametros base obrigatorios para o servico WFS
  params <- list(
    service = "WFS",
    version = "1.0.0",
    request = "GetFeature",
    typeName = layer_name,
    outputFormat = "application/json"
  )
  
  if (!is.null(cql_filter)) {
    params$cql_filter <- cql_filter
  }
  
  if (!is.null(max_features)) {
    params$maxFeatures <- max_features
  }
  
  # Construir a URL com os parametros (httr cuida do URL encoding)
  req <- httr::modify_url(base_url, query = params)
  
  cat(sprintf("Baixando dados do INPE...\nCamada: %s\n", layer_name))
  if (!is.null(cql_filter)) cat(sprintf("Filtro: %s\n", cql_filter))
  
  # Baixar usando st_read, que le o GeoJSON nativamente e o converte em um dataframe espacial (sf)
  # Usa quiet = TRUE para nao sujar o console com logs do GDAL
  dados_sf <- tryCatch({
    st_read(req, quiet = TRUE)
  }, error = function(e) {
    stop("Erro ao baixar dados do WFS. Verifique o filtro ou tente reduzir o escopo da pesquisa.\n", e)
  })
  
  cat(sprintf("Sucesso! %d registros carregados.\n", nrow(dados_sf)))
  
  return(dados_sf)
}

#' Rotina amigável para baixar dados do DETER
#' 
#' @param bioma "amz" (Amazônia) ou "cerrado"
#' @param estado Sigla do estado (ex: "MT", "PA"). Opcional.
#' @param data_inicio Data inicial no formato "YYYY-MM-DD" para filtrar alertas recentes.
#' @param limite_linhas Limite para testes. Deixe NULL para download completo.
download_deter <- function(bioma = "amz", estado = NULL, data_inicio = "2024-01-01", limite_linhas = NULL) {
  
  camada <- ifelse(bioma == "amz", "deter-amz:deter_amz", "deter-cerrado-nb:deter_cerrado")
  
  filtros <- c()
  
  if (!is.null(estado)) {
    filtros <- c(filtros, sprintf("uf='%s'", estado))
  }
  
  if (!is.null(data_inicio)) {
    filtros <- c(filtros, sprintf("view_date >= '%s'", data_inicio))
  }
  
  # Juntar os filtros com AND
  filtro_final <- if(length(filtros) > 0) paste(filtros, collapse = " AND ") else NULL
  
  return(download_terrabrasilis_wfs(camada, cql_filter = filtro_final, max_features = limite_linhas))
}

#' Rotina amigável para baixar dados do PRODES Anual (Desmatamento Consolidado)
#' 
#' @param bioma "amz" (Amazônia Legal) ou "cerrado"
#' @param estado Sigla do estado (ex: "MT"). Opcional.
#' @param ano Ano alvo do PRODES (ex: 2022). Opcional.
#' @param limite_linhas Limite para testes. Deixe NULL para download completo.
download_prodes <- function(bioma = "amz", estado = NULL, ano = NULL, limite_linhas = NULL) {
  
  camada <- ifelse(bioma == "amz", 
                   "prodes-legal-amz:yearly_deforestation", 
                   "prodes-cerrado-nb:yearly_deforestation")
  
  filtros <- c()
  
  if (!is.null(estado)) {
    # No PRODES Amazônia a coluna se chama 'state'
    filtros <- c(filtros, sprintf("state='%s'", estado))
  }
  
  if (!is.null(ano)) {
    filtros <- c(filtros, sprintf("year=%s", ano))
  }
  
  filtro_final <- if(length(filtros) > 0) paste(filtros, collapse = " AND ") else NULL
  
  return(download_terrabrasilis_wfs(camada, cql_filter = filtro_final, max_features = limite_linhas))
}
