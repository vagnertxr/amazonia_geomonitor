// Amazônia Geomonitor - App Engine
// Inicializa o mapa centralizado no Brasil
const map = L.map('map').setView([-10, -55], 5);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; CARTO | Dados: DETER (INPE) | Elaborado por <a href="https://github.com/vagnertxr" target="_blank">Vagner Teixeira</a>'
}).addTo(map);

// Estado global da aplicação
let state = {
    alertasRaw: null,
    kdeRaw: null,
    rankingRaw: [],
    filtros: {
        ano: '2026',
        mes: 'Todos',
        classes: new Set()
    },
    camadas: {
        alertas: L.geoJSON(null, { style: estiloAlerta, onEachFeature: onEachFeatureAlertas }),
        kde: L.geoJSON(null, { style: estiloKde })
    }
};

// Cores das classes
const classColors = {
    'DESMATAMENTO_CR': '#ef4444',     // Red 500
    'DESMATAMENTO_VEG': '#b91c1c',    // Red 700
    'DEGRADACAO': '#f97316',          // Orange 500
    'MINERACAO': '#a855f7',           // Purple 500
    'CS_DESORDENADO': '#f59e0b',      // Amber 500
    'CS_GEOMETRICO': '#eab308',       // Yellow 500
    'CICATRIZ_DE_QUEIMADA': '#78716c',// Stone 500
    'OUTROS': '#94a3b8'               // Slate 400
};

// Nomes amigáveis das classes
const classLabels = {
    'DESMATAMENTO_CR': 'Corte Raso',
    'DESMATAMENTO_VEG': 'Corte Raso com Vegetação',
    'DEGRADACAO': 'Degradação',
    'MINERACAO': 'Mineração',
    'CS_DESORDENADO': 'Corte Seletivo Desordenado',
    'CS_GEOMETRICO': 'Corte Seletivo Geométrico',
    'CICATRIZ_DE_QUEIMADA': 'Cicatriz de Queimada',
    'OUTROS': 'Outros'
};

// Carrega Limites Permanentes
fetch('data/amazonia_legal.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, {
            style: { color: '#ffffff', weight: 1, fillOpacity: 0, dashArray: '4,4' },
            interactive: false
        }).addTo(map);
    });

fetch('data/bioma_amazonia.geojson')
    .then(r => r.json())
    .then(data => {
        L.geoJSON(data, {
            style: { color: '#10b981', weight: 1, fillOpacity: 0, dashArray: '4,4' },
            interactive: false
        }).addTo(map);
    });

state.camadas.alertas.addTo(map);
state.camadas.kde.addTo(map);

// --- 1. ESTILOS ---

function estiloAlerta(feature) {
    const classe = feature.properties.classname || 'OUTROS';
    const color = classColors[classe] || classColors['OUTROS'];
    return {
        fillColor: color, 
        weight: 1, opacity: 1, color: color, fillOpacity: 0.5
    };
}

function onEachFeatureAlertas(feature, layer) {
    const p = feature.properties;
    // O campo area_uc_km só preenche se for UC, usamos areamunkm para área do polígono
    const area = p.areamunkm ? parseFloat(p.areamunkm) : (p.areauckm ? parseFloat(p.areauckm) : 0);
    const labelClasse = classLabels[p.classname] || p.classname || 'Outros';
    const areaHa = area * 100;

    layer.bindPopup(`
        <div class="popup-title">Alerta DETER</div>
        <b>Município:</b> ${p.name_muni || 'N/A'} - ${p.abbrev_state || ''}<br/>
        <b>Classe:</b> ${labelClasse}<br/>
        <b>Área:</b> ${area > 0 && area < 0.01 ? '< 0.01' : area.toFixed(2)} km² (${areaHa.toFixed(2)} ha)<br/>
        <b>Data:</b> ${p.view_date}
    `, { className: 'custom-popup' });
}

// --- 2. LÓGICA DE FILTRAGEM ---

function applyFilters() {
    if (!state.alertasRaw) return;

    // 1. Filtrar Alertas (Mapa)
    const alertasFiltrados = state.alertasRaw.features.filter(f => {
        // Ignorar geometrias de ponto ou residuais que causam marcadores no mapa
        if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
            return false;
        }
        
        const p = f.properties;
        const [y, m, d] = p.view_date.split('-');
        const matchAno = state.filtros.ano === 'Todos' || y === state.filtros.ano;
        const matchMes = state.filtros.mes === 'Todos' || m === state.filtros.mes;
        const matchClasse = state.filtros.classes.has(p.classname || 'OUTROS');
        return matchAno && matchMes && matchClasse;
    });

    state.camadas.alertas.clearLayers();
    if (document.getElementById('toggle-alerts').checked) {
        state.camadas.alertas.addData(alertasFiltrados);
    }

    // 2. Filtrar KDE (Mapa)
    // O KDE agora é exportado com os períodos 'Todos', 'YYYY' ou 'MM/YYYY'
    state.camadas.kde.clearLayers();
    if (document.getElementById('toggle-kde').checked && state.kdeRaw) {
        let periodTarget = 'Todos';
        if (state.filtros.ano !== 'Todos' && state.filtros.mes !== 'Todos') {
            periodTarget = `${state.filtros.mes}/${state.filtros.ano}`;
        } else if (state.filtros.ano !== 'Todos' && state.filtros.mes === 'Todos') {
            periodTarget = state.filtros.ano;
        } else if (state.filtros.ano === 'Todos' && state.filtros.mes !== 'Todos') {
            periodTarget = null; // Edge case: We don't merge across different years dynamically yet
        }
        
        if (periodTarget) {
            const kdeFiltrado = state.kdeRaw.features.filter(f => f.properties.periodo === periodTarget);
            state.camadas.kde.addData(kdeFiltrado);
        }
    }

    // 3. Atualizar Tabela (Ranking)
    updateRankingTable();
}

function updateRankingTable() {
    const tbody = document.querySelector('#ranking-table tbody');
    const statsCount = document.getElementById('stats-count');
    
    // Filtrar o rankingArray que já veio processado do R
    const rankingFiltrado = state.rankingRaw.filter(item => {
        const matchAno = state.filtros.ano === 'Todos' || String(item.ano) === state.filtros.ano;
        const matchMes = state.filtros.mes === 'Todos' || String(item.mes).padStart(2, '0') === state.filtros.mes;
        const matchClasse = state.filtros.classes.has(item.classe);
        return matchAno && matchMes && matchClasse;
    });

    // Agrupar por município (pois o rankingRaw vem por classe/mes)
    const muniAgg = {};
    rankingFiltrado.forEach(item => {
        const key = `${item.muni}-${item.uf}`;
        if (!muniAgg[key]) muniAgg[key] = { muni: item.muni, uf: item.uf, area: 0, alerts: 0 };
        muniAgg[key].area += item.area_km2;
        muniAgg[key].alerts += item.total_alertas;
    });

    const rankingSorted = Object.values(muniAgg).sort((a, b) => b.area - a.area).slice(0, 50);

    tbody.innerHTML = '';
    rankingSorted.forEach(item => {
        const tr = document.createElement('tr');
        const displayHa = (item.area * 100).toFixed(1);
        tr.innerHTML = `
            <td><span class="muni-name">${item.muni}</span> <span class="uf-tag">${item.uf}</span></td>
            <td class="text-right text-danger">${displayHa}</td>
            <td class="text-right"><button class="zoom-btn" onclick="zoomToMuni('${item.muni}')">🔍</button></td>
        `;
        tbody.appendChild(tr);
    });

    statsCount.textContent = `${rankingFiltrado.reduce((a, b) => a + b.total_alertas, 0)} alertas`;
}

window.zoomToMuni = (muniName) => {
    const layer = state.camadas.alertas.getLayers().find(l => l.feature.properties.name_muni === muniName);
    if (layer) map.fitBounds(layer.getBounds(), { maxZoom: 12 });
};

// --- 3. INICIALIZAÇÃO E EVENTOS ---

function initFilters(ranking) {
    const years = [...new Set(ranking.map(i => String(i.ano)))].sort().reverse();
    const classes = [...new Set(ranking.map(i => i.classe))].sort();

    const yearSelect = document.getElementById('filter-year');
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        yearSelect.appendChild(opt);
    });
    if (years.includes('2026')) yearSelect.value = '2026';

    const monthSelect = document.getElementById('filter-month');
    for(let i=1; i<=12; i++) {
        const val = String(i).padStart(2, '0');
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = val;
        monthSelect.appendChild(opt);
    }

    const classContainer = document.getElementById('class-filters');
    const legendClassesContainer = document.getElementById('legend-classes');
    legendClassesContainer.innerHTML = '';
    
    classes.forEach(c => {
        // UI Dashboard Filter
        state.filtros.classes.add(c); // Add all classes to initial state
        const color = classColors[c] || classColors['OUTROS'];
        const label = classLabels[c] || c.replace(/_/g, ' ');
        
        const lbl = document.createElement('label');
        lbl.className = 'class-chip active';
        lbl.innerHTML = `
            <input type="checkbox" value="${c}" checked> 
            <span class="color-dot" style="background: ${color}; color: ${color};"></span>
            <span>${label}</span>
        `;
        
        lbl.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) {
                lbl.classList.add('active');
                state.filtros.classes.add(c); 
            } else {
                lbl.classList.remove('active');
                state.filtros.classes.delete(c); 
            }
            applyFilters();
        });
        classContainer.appendChild(lbl);
        
        // Map Legend Item
        const legItem = document.createElement('div');
        legItem.className = 'scale-item';
        legItem.innerHTML = `<span class="color-dot" style="background: ${color};"></span> ${label}`;
        legendClassesContainer.appendChild(legItem);
    });

    yearSelect.addEventListener('change', (e) => { state.filtros.ano = e.target.value; applyFilters(); });
    monthSelect.addEventListener('change', (e) => { state.filtros.mes = e.target.value; applyFilters(); });
    
    document.getElementById('toggle-alerts').addEventListener('change', applyFilters);
    document.getElementById('toggle-kde').addEventListener('change', applyFilters);
    const kdeTarget = document.getElementById('kde-target');
    if(kdeTarget) kdeTarget.addEventListener('change', applyFilters);
}

// Carregamento de Dados
Promise.all([
    fetch('data/alertas_web.geojson').then(r => r.ok ? r.json() : null),
    fetch('data/kde_isolinhas.geojson').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('data/ranking.json').then(r => r.ok ? r.json() : null)
]).then(([alertas, kde, ranking]) => {
    if (!alertas || !ranking) {
        document.querySelector('#ranking-table tbody').innerHTML = '<tr><td colspan="3" class="text-danger">Erro ao carregar dados. Tente limpar o cache (Ctrl+F5).</td></tr>';
        return;
    }
    
    state.alertasRaw = alertas;
    state.kdeRaw = kde;
    state.rankingRaw = ranking;
    
    initFilters(ranking);
    applyFilters();
    
    if (state.camadas.alertas.getLayers().length > 0) {
        map.fitBounds(state.camadas.alertas.getBounds());
    }
}).catch(err => {
    console.error("Erro ao carregar dashboard:", err);
    document.querySelector('#ranking-table tbody').innerHTML = '<tr><td colspan="3" class="text-danger">Erro fatal. Veja o console.</td></tr>';
});
