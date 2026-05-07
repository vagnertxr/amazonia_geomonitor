// =============================================================================
// Amazônia Geomonitor - App Engine
// Alertas como círculos proporcionais à área (centroides)
// =============================================================================

// -----------------------------------------------------------------------------
// CONSTANTES E LOOKUP TABLES
// -----------------------------------------------------------------------------

const classColors = {
    'DESMATAMENTO_CR':      '#ef4444',
    'DESMATAMENTO_VEG':     '#b91c1c',
    'DEGRADACAO':           '#f97316',
    'MINERACAO':            '#a855f7',
    'CS_DESORDENADO':       '#f59e0b',
    'CS_GEOMETRICO':        '#eab308',
    'CICATRIZ_DE_QUEIMADA': '#78716c',
    'OUTROS':               '#94a3b8'
};

const classLabels = {
    'DESMATAMENTO_CR':      'Corte Raso',
    'DESMATAMENTO_VEG':     'Corte Raso com Vegetação',
    'DEGRADACAO':           'Degradação',
    'MINERACAO':            'Mineração',
    'CS_DESORDENADO':       'Corte Seletivo Desordenado',
    'CS_GEOMETRICO':        'Corte Seletivo Geométrico',
    'CICATRIZ_DE_QUEIMADA': 'Cicatriz de Queimada',
    'OUTROS':               'Outros'
};

const kdeColors = ['#f59e0b', '#f97316', '#ef4444', '#dc2626', '#b91c1c', '#991b1b'];

// -----------------------------------------------------------------------------
// FUNÇÕES DE ESTILO
// Declaradas ANTES de `state` para evitar ReferenceError na criação das camadas
// -----------------------------------------------------------------------------

/**
 * Raio proporcional à área do alerta.
 * Escala: raiz quadrada da área em km² × fator visual.
 * Mínimo de 3px para alertas muito pequenos não sumam no mapa.
 */
function raioAlerta(area_km2) {
    return Math.max(3, Math.sqrt(area_km2) * 2.5);
}

function estiloAlerta(feature) {
    const classe   = feature.properties.classe || 'OUTROS';
    const color    = classColors[classe] || classColors['OUTROS'];
    const area     = parseFloat(feature.properties.area_km2) || 0;
    return {
        radius:      raioAlerta(area),
        fillColor:   color,
        color:       color,
        weight:      1,
        opacity:     0.9,
        fillOpacity: 0.5
    };
}

function estiloKde(feature) {
    const level      = parseFloat(feature.properties.level) || 0;
    const normalized = Math.min(Math.max(level, 0), 1);
    const idx        = Math.min(Math.floor(normalized * kdeColors.length), kdeColors.length - 1);
    return { color: kdeColors[idx], weight: 1.5, opacity: 0.75, fillOpacity: 0 };
}

// -----------------------------------------------------------------------------
// INICIALIZAÇÃO DO MAPA
// -----------------------------------------------------------------------------

const map = L.map('map').setView([-10, -55], 5);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom:     19,
    attribution: '&copy; CARTO | Dados: INPE (DETER) | Elaborado por <a href="https://github.com/vagnertxr" target="_blank">Vagner Teixeira</a>'
}).addTo(map);

// -----------------------------------------------------------------------------
// ESTADO GLOBAL
// Alertas usam L.geoJSON com pointToLayer para renderizar como circleMarker
// -----------------------------------------------------------------------------

let state = {
    alertasRaw: null,
    kdeRaw:     null,
    rankingRaw: [],
    filtros: {
        ano:     '2026',
        mes:     'Todos',
        classes: new Set()
    },
    camadas: {
        alertas: L.geoJSON(null, {
            pointToLayer:   (feature, latlng) => L.circleMarker(latlng, estiloAlerta(feature)),
            onEachFeature:  onEachFeatureAlertas
        }),
        kde: L.geoJSON(null, { style: estiloKde })
    }
};

// -----------------------------------------------------------------------------
// LIMITES PERMANENTES
// -----------------------------------------------------------------------------

fetch('data/amazonia_legal.geojson')
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (!data) return;
        L.geoJSON(data, { style: { color: '#ffffff', weight: 1, fillOpacity: 0, dashArray: '4,4' }, interactive: false }).addTo(map);
    }).catch(err => console.warn('amazonia_legal.geojson:', err));

fetch('data/bioma_amazonia.geojson')
    .then(r => r.ok ? r.json() : null)
    .then(data => { if (!data) return;
        L.geoJSON(data, { style: { color: '#10b981', weight: 1, fillOpacity: 0, dashArray: '4,4' }, interactive: false }).addTo(map);
    }).catch(err => console.warn('bioma_amazonia.geojson:', err));

state.camadas.alertas.addTo(map);
state.camadas.kde.addTo(map);

// -----------------------------------------------------------------------------
// POPUP DE ALERTAS
// -----------------------------------------------------------------------------

function onEachFeatureAlertas(feature, layer) {
    const p           = feature.properties;
    const area        = parseFloat(p.area_km2) || 0;
    const areaHa      = area * 100;
    const labelClasse = classLabels[p.classe] || p.classe || 'Outros';

    layer.bindPopup(`
        <div class="popup-title">Alerta DETER</div>
        <b>Município:</b> ${p.name_muni || 'N/A'} - ${p.abbrev_state || ''}<br/>
        <b>Classe:</b> ${labelClasse}<br/>
        <b>Área:</b> ${area > 0 && area < 0.01 ? '&lt; 0.01' : area.toFixed(2)} km²
                 (${areaHa.toFixed(2)} ha)<br/>
        <b>Data:</b> ${p.view_date}
    `, { className: 'custom-popup' });
}

// -----------------------------------------------------------------------------
// FILTRAGEM
// -----------------------------------------------------------------------------

function applyFilters() {
    if (!state.alertasRaw) return;

    // 1. Alertas no mapa (pontos — sem filtro de geometria Polygon)
    const alertasFiltrados = state.alertasRaw.features.filter(f => {
        const p        = f.properties;
        const [y, m]   = p.view_date.split('-');
        const matchAno    = state.filtros.ano === 'Todos' || y === state.filtros.ano;
        const matchMes    = state.filtros.mes === 'Todos' || m === state.filtros.mes;
        const matchClasse = state.filtros.classes.has(p.classe || 'OUTROS');
        return matchAno && matchMes && matchClasse;
    });

    state.camadas.alertas.clearLayers();
    if (document.getElementById('toggle-alerts').checked) {
        state.camadas.alertas.addData(alertasFiltrados);
    }

    // 2. KDE no mapa
    state.camadas.kde.clearLayers();
    if (document.getElementById('toggle-kde').checked && state.kdeRaw) {
        let periodTarget = 'Todos';
        if (state.filtros.ano !== 'Todos' && state.filtros.mes !== 'Todos') {
            periodTarget = `${state.filtros.mes}/${state.filtros.ano}`;
        } else if (state.filtros.ano !== 'Todos' && state.filtros.mes === 'Todos') {
            periodTarget = state.filtros.ano;
        } else if (state.filtros.ano === 'Todos' && state.filtros.mes !== 'Todos') {
            periodTarget = null;
        }

        if (periodTarget) {
            const kdeFiltrado = state.kdeRaw.features.filter(
                f => f.properties.periodo === periodTarget
            );
            if (kdeFiltrado.length > 0) state.camadas.kde.addData(kdeFiltrado);
        }
    }

    // 3. Tabela de ranking
    updateRankingTable();
}

// -----------------------------------------------------------------------------
// TABELA DE RANKING MUNICIPAL
// -----------------------------------------------------------------------------

function updateRankingTable() {
    const tbody      = document.querySelector('#ranking-table tbody');
    const statsCount = document.getElementById('stats-count');

    const rankingFiltrado = state.rankingRaw.filter(item => {
        const matchAno    = state.filtros.ano === 'Todos' || String(item.ano) === state.filtros.ano;
        const matchMes    = state.filtros.mes === 'Todos' || String(item.mes).padStart(2, '0') === state.filtros.mes;
        const matchClasse = state.filtros.classes.has(item.classe);
        return matchAno && matchMes && matchClasse;
    });

    const muniAgg = {};
    rankingFiltrado.forEach(item => {
        const key = `${item.muni}-${item.uf}`;
        if (!muniAgg[key]) muniAgg[key] = { muni: item.muni, uf: item.uf, area: 0, alerts: 0 };
        muniAgg[key].area   += item.area_km2;
        muniAgg[key].alerts += item.total_alertas;
    });

    const rankingSorted = Object.values(muniAgg).sort((a, b) => b.area - a.area).slice(0, 50);

    tbody.innerHTML = '';
    if (rankingSorted.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="loading">Nenhum dado para os filtros selecionados.</td></tr>';
    } else {
        rankingSorted.forEach(item => {
            const tr          = document.createElement('tr');
            const muniEscaped = item.muni.replace(/'/g, "\\'");
            tr.innerHTML = `
                <td><span class="muni-name">${item.muni}</span> <span class="uf-tag">${item.uf}</span></td>
                <td class="text-right text-danger">${item.area.toFixed(2)}</td>
                <td class="text-right"><button class="zoom-btn" onclick="zoomToMuni('${muniEscaped}')">🔍</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    const total = rankingFiltrado.reduce((acc, b) => acc + b.total_alertas, 0);
    statsCount.textContent = `${total.toLocaleString('pt-BR')} alertas`;
}

// -----------------------------------------------------------------------------
// ZOOM PARA MUNICÍPIO
// -----------------------------------------------------------------------------

window.zoomToMuni = (muniName) => {
    // Para pontos, getBounds() retorna um ponto — usamos setView com zoom fixo
    const layers = state.camadas.alertas.getLayers();
    const layer  = layers.find(
        l => (l.feature.properties.name_muni || '').toLowerCase() === muniName.toLowerCase()
    );
    if (layer) {
        map.setView(layer.getLatLng(), 10);
    } else {
        console.warn(`zoomToMuni: "${muniName}" não encontrado.`);
    }
};

// -----------------------------------------------------------------------------
// INICIALIZAÇÃO DOS FILTROS
// -----------------------------------------------------------------------------

function initFilters(ranking) {
    const years = [...new Set(ranking.map(i => String(i.ano)))].sort().reverse();

    const yearSelect = document.getElementById('filter-year');
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = y;
        yearSelect.appendChild(opt);
    });
    if (years.includes('2026')) yearSelect.value = '2026';

    const monthSelect = document.getElementById('filter-month');
    for (let i = 1; i <= 12; i++) {
        const val = String(i).padStart(2, '0');
        const opt = document.createElement('option');
        opt.value = opt.textContent = val;
        monthSelect.appendChild(opt);
    }

    const classes = [...new Set(ranking.map(i => i.classe))].sort();

    const classContainer         = document.getElementById('class-filters');
    const legendClassesContainer = document.getElementById('legend-classes');
    legendClassesContainer.innerHTML = '';

    classes.forEach(c => {
        state.filtros.classes.add(c);

        const color = classColors[c] || classColors['OUTROS'];
        const label = classLabels[c]  || c.replace(/_/g, ' ');

        const lbl     = document.createElement('label');
        lbl.className = 'class-chip active';
        lbl.innerHTML = `
            <input type="checkbox" value="${c}" checked>
            <span class="color-dot" style="background: ${color};"></span>
            <span>${label}</span>
        `;
        lbl.querySelector('input').addEventListener('change', e => {
            if (e.target.checked) { lbl.classList.add('active');    state.filtros.classes.add(c); }
            else                  { lbl.classList.remove('active'); state.filtros.classes.delete(c); }
            applyFilters();
        });
        classContainer.appendChild(lbl);

        const legItem     = document.createElement('div');
        legItem.className = 'scale-item';
        legItem.innerHTML = `<span class="color-dot" style="background: ${color};"></span> ${label}`;
        legendClassesContainer.appendChild(legItem);
    });

    yearSelect.addEventListener('change',  e => { state.filtros.ano = e.target.value; applyFilters(); });
    monthSelect.addEventListener('change', e => { state.filtros.mes = e.target.value; applyFilters(); });
    document.getElementById('toggle-alerts').addEventListener('change', applyFilters);
    document.getElementById('toggle-kde').addEventListener('change',    applyFilters);
}

// -----------------------------------------------------------------------------
// CARREGAMENTO DE DADOS
// -----------------------------------------------------------------------------

Promise.all([
    fetch('data/alertas_web.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/kde_isolinhas.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/ranking.json').then(r => r.ok ? r.json() : null).catch(() => null)
]).then(([alertas, kde, ranking]) => {
    if (!alertas || !ranking) {
        document.querySelector('#ranking-table tbody').innerHTML =
            '<tr><td colspan="3" class="text-danger">Erro ao carregar dados. Tente Ctrl+F5.</td></tr>';
        return;
    }
    state.alertasRaw = alertas;
    state.kdeRaw     = kde;
    state.rankingRaw = ranking;

    initFilters(ranking);
    applyFilters();

    if (state.camadas.alertas.getLayers().length > 0) {
        map.fitBounds(state.camadas.alertas.getBounds(), { padding: [20, 20] });
    }
}).catch(err => {
    console.error('Erro fatal:', err);
    document.querySelector('#ranking-table tbody').innerHTML =
        '<tr><td colspan="3" class="text-danger">Erro fatal. Veja o console (F12).</td></tr>';
});