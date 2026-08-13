// =============================================================================
// GeomonitoR - Internacionalizacao (pt-BR / en)
// Dicionarios planos + aplicacao por atributo data-i18n.
// =============================================================================

const I18N = {
    pt: {
        'app.title':        'GeomonitoR da Amazônia',
        'app.subtitle':     'Monitoramento de supressão vegetal e degradação florestal por satélite',

        'meta.loading':     'Carregando dados…',
        'meta.dataUpto':    'Dados até',
        'meta.updated':     'atualizado em',

        'kpi.area':         'Área alertada',
        'kpi.alerts':       'Alertas',
        'kpi.yoy':          'vs. ano anterior',
        'kpi.protected':    'Em áreas protegidas',
        'kpi.topMuni':      'Município líder',

        'tabs.filters':     'Filtros',
        'tabs.ranking':     'Ranking',
        'tabs.analysis':    'Análise',

        'filters.temporal': 'Recorte temporal',
        'filters.year':     'Ano',
        'filters.month':    'Mês',
        'filters.allYears': 'Todos os anos',
        'filters.allMonths':'Todos os meses',
        'filters.class':    'Classes de alerta',
        'filters.all':      'Todas',
        'filters.none':     'Nenhuma',
        'filters.layers':   'Camadas do mapa',

        'layers.alerts':    'Alertas DETER',
        'layers.density':   'Densidade (KDE)',
        'layers.protected': 'Áreas protegidas',

        'density.title':    'Modelo de densidade',
        'density.metric':   'Ponderação',
        'density.byCount':  'Nº de alertas',
        'density.byArea':   'Área desmatada',
        'density.bandwidth':'Suavização',
        'density.bwAuto':   'Automática',
        'density.bwDetail': 'Detalhe',
        'density.bwStd':    'Padrão',
        'density.bwBroad':  'Ampla',
        'density.render':   'Representação',
        'density.contour':  'Isolinhas',
        'density.grid':     'Grade',
        'density.sigma':    'raio',



        'ranking.title':    'Ranking municipal',
        'ranking.muni':     'Município / UF',
        'ranking.area':     'Área (km²)',
        'ranking.change':   'Variação',
        'ranking.byArea':   'Maior área',
        'ranking.byTrend':  'Em alta',
        'ranking.empty':    'Nenhum dado para os filtros selecionados.',
        'ranking.zoomTo':   'Aproximar no mapa',

        'analysis.series':  'Área alertada por mês',
        'analysis.seasonal':'Sazonalidade (ano × mês)',
        'analysis.trending':'Municípios em alta',
        'analysis.compYear':'vs. ano anterior',
        'analysis.noData':  'Sem dados suficientes.',
        'analysis.trendHelp':'Maior aumento de área em relação ao mesmo recorte do ano anterior.',

        'legend.classes':   'Classes de alerta',
        'legend.density':   'Densidade de alertas',
        'legend.limits':    'Limites territoriais',
        'legend.low':       'Baixa',
        'legend.high':      'Alta',
        'legend.size':      'Área do alerta (km²)',
        'legend.legalAmz':  'Amazônia Legal',
        'legend.biome':     'Bioma Amazônia',
        'legend.indig':     'Terra Indígena',
        'legend.consUnit':  'Unidade de Conservação',
        'legend.capped':    'Exibindo os {n} maiores alertas do recorte',

        'player.play':      'Animar série temporal',
        'player.pause':     'Pausar',

        'popup.title':      'Alerta DETER',
        'popup.muni':       'Município',
        'popup.class':      'Classe',
        'popup.area':       'Área',
        'popup.date':       'Data',

        'a11y.lang':        'Alternar idioma',
        'a11y.skip':        'Ir para o mapa',

        'error.load':       'Erro ao carregar os dados. Tente recarregar a página (Ctrl+F5).',

        'class.DESMATAMENTO_CR':      'Corte raso',
        'class.DESMATAMENTO_VEG':     'Corte raso com vegetação',
        'class.DEGRADACAO':           'Degradação',
        'class.MINERACAO':            'Mineração',
        'class.CS_DESORDENADO':       'Corte seletivo desordenado',
        'class.CS_GEOMETRICO':        'Corte seletivo geométrico',
        'class.CICATRIZ_DE_QUEIMADA': 'Cicatriz de queimada',
        'class.OUTROS':               'Outros',

        'months': ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
        'monthsShort': ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    },

    en: {
        'app.title':        'Amazon GeomonitoR',
        'app.subtitle':     'Satellite monitoring of forest clearing and degradation',

        'meta.loading':     'Loading data…',
        'meta.dataUpto':    'Data through',
        'meta.updated':     'updated on',

        'kpi.area':         'Alerted area',
        'kpi.alerts':       'Alerts',
        'kpi.yoy':          'vs. previous year',
        'kpi.protected':    'In protected areas',
        'kpi.topMuni':      'Leading municipality',

        'tabs.filters':     'Filters',
        'tabs.ranking':     'Ranking',
        'tabs.analysis':    'Analysis',

        'filters.temporal': 'Time range',
        'filters.year':     'Year',
        'filters.month':    'Month',
        'filters.allYears': 'All years',
        'filters.allMonths':'All months',
        'filters.class':    'Alert classes',
        'filters.all':      'All',
        'filters.none':     'None',
        'filters.layers':   'Map layers',

        'layers.alerts':    'DETER alerts',
        'layers.density':   'Density (KDE)',
        'layers.protected': 'Protected areas',

        'density.title':    'Density model',
        'density.metric':   'Weighting',
        'density.byCount':  'Alert count',
        'density.byArea':   'Cleared area',
        'density.bandwidth':'Smoothing',
        'density.bwAuto':   'Automatic',
        'density.bwDetail': 'Detail',
        'density.bwStd':    'Standard',
        'density.bwBroad':  'Broad',
        'density.render':   'Rendering',
        'density.contour':  'Contours',
        'density.grid':     'Grid',
        'density.sigma':    'radius',



        'ranking.title':    'Municipal ranking',
        'ranking.muni':     'Municipality / State',
        'ranking.area':     'Area (km²)',
        'ranking.change':   'Change',
        'ranking.byArea':   'Largest area',
        'ranking.byTrend':  'Rising',
        'ranking.empty':    'No data for the selected filters.',
        'ranking.zoomTo':   'Zoom to on map',

        'analysis.series':  'Alerted area by month',
        'analysis.seasonal':'Seasonality (year × month)',
        'analysis.trending':'Rising municipalities',
        'analysis.compYear':'vs. previous year',
        'analysis.noData':  'Not enough data.',
        'analysis.trendHelp':'Largest area increase against the same range one year earlier.',

        'legend.classes':   'Alert classes',
        'legend.density':   'Alert density',
        'legend.limits':    'Territorial boundaries',
        'legend.low':       'Low',
        'legend.high':      'High',
        'legend.size':      'Alert area (km²)',
        'legend.legalAmz':  'Legal Amazon',
        'legend.biome':     'Amazon biome',
        'legend.indig':     'Indigenous land',
        'legend.consUnit':  'Conservation unit',
        'legend.capped':    'Showing the {n} largest alerts in range',

        'player.play':      'Animate time series',
        'player.pause':     'Pause',

        'popup.title':      'DETER alert',
        'popup.muni':       'Municipality',
        'popup.class':      'Class',
        'popup.area':       'Area',
        'popup.date':       'Date',

        'a11y.lang':        'Switch language',
        'a11y.skip':        'Skip to map',

        'error.load':       'Failed to load data. Try reloading the page (Ctrl+F5).',

        'class.DESMATAMENTO_CR':      'Clear-cut',
        'class.DESMATAMENTO_VEG':     'Clear-cut with vegetation',
        'class.DEGRADACAO':           'Degradation',
        'class.MINERACAO':            'Mining',
        'class.CS_DESORDENADO':       'Disordered selective logging',
        'class.CS_GEOMETRICO':        'Geometric selective logging',
        'class.CICATRIZ_DE_QUEIMADA': 'Burn scar',
        'class.OUTROS':               'Other',

        'months': ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'],
        'monthsShort': ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    }
};

const LOCALES = { pt: 'pt-BR', en: 'en-GB' };

let idioma = (() => {
    const salvo = localStorage.getItem('geomonitor.lang');
    if (salvo && I18N[salvo]) return salvo;
    return (navigator.language || 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en';
})();

/** Traduz uma chave. `vars` substitui marcadores {nome}. */
function t(chave, vars) {
    let s = I18N[idioma][chave];
    if (s === undefined) s = I18N.pt[chave] !== undefined ? I18N.pt[chave] : chave;
    if (vars && typeof s === 'string') {
        for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
    }
    return s;
}

const idiomaAtual = () => idioma;
const localeAtual = () => LOCALES[idioma];
const rotuloClasse = (c) => t(`class.${c}`);
const mesesCurtos  = () => t('monthsShort');

/** Formata numero no locale ativo. */
function num(v, casas = 0) {
    return v.toLocaleString(localeAtual(), {
        minimumFractionDigits: casas, maximumFractionDigits: casas
    });
}

/** Formata data ISO (YYYY-MM-DD) no locale ativo. */
function dataCurta(iso) {
    if (!iso) return '—';
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    return d.toLocaleDateString(localeAtual(), {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

/**
 * Aplica o idioma ativo a todo no marcado com data-i18n.
 * `data-i18n-attr` direciona a traducao para um atributo em vez do texto.
 */
function aplicarIdioma() {
    document.documentElement.lang = LOCALES[idioma];

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const chave = el.dataset.i18n;
        const alvo  = el.dataset.i18nAttr;
        if (alvo) el.setAttribute(alvo, t(chave));
        else      el.textContent = t(chave);
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });

    document.querySelectorAll('#lang-switch button').forEach(b => {
        const ativo = b.dataset.lang === idioma;
        b.classList.toggle('active', ativo);
        b.setAttribute('aria-pressed', String(ativo));
    });
}

function definirIdioma(novo) {
    if (!I18N[novo] || novo === idioma) return;
    idioma = novo;
    localStorage.setItem('geomonitor.lang', novo);
    aplicarIdioma();
    document.dispatchEvent(new CustomEvent('idiomamudou'));
}
