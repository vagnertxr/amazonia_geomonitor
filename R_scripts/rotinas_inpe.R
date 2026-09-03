# Rotinas para acessar a API do TerraBrasilis (INPE) via WFS

# Configurar biblioteca local
.libPaths(c('~/amazonia_geomonitor/R_libs', .libPaths()))

library(sf)
library(dplyr)
library(httr)

#' Função genérica para baixar dados do INPE (TerraBrasilis) via API WFS
#'
#' O GeoServer do INPE limita cada requisicao a 50.000 feicoes e nao avisa
#' quando trunca: a resposta simplesmente volta com o teto e parece completa.
#' Quebrar a consulta por ano nao resolve, porque anos grandes estouram o teto
#' sozinhos (2024 tem 81 mil alertas). Por isso paginamos com startIndex/count
#' ate a pagina vir incompleta.
#'
#' O sortBy nao e cosmetico: sem uma ordem definida o servidor pode devolver as
#' paginas em ordens diferentes, fazendo registros se repetirem numa pagina e
#' sumirem de outra.
#'
#' @param layer_name Nome da camada no GeoServer (ex: "deter-amz:deter_amz")
#' @param cql_filter Filtro CQL opcional para reduzir o download (ex: "uf='MT' AND year=2023")
#' @param max_features Limite de polígonos a baixar (ótimo para testes). Deixe NULL para baixar tudo.
#' @param sort_key Atributo(s) usados para ordenar a paginação, separados por
#'        vírgula. Obrigatorio de proposito: cada camada usa uma chave diferente
#'        e a errada faz o servidor responder 400, entao nao ha padrao seguro.
#'        Precisa identificar a feicao de forma unica, senao um empate na
#'        fronteira entre duas paginas pode repetir e perder registros. No DETER
#'        "gid" NAO serve sozinho (colide entre alertas sem relacao); use
#'        "gid,view_date,mun_geocod" na Amazonia e "gid,view_date,municipality"
#'        no Cerrado, que nao tem mun_geocod. No PRODES é "fid"; em TI/UC é "id".
#' @param page_size Tamanho de cada página. O teto do servidor é 50.000.
#' @return Objeto sf com os dados solicitados
download_terrabrasilis_wfs <- function(layer_name, cql_filter = NULL, max_features = NULL,
                                       sort_key, page_size = 50000) {

  base_url <- "https://terrabrasilis.dpi.inpe.br/geoserver/ows"

  cat(sprintf("Baixando dados do INPE...\nCamada: %s\n", layer_name))
  if (!is.null(cql_filter)) cat(sprintf("Filtro: %s\n", cql_filter))

  paginas  <- list()
  baixados <- 0

  repeat {
    n_pedir <- page_size
    if (!is.null(max_features)) {
      restante <- max_features - baixados
      if (restante <= 0) break
      n_pedir <- min(page_size, restante)
    }

    params <- list(
      service      = "WFS",
      version      = "2.0.0",   # startIndex/count so existem a partir da 2.0.0
      request      = "GetFeature",
      typeNames    = layer_name,
      outputFormat = "application/json",
      sortBy       = sort_key,
      count        = n_pedir,
      startIndex   = baixados
    )

    if (!is.null(cql_filter)) {
      params$cql_filter <- cql_filter
    }

    # Construir a URL com os parametros (httr cuida do URL encoding)
    req <- httr::modify_url(base_url, query = params)

    # Baixar usando st_read, que le o GeoJSON nativamente e o converte em um dataframe espacial (sf)
    # Usa quiet = TRUE para nao sujar o console com logs do GDAL
    pagina <- tryCatch({
      st_read(req, quiet = TRUE)
    }, error = function(e) {
      stop("Erro ao baixar dados do WFS. Verifique o filtro ou tente reduzir o escopo da pesquisa.\n", e)
    })

    # Guarda a primeira pagina mesmo vazia, para devolver um sf com as colunas
    # certas em vez de NULL quando o filtro nao casa com nada.
    if (nrow(pagina) == 0) {
      if (length(paginas) == 0) paginas[[1]] <- pagina
      break
    }

    paginas[[length(paginas) + 1]] <- pagina
    baixados <- baixados + nrow(pagina)

    if (nrow(pagina) < n_pedir) break   # pagina incompleta = acabou
    cat(sprintf("   ... %d registros, buscando mais\n", baixados))
  }

  dados_sf <- if (length(paginas) == 1) paginas[[1]] else do.call(rbind, paginas)

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

  # A camada do Cerrado nao tem mun_geocod; usa o nome do municipio.
  chave <- if (bioma == "amz") "gid,view_date,mun_geocod" else "gid,view_date,municipality"

  filtros <- c()
  
  if (!is.null(estado)) {
    filtros <- c(filtros, sprintf("uf='%s'", estado))
  }
  
  if (!is.null(data_inicio)) {
    filtros <- c(filtros, sprintf("view_date >= '%s'", data_inicio))
  }
  
  # Juntar os filtros com AND
  filtro_final <- if(length(filtros) > 0) paste(filtros, collapse = " AND ") else NULL
  
  return(download_terrabrasilis_wfs(camada, cql_filter = filtro_final,
                                    max_features = limite_linhas, sort_key = chave))
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

  # O PRODES identifica as feicoes por "fid"; o DETER usa "gid" (padrao da funcao).
  return(download_terrabrasilis_wfs(camada, cql_filter = filtro_final,
                                    max_features = limite_linhas, sort_key = "fid"))
}
