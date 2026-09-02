// =============================================================================
// GeomonitoR da Amazônia — motor do painel
// -----------------------------------------------------------------------------
// Os alertas chegam em formato colunar (arrays paralelos) e ficam em arrays
// tipados: filtrar 275 mil registros vira uma varredura de índices de poucos
// milissegundos, em vez de percorrer objetos e fatiar strings de data.
// =============================================================================

const CLASSES_ORDEM = [
    'DESMATAMENTO_CR', 'DESMATAMENTO_VEG', 'DEGRADACAO', 'MINERACAO',
    'CS_DESORDENADO', 'CS_GEOMETRICO', 'CICATRIZ_DE_QUEIMADA', 'OUTROS'
];

// Cor de cada classe DETER — a MESMA nos chips do filtro, na legenda do mapa e
// nos pontos. Antes os chips usavam uma paleta que o mapa não reproduzia.
//
// No mapa os alertas são pontos dispersos, então todos os 28 pares precisam se
// separar, não só os vizinhos. Manter as 8 classes distintas (em vez de agrupar
// em famílias) exigiu abrir mão da faixa estreita de luminosidade: com tudo no
// mesmo brilho, só a matiz separa, e o pior par caía a ΔE 1,6 sob deuteranopia.
// Variando a luminosidade — canal que sobrevive ao daltonismo — o pior par sobe
// para ΔE 10,9 (piso 8) e ΔE 19,5 sob visão normal (piso 15).
const CORES_CLASSE = {
    'DESMATAMENTO_CR':      '#c04781',   // corte raso
    'DESMATAMENTO_VEG':     '#ffa7ba',   // corte raso com vegetação (irmão mais claro)
    'DEGRADACAO':           '#e4c217',   // degradação
    'MINERACAO':            '#9b8afe',   // mineração
    'CS_DESORDENADO':       '#22dafe',   // corte seletivo desordenado
    'CS_GEOMETRICO':        '#40a544',   // corte seletivo geométrico
    'CICATRIZ_DE_QUEIMADA': '#8a600a',   // cicatriz de queimada
    'OUTROS':               '#2065c5'    // outros
};

// Teto de marcadores desenhados de uma vez. Acima disso o padrão espacial é
// responsabilidade da camada de densidade, e mostramos os maiores alertas.
const MAX_MARCADORES = 20000;

// -----------------------------------------------------------------------------
// ESTADO
// -----------------------------------------------------------------------------

const estado = {
    meta: null,
    alertas: null,       // colunas em arrays tipados
    grade: null,         // GradeKDE
    series: null,
    ranking: [],
    filtros: { ano: 'Todos', mes: 'Todos', classes: new Set() },
    kde: { metrica: 'n', banda: 'auto', modo: 'contorno' },
    ordemRanking: 'area',
    selecionados: null,  // Int32Array de índices do recorte ativo
    player: { tocando: false, timer: null, meses: [] }
};

// -----------------------------------------------------------------------------
// MAPA
// -----------------------------------------------------------------------------

const map = L.map('map', {
    preferCanvas: true,          // 20k círculos em SVG travam o navegador
    zoomControl: true,
    attributionControl: true
}).setView([-6, -58], 5);

map.attributionControl.setPrefix('Leaflet');

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_2ra4_1_0298b888512ba3d20710e960', {
    maxZoom: 18,
    attribution: '&copy; CARTO | DETER/INPE | <a href="https://github.com/vagnertxr" target="_blank" rel="noopener">Vagner Teixeira</a>'
}).addTo(map);

const rendererCanvas = L.canvas({ padding: 0.3 });

const camadas = {
    alertas: L.layerGroup().addTo(map),
    kde:     L.layerGroup().addTo(map),
    limites: L.layerGroup().addTo(map),
    protegidas: L.layerGroup()
};

// -----------------------------------------------------------------------------
// CARREGAMENTO
// -----------------------------------------------------------------------------

const buscarJSON = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

Promise.all([
    buscarJSON('data/meta.json'),
    buscarJSON('data/alertas.json'),
    buscarJSON('data/kde_grid.json'),
    buscarJSON('data/series.json'),
    buscarJSON('data/ranking.json'),
    buscarJSON('data/amazonia_legal.geojson'),
    buscarJSON('data/bioma_amazonia.geojson'),
    buscarJSON('data/areas_protegidas.geojson')
]).then(([meta, alertas, grade, series, ranking, legal, bioma, protegidas]) => {
    if (!alertas || !ranking) return falhar();

    estado.meta    = meta;
    estado.series  = series;
    estado.ranking = ranking;
    estado.alertas = prepararAlertas(alertas);
    if (grade) estado.grade = new GradeKDE(grade);

    desenharLimites(legal, bioma);
    if (protegidas) prepararProtegidas(protegidas);

    montarInterface();
    aplicarIdioma();
    montarMeta();          // depois de aplicarIdioma: o span tem data-i18n de carregamento
    atualizarTudo();
}).catch(falhar);

function falhar(err) {
    if (err) console.error('Falha ao iniciar:', err);
    document.querySelector('#ranking-table tbody').innerHTML =
        `<tr><td colspan="3" class="loading">${t('error.load')}</td></tr>`;
    document.getElementById('meta-data').textContent = t('error.load');
}

/** Converte as colunas cruas em arrays tipados e pré-calcula ano/mês por alerta. */
function prepararAlertas(a) {
    const n = a.lon.length;
    const epoca = new Date(`${a.epoca}T12:00:00Z`);

    const ano = new Int16Array(n);
    const mes = new Int8Array(n);
    for (let i = 0; i < n; i++) {
        const d = new Date(epoca.getTime() + a.dia[i] * 86400000);
        ano[i] = d.getUTCFullYear();
        mes[i] = d.getUTCMonth() + 1;
    }

    return {
        n,
        epoca,
        classes: a.classes,
        munis: a.munis,
        ufs: a.ufs,
        lon:  Float32Array.from(a.lon),
        lat:  Float32Array.from(a.lat),
        dia:  Int32Array.from(a.dia),
        cls:  Uint8Array.from(a.cls),
        muni: Int32Array.from(a.muni),
        area: Int32Array.from(a.area),   // km² × 10 000
        ano, mes
    };
}

function desenharLimites(legal, bioma) {
    if (legal) {
        L.geoJSON(legal, {
            style: { color: '#e8e6dd', weight: 1, fillOpacity: 0, dashArray: '4,4', opacity: .55 },
            interactive: false
        }).addTo(camadas.limites);
    }
    if (bioma) {
        L.geoJSON(bioma, {
            style: { color: '#199e70', weight: 1, fillOpacity: 0, dashArray: '4,4', opacity: .7 },
            interactive: false
        }).addTo(camadas.limites);
    }
}

/** Camadas de TI/UC só aparecem se o pipeline já tiver gerado o arquivo. */
function prepararProtegidas(fc) {
    L.geoJSON(fc, {
        // Sem este filtro, qualquer feição não-poligonal (resíduo degenerado que
        // o st_make_valid deixa numa GeometryCollection) vira um marcador padrão
        // do Leaflet — pinos azuis soltos no meio do mapa.
        filter: f => f.geometry &&
            (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'),
        style: f => ({
            color: (f.properties || {}).tipo === 'TI' ? '#c98500' : '#9085e9',
            weight: 1, opacity: .75, fillOpacity: .06
        }),
        interactive: false
    }).addTo(camadas.protegidas);

    document.getElementById('toggle-prot-wrap').hidden = false;

    const lista = document.querySelector('#legend-classes').parentElement.parentElement;
    const bloco = document.createElement('div');
    bloco.className = 'legend-block';
    bloco.innerHTML = `
        <div class="legend-title">${t('layers.protected')}</div>
        <div class="legend-list">
            <div class="legend-item"><span class="swatch swatch--line" style="--c:#c98500"></span><span>${t('legend.indig')}</span></div>
            <div class="legend-item"><span class="swatch swatch--line" style="--c:#9085e9"></span><span>${t('legend.consUnit')}</span></div>
        </div>`;
    lista.appendChild(bloco);
}

// -----------------------------------------------------------------------------
// FILTRAGEM — varredura sobre arrays tipados
// -----------------------------------------------------------------------------

function filtrar() {
    const a = estado.alertas;
    const { ano, mes } = estado.filtros;
    const anoNum = ano === 'Todos' ? -1 : +ano;
    const mesNum = mes === 'Todos' ? -1 : +mes;

    // Máscara por índice de classe: teste O(1) dentro do laço.
    const ativa = new Uint8Array(a.classes.length);
    a.classes.forEach((c, i) => { if (estado.filtros.classes.has(c)) ativa[i] = 1; });

    const out = new Int32Array(a.n);
    let k = 0;
    for (let i = 0; i < a.n; i++) {
        if (anoNum > 0 && a.ano[i] !== anoNum) continue;
        if (mesNum > 0 && a.mes[i] !== mesNum) continue;
        if (!ativa[a.cls[i]]) continue;
        out[k++] = i;
    }
    estado.selecionados = out.subarray(0, k);
}

// -----------------------------------------------------------------------------
// RENDERIZAÇÃO DOS ALERTAS
// -----------------------------------------------------------------------------

// Símbolos graduados por classe de área.
//
// A escala contínua anterior (raio = sqrt(área) × 2,6, grampeada em 2,5–28 px)
// prometia proporcionalidade mas não entregava: a mediana dos alertas é
// 0,16 km² e o grampo inferior agia abaixo de 0,925 km², então 89% dos círculos
// saíam todos com 2,5 px e não codificavam nada. Com área variando de 0,001 a
// 198 km², proporcionalidade contínua é inviável — ou os pequenos somem, ou os
// grandes tomam o mapa. Classes explícitas são legíveis e, principalmente,
// declaráveis na legenda.
const CLASSES_AREA = [
    { max: 0.1,      raio: 2.6 },
    { max: 0.5,      raio: 4.0 },
    { max: 2,        raio: 6.0 },
    { max: 10,       raio: 9.0 },
    { max: Infinity, raio: 13.5 }
];

function raioAlerta(areaKm2) {
    for (const c of CLASSES_AREA) if (areaKm2 < c.max) return c.raio;
    return CLASSES_AREA[CLASSES_AREA.length - 1].raio;
}

/** A cor identifica a classe; o tamanho do círculo já carrega a área. */
function corAlerta(i) {
    const a = estado.alertas;
    return CORES_CLASSE[a.classes[a.cls[i]]] || '#8f8e85';
}

function desenharAlertas() {
    camadas.alertas.clearLayers();
    const nota = document.getElementById('legend-note');
    nota.hidden = true;

    if (!document.getElementById('toggle-alerts').checked) return;

    const a = estado.alertas;
    let idx = estado.selecionados;
    if (idx.length === 0) return;

    // Acima do teto, prioriza os maiores alertas — os que de fato importam
    // visualmente — e avisa na legenda que o recorte está truncado.
    if (idx.length > MAX_MARCADORES) {
        const copia = Array.from(idx);
        copia.sort((x, y) => a.area[y] - a.area[x]);
        idx = copia.slice(0, MAX_MARCADORES);
        nota.textContent = t('legend.capped', { n: num(MAX_MARCADORES) });
        nota.hidden = false;
    }

    const camada = [];
    for (const i of idx) {
        const km2 = a.area[i] / 10000;
        const cor = corAlerta(i);
        const m = L.circleMarker([a.lat[i], a.lon[i]], {
            renderer: rendererCanvas,
            radius: raioAlerta(km2),
            fillColor: cor, color: cor,
            weight: .8, opacity: .85, fillOpacity: .45
        });
        m._idx = i;
        camada.push(m);
    }

    camada.forEach(m => m.on('click', () => abrirPopup(m)));
    L.layerGroup(camada).addTo(camadas.alertas);
}

function abrirPopup(marcador) {
    const a = estado.alertas;
    const i = marcador._idx;
    const km2 = a.area[i] / 10000;
    const data = new Date(a.epoca.getTime() + a.dia[i] * 86400000);

    marcador.bindPopup(`
        <div class="popup-title">${t('popup.title')}</div>
        <dl>
          <div class="popup-row"><dt>${t('popup.muni')}</dt><dd>${a.munis[a.muni[i]]} <span class="uf-tag">${a.ufs[a.muni[i]]}</span></dd></div>
          <div class="popup-row"><dt>${t('popup.class')}</dt><dd>${rotuloClasse(a.classes[a.cls[i]])}</dd></div>
          <div class="popup-row"><dt>${t('popup.area')}</dt><dd>${km2 < 0.01 ? '< 0,01' : num(km2, 2)} km²</dd></div>
          <div class="popup-row"><dt>${t('popup.date')}</dt><dd>${dataCurta(data.toISOString())}</dd></div>
        </dl>`, { className: 'custom-popup', maxWidth: 280 }).openPopup();
}

// -----------------------------------------------------------------------------
// RENDERIZAÇÃO DO KDE
// -----------------------------------------------------------------------------

function desenharKDE() {
    camadas.kde.clearLayers();
    const legenda = document.getElementById('legend-kde');
    const hint = document.getElementById('kde-hint');

    if (!estado.grade || !document.getElementById('toggle-kde').checked) {
        legenda.innerHTML = '';
        hint.textContent = '';
        return;
    }

    const r = calcularKDE(estado.grade, {
        ano: estado.filtros.ano,
        mes: estado.filtros.mes,
        classesAtivas: [...estado.filtros.classes],
        metrica: estado.kde.metrica,
        banda: estado.kde.banda
    });

    hint.textContent = r.vazio ? '' : `${t('density.sigma')} ≈ ${num(r.sigmaKm, 0)} km`;
    legenda.innerHTML = r.faixas.map(f => `<i style="background:${f.cor}"></i>`).join('');

    if (r.vazio) return;

    if (estado.kde.modo === 'grade') {
        for (const c of celulasKDE(estado.grade, r.niveis)) {
            L.rectangle(c.limites, {
                renderer: rendererCanvas,
                stroke: false, fillColor: c.cor, fillOpacity: .34
            }).addTo(camadas.kde);
        }
        return;
    }

    r.faixas.forEach((faixa, i) => {
        for (const linha of faixa.linhas) {
            L.polyline(linha, {
                renderer: rendererCanvas,
                color: faixa.cor,
                weight: 1.2 + i * 0.25,
                opacity: .5 + i * 0.08,
                interactive: false
            }).addTo(camadas.kde);
        }
    });
}

// -----------------------------------------------------------------------------
// AGREGAÇÕES A PARTIR DO RANKING
// -----------------------------------------------------------------------------

/**
 * Soma o ranking por município para o recorte informado.
 * `ateMes` limita os meses considerados — indispensável para comparar anos:
 * o ano corrente é parcial, e confrontá-lo com o anterior inteiro produziria
 * uma queda fictícia.
 */
function agregarRanking({ ano, mes, classes, ateMes }) {
    const anoNum = ano === 'Todos' ? -1 : +ano;
    const mesNum = mes === 'Todos' ? -1 : +mes;
    const porMuni = new Map();
    let areaTotal = 0, alertasTotal = 0;

    for (const r of estado.ranking) {
        if (anoNum > 0 && r.ano !== anoNum) continue;
        if (mesNum > 0 && r.mes !== mesNum) continue;
        if (ateMes && r.mes > ateMes) continue;
        if (!classes.has(r.classe)) continue;

        const chave = `${r.muni}|${r.uf}`;
        const item = porMuni.get(chave) || { muni: r.muni, uf: r.uf, area: 0, n: 0 };
        item.area += r.area;
        item.n    += r.n;
        porMuni.set(chave, item);

        areaTotal += r.area;
        alertasTotal += r.n;
    }
    return { porMuni, areaTotal, alertasTotal };
}

// -----------------------------------------------------------------------------
// INDICADORES
// -----------------------------------------------------------------------------

/**
 * Último mês com dados no ano informado. O ano corrente quase sempre está
 * incompleto, então toda comparação anual precisa se limitar a esta janela.
 * Devolve null quando o mês já está fixado pelo filtro (a janela já é igual).
 */
function ultimoMesComDados(ano) {
    if (ano === 'Todos' || estado.filtros.mes !== 'Todos') return null;
    const alvo = +ano;
    let max = 0;
    for (const r of estado.ranking) {
        if (r.ano === alvo && r.mes > max) max = r.mes;
    }
    return max > 0 && max < 12 ? max : null;
}

function atualizarKPIs(atual) {
    document.getElementById('kpi-area').textContent = num(atual.areaTotal, 1);
    document.getElementById('kpi-alerts').textContent = num(atual.alertasTotal);

    const lider = [...atual.porMuni.values()].sort((a, b) => b.area - a.area)[0];
    document.getElementById('kpi-top').textContent =
        lider ? `${lider.muni} · ${lider.uf}` : '—';

    const alvo = document.getElementById('kpi-yoy');
    alvo.classList.remove('up', 'down');

    if (estado.filtros.ano === 'Todos') {
        alvo.textContent = '—';
        return;
    }
    // Janela equivalente: se 2026 só tem dados até julho, compara com jan–jul de 2025.
    const ateMes = ultimoMesComDados(estado.filtros.ano);
    const base = ateMes
        ? agregarRanking({ ano: estado.filtros.ano, mes: estado.filtros.mes, classes: estado.filtros.classes, ateMes })
        : atual;

    const anterior = agregarRanking({
        ano: String(+estado.filtros.ano - 1),
        mes: estado.filtros.mes,
        classes: estado.filtros.classes,
        ateMes
    });
    if (anterior.areaTotal <= 0) { alvo.textContent = '—'; return; }

    const d = ((base.areaTotal - anterior.areaTotal) / anterior.areaTotal) * 100;
    alvo.textContent = `${d >= 0 ? '+' : '−'}${num(Math.abs(d), 1)}%`;
    alvo.classList.add(d >= 0 ? 'up' : 'down');
}

// -----------------------------------------------------------------------------
// TABELA DE RANKING
// -----------------------------------------------------------------------------

function atualizarTabela(atual) {
    const tbody = document.querySelector('#ranking-table tbody');
    const col2  = document.getElementById('rank-col-2');
    tbody.innerHTML = '';

    let linhas;
    if (estado.ordemRanking === 'alta') {
        col2.textContent = t('ranking.change');
        const ateMes = ultimoMesComDados(estado.filtros.ano);
        const anterior = agregarRanking({
            ano: estado.filtros.ano === 'Todos' ? 'Todos' : String(+estado.filtros.ano - 1),
            mes: estado.filtros.mes,
            classes: estado.filtros.classes,
            ateMes
        });
        linhas = [...atual.porMuni.values()]
            .map(m => {
                const antes = (anterior.porMuni.get(`${m.muni}|${m.uf}`) || { area: 0 }).area;
                return { ...m, antes, delta: m.area - antes };
            })
            .filter(m => m.delta > 0 && estado.filtros.ano !== 'Todos')
            .sort((a, b) => b.delta - a.delta)
            .slice(0, 50);
    } else {
        col2.textContent = t('ranking.area');
        linhas = [...atual.porMuni.values()].sort((a, b) => b.area - a.area).slice(0, 50);
    }

    document.getElementById('stats-count').textContent =
        `${num(atual.alertasTotal)} ${t('kpi.alerts').toLowerCase()}`;

    if (linhas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="loading">${t('ranking.empty')}</td></tr>`;
        return;
    }

    const frag = document.createDocumentFragment();
    for (const m of linhas) {
        const tr = document.createElement('tr');

        const valor = estado.ordemRanking === 'alta'
            ? `<span class="delta-up">+${num(m.delta, 1)}</span>`
            : `<span class="num">${num(m.area, 1)}</span>`;

        tr.innerHTML = `
            <td><span class="muni-name">${m.muni}</span><span class="uf-tag">${m.uf}</span></td>
            <td class="text-right">${valor}</td>
            <td class="text-right">
                <button type="button" class="zoom-btn" title="${t('ranking.zoomTo')}" aria-label="${t('ranking.zoomTo')}: ${m.muni}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
                    </svg>
                </button>
            </td>`;
        tr.querySelector('.zoom-btn').addEventListener('click', () => aproximarMuni(m.muni));
        frag.appendChild(tr);
    }
    tbody.appendChild(frag);
}

/** Enquadra todos os alertas do município no recorte ativo. */
function aproximarMuni(nome) {
    const a = estado.alertas;
    const alvo = a.munis.indexOf(nome);
    if (alvo < 0) return;

    let n = 0, minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const i of estado.selecionados) {
        if (a.muni[i] !== alvo) continue;
        n++;
        if (a.lat[i] < minLat) minLat = a.lat[i];
        if (a.lat[i] > maxLat) maxLat = a.lat[i];
        if (a.lon[i] < minLon) minLon = a.lon[i];
        if (a.lon[i] > maxLon) maxLon = a.lon[i];
    }
    if (n === 0) return;

    if (n === 1) map.setView([minLat, minLon], 11);
    else map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [40, 40], maxZoom: 12 });
}

// -----------------------------------------------------------------------------
// GRÁFICOS
// -----------------------------------------------------------------------------

function atualizarGraficos() {
    if (!estado.series) return;
    const s = estado.series;
    const ativos = s.classes.map(c => estado.filtros.classes.has(c));

    // Área por mês (km²), somando apenas as classes ativas.
    const porMes = s.meses.map((_, mi) =>
        s.area[mi].reduce((acc, v, ci) => acc + (ativos[ci] ? v : 0), 0));

    const anos = [...new Set(s.meses.map(m => m.slice(0, 4)))].sort();
    const matriz = anos.map(() => new Array(12).fill(0));
    s.meses.forEach((m, mi) => {
        matriz[anos.indexOf(m.slice(0, 4))][+m.slice(5, 7) - 1] = porMes[mi];
    });

    const anoFoco = estado.filtros.ano === 'Todos' ? anos[anos.length - 1] : estado.filtros.ano;
    const iFoco = anos.indexOf(anoFoco);

    // Último mês efetivamente medido no ano em foco, para a linha não cair a zero.
    let ultimoMes = -1;
    s.meses.forEach((m, mi) => {
        if (m.slice(0, 4) === anoFoco && porMes[mi] > 0) ultimoMes = +m.slice(5, 7) - 1;
    });

    graficoSerie(document.getElementById('chart-serie'), {
        atual: iFoco >= 0 ? matriz[iFoco] : new Array(12).fill(0),
        anterior: iFoco > 0 ? matriz[iFoco - 1] : null,
        rotuloAtual: anoFoco,
        rotuloAnterior: iFoco > 0 ? anos[iFoco - 1] : '',
        ateMes: ultimoMes
    });

    graficoSazonal(document.getElementById('chart-sazonal'), { anos, matriz });

    // Municípios em alta: variação contra o mesmo recorte do ano anterior.
    if (estado.filtros.ano === 'Todos') {
        document.getElementById('chart-alta').innerHTML =
            `<p class="chart-empty">${t('analysis.noData')}</p>`;
        return;
    }
    const ateMes = ultimoMesComDados(estado.filtros.ano);
    const atual = agregarRanking({ ano: estado.filtros.ano, mes: estado.filtros.mes, classes: estado.filtros.classes, ateMes });
    const antes = agregarRanking({ ano: String(+estado.filtros.ano - 1), mes: estado.filtros.mes, classes: estado.filtros.classes, ateMes });

    const itens = [...atual.porMuni.values()]
        .map(m => {
            const a0 = (antes.porMuni.get(`${m.muni}|${m.uf}`) || { area: 0 }).area;
            return { muni: m.muni, uf: m.uf, antes: a0, agora: m.area, delta: m.area - a0 };
        })
        .filter(m => m.delta > 0)
        .sort((a, b) => b.delta - a.delta)
        .slice(0, 6);

    graficoEmAlta(document.getElementById('chart-alta'), itens);
}

// -----------------------------------------------------------------------------
// CICLO DE ATUALIZAÇÃO
// -----------------------------------------------------------------------------

function atualizarTudo() {
    filtrar();
    desenharAlertas();
    desenharKDE();

    const atual = agregarRanking({
        ano: estado.filtros.ano, mes: estado.filtros.mes, classes: estado.filtros.classes
    });
    atualizarKPIs(atual);
    atualizarTabela(atual);
    atualizarGraficos();
    atualizarContagensChips();
}

/** Contagem por classe no recorte temporal atual, exibida em cada chip. */
function atualizarContagensChips() {
    const a = estado.alertas;
    const anoNum = estado.filtros.ano === 'Todos' ? -1 : +estado.filtros.ano;
    const mesNum = estado.filtros.mes === 'Todos' ? -1 : +estado.filtros.mes;

    const contagem = new Int32Array(a.classes.length);
    for (let i = 0; i < a.n; i++) {
        if (anoNum > 0 && a.ano[i] !== anoNum) continue;
        if (mesNum > 0 && a.mes[i] !== mesNum) continue;
        contagem[a.cls[i]]++;
    }
    document.querySelectorAll('.chip').forEach(chip => {
        const ci = a.classes.indexOf(chip.dataset.classe);
        const alvo = chip.querySelector('.chip-count');
        if (alvo && ci >= 0) alvo.textContent = num(contagem[ci]);
    });
}

// -----------------------------------------------------------------------------
// INTERFACE
// -----------------------------------------------------------------------------

function montarInterface() {
    montarAbas();
    montarFiltrosTemporais();
    montarChipsClasse();
    montarControles();
    montarPlayer();
    montarIdioma();
}

function montarMeta() {
    const m = estado.meta;
    if (!m) return;
    document.getElementById('meta-data').textContent =
        `${t('meta.dataUpto')} ${dataCurta(m.ultimo_alerta)}`;
    document.getElementById('meta-build').textContent =
        `${t('meta.updated')} ${dataCurta(m.gerado_em)}`;

    // O indicador de áreas protegidas só aparece depois que o pipeline tiver
    // rodado o cruzamento com TI/UC; sem o dado, a caixa fica oculta.
    const caixa = document.getElementById('kpi-protected-box');
    if (m.pct_area_protegida != null && !Number.isNaN(+m.pct_area_protegida)) {
        document.getElementById('kpi-protected').textContent = `${num(+m.pct_area_protegida, 1)}%`;
        caixa.hidden = false;
    } else {
        caixa.hidden = true;
    }
}

function montarAbas() {
    const botoes = [...document.querySelectorAll('.tabs button')];
    botoes.forEach((b, i) => {
        b.addEventListener('click', () => selecionarAba(i));
        b.addEventListener('keydown', ev => {
            const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
            if (!passo) return;
            ev.preventDefault();
            const alvo = (i + passo + botoes.length) % botoes.length;
            botoes[alvo].focus();
            selecionarAba(alvo);
        });
    });

    function selecionarAba(ativo) {
        botoes.forEach((b, i) => {
            b.setAttribute('aria-selected', String(i === ativo));
            document.getElementById(b.getAttribute('aria-controls')).hidden = i !== ativo;
        });
    }
}

function montarFiltrosTemporais() {
    const anos = [...new Set(estado.ranking.map(r => String(r.ano)))].sort().reverse();
    const selAno = document.getElementById('filter-year');
    const selMes = document.getElementById('filter-month');

    const opt = (v, txt) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; return o; };

    selAno.appendChild(opt('Todos', t('filters.allYears')));
    anos.forEach(y => selAno.appendChild(opt(y, y)));

    selMes.appendChild(opt('Todos', t('filters.allMonths')));
    for (let i = 1; i <= 12; i++) selMes.appendChild(opt(String(i).padStart(2, '0'), t('months')[i - 1]));

    // Abre no ano mais recente com dados, não num ano fixo no código.
    estado.filtros.ano = anos[0] || 'Todos';
    selAno.value = estado.filtros.ano;

    selAno.addEventListener('change', e => { estado.filtros.ano = e.target.value; pararPlayer(); atualizarTudo(); });
    selMes.addEventListener('change', e => { estado.filtros.mes = e.target.value; pararPlayer(); atualizarTudo(); });
}

function montarChipsClasse() {
    const presentes = ordemClasses();

    const cont = document.getElementById('class-filters');
    const leg  = document.getElementById('legend-classes');
    cont.innerHTML = '';
    leg.innerHTML = '';

    presentes.forEach(c => {
        estado.filtros.classes.add(c);

        const cor = CORES_CLASSE[c] || '#8f8e85';
        const lbl = document.createElement('label');
        lbl.className = 'chip active';
        lbl.dataset.classe = c;
        lbl.style.setProperty('--c', cor);
        lbl.innerHTML = `
            <input type="checkbox" checked>
            <span class="dot"></span>
            <span class="chip-label" data-classe-rotulo>${rotuloClasse(c)}</span>
            <span class="chip-count"></span>`;

        lbl.querySelector('input').addEventListener('change', e => {
            lbl.classList.toggle('active', e.target.checked);
            if (e.target.checked) estado.filtros.classes.add(c);
            else estado.filtros.classes.delete(c);
            montarLegendaMapa();
            atualizarTudo();
        });
        cont.appendChild(lbl);
    });

    montarLegendaMapa();

    document.getElementById('cls-all').addEventListener('click', () => alternarTodas(true));
    document.getElementById('cls-none').addEventListener('click', () => alternarTodas(false));

    function alternarTodas(ligar) {
        document.querySelectorAll('.chip').forEach(chip => {
            const inp = chip.querySelector('input');
            if (inp.checked !== ligar) { inp.checked = ligar; inp.dispatchEvent(new Event('change')); }
        });
    }
}

/**
 * Legenda do mapa: as classes ativas, com exatamente as cores dos chips.
 * Lista só o que está ligado — desmarcar uma classe a remove daqui também.
 */
function montarLegendaMapa() {
    const leg = document.getElementById('legend-classes');
    if (!leg) return;
    leg.innerHTML = '';

    const ativas = ordemClasses().filter(c => estado.filtros.classes.has(c));

    if (ativas.length === 0) {
        leg.innerHTML = `<div class="legend-item">${t('filters.none')}</div>`;
    } else {
        for (const c of ativas) {
            leg.insertAdjacentHTML('beforeend',
                `<div class="legend-item"><span class="swatch" style="--c:${CORES_CLASSE[c] || '#8f8e85'}"></span><span>${rotuloClasse(c)}</span></div>`);
        }
    }
    leg.insertAdjacentHTML('beforeend', escalaTamanhoHTML());
}

/**
 * Escala de tamanho com os cortes reais, para a legenda poder ser conferida.
 * Os rótulos saem dos próprios cortes e passam por num(), então o separador
 * decimal acompanha o idioma (0,1 em pt-BR / 0.1 em inglês).
 */
function escalaTamanhoHTML() {
    const casas = (v) => (v < 1 ? 1 : 0);
    const rotulos = CLASSES_AREA.map((c, i) => {
        const de = i > 0 ? CLASSES_AREA[i - 1].max : null;
        if (de === null)          return `< ${num(c.max, casas(c.max))}`;
        if (c.max === Infinity)   return `≥ ${num(de, casas(de))}`;
        return `${num(de, casas(de))} – ${num(c.max, casas(c.max))}`;
    });
    const itens = CLASSES_AREA.map((c, i) => {
        const d = c.raio * 2;
        return `<span class="size-item">
                    <span class="size-dot" style="width:${d}px;height:${d}px"></span>
                    <span>${rotulos[i]}</span>
                </span>`;
    }).join('');
    return `<div class="legend-size">
                <div class="legend-subtitle">${t('legend.size')}</div>
                <div class="size-scale">${itens}</div>
            </div>`;
}

/** Ordem canônica das classes presentes nos dados. */
function ordemClasses() {
    return CLASSES_ORDEM.filter(c => estado.alertas.classes.includes(c))
        .concat(estado.alertas.classes.filter(c => !CLASSES_ORDEM.includes(c)));
}

function montarControles() {
    document.getElementById('toggle-alerts').addEventListener('change', desenharAlertas);
    document.getElementById('toggle-kde').addEventListener('change', desenharKDE);

    const prot = document.getElementById('toggle-protected');
    if (prot) prot.addEventListener('change', e => {
        if (e.target.checked) camadas.protegidas.addTo(map);
        else map.removeLayer(camadas.protegidas);
    });

    document.querySelectorAll('input[name="kde-metrica"]').forEach(r =>
        r.addEventListener('change', e => { estado.kde.metrica = e.target.value; desenharKDE(); }));
    document.querySelectorAll('input[name="kde-banda"]').forEach(r =>
        r.addEventListener('change', e => { estado.kde.banda = e.target.value; desenharKDE(); }));
    document.querySelectorAll('input[name="kde-modo"]').forEach(r =>
        r.addEventListener('change', e => { estado.kde.modo = e.target.value; desenharKDE(); }));

    document.querySelectorAll('input[name="rank-ordem"]').forEach(r =>
        r.addEventListener('change', e => {
            estado.ordemRanking = e.target.value;
            atualizarTabela(agregarRanking({
                ano: estado.filtros.ano, mes: estado.filtros.mes, classes: estado.filtros.classes
            }));
        }));
}

// -----------------------------------------------------------------------------
// PLAYER TEMPORAL
// -----------------------------------------------------------------------------

function montarPlayer() {
    if (!estado.series) { document.getElementById('player').hidden = true; return; }

    estado.player.meses = estado.series.meses;
    const range = document.getElementById('player-range');
    range.max = estado.player.meses.length - 1;
    range.value = estado.player.meses.length - 1;

    range.addEventListener('input', e => irParaMes(+e.target.value));
    document.getElementById('player-btn').addEventListener('click', () =>
        estado.player.tocando ? pararPlayer() : iniciarPlayer());

    atualizarRotuloPlayer(estado.player.meses.length - 1);
}

function irParaMes(i) {
    const m = estado.player.meses[i];
    if (!m) return;
    estado.filtros.ano = m.slice(0, 4);
    estado.filtros.mes = m.slice(5, 7);
    document.getElementById('filter-year').value = estado.filtros.ano;
    document.getElementById('filter-month').value = estado.filtros.mes;
    document.getElementById('player-range').value = i;
    atualizarRotuloPlayer(i);
    atualizarTudo();
}

function atualizarRotuloPlayer(i) {
    const m = estado.player.meses[i];
    document.getElementById('player-label').textContent =
        m ? `${mesesCurtos()[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : '—';
}

function iniciarPlayer() {
    estado.player.tocando = true;
    trocarIconePlayer(true);
    const range = document.getElementById('player-range');

    estado.player.timer = setInterval(() => {
        let i = +range.value + 1;
        if (i > +range.max) i = 0;
        irParaMes(i);
    }, 700);
}

function pararPlayer() {
    if (!estado.player.tocando) return;
    estado.player.tocando = false;
    clearInterval(estado.player.timer);
    trocarIconePlayer(false);
}

function trocarIconePlayer(tocando) {
    const b = document.getElementById('player-btn');
    b.innerHTML = tocando
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    b.title = t(tocando ? 'player.pause' : 'player.play');
    b.setAttribute('aria-label', b.title);
}

// -----------------------------------------------------------------------------
// IDIOMA
// -----------------------------------------------------------------------------

function montarIdioma() {
    document.querySelectorAll('#lang-switch button').forEach(b =>
        b.addEventListener('click', () => definirIdioma(b.dataset.lang)));

    // Ao trocar de idioma, tudo que foi gerado em JS precisa ser reescrito:
    // data-i18n só alcança o que está no HTML estático.
    document.addEventListener('idiomamudou', () => {
        reconstruirSelects();
        document.querySelectorAll('.chip').forEach(chip => {
            chip.querySelector('.chip-label').textContent = rotuloClasse(chip.dataset.classe);
        });
        montarMeta();
        montarLegendaMapa();
        trocarIconePlayer(estado.player.tocando);
        atualizarRotuloPlayer(+document.getElementById('player-range').value);
        atualizarTudo();
    });
}

function reconstruirSelects() {
    const selAno = document.getElementById('filter-year');
    const selMes = document.getElementById('filter-month');
    selAno.options[0].textContent = t('filters.allYears');
    selMes.options[0].textContent = t('filters.allMonths');
    for (let i = 1; i <= 12; i++) selMes.options[i].textContent = t('months')[i - 1];
}
