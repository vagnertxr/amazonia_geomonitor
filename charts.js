// =============================================================================
// GeomonitoR - Graficos em SVG inline
// -----------------------------------------------------------------------------
// Sem biblioteca de terceiros: o painel e estatico e nao tem etapa de build.
// Cada funcao recebe um container e desenha um SVG responsivo (viewBox) com
// camada de hover. As cores vem das variaveis CSS, entao o tema manda.
// =============================================================================

// Rampa sequencial azul (magnitude no heatmap). Matiz unica, claro -> escuro.
const RAMPA_AZUL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

// -----------------------------------------------------------------------------
// TOOLTIP COMPARTILHADO
// -----------------------------------------------------------------------------

let tooltipEl = null;

function tooltip() {
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'chart-tooltip';
        tooltipEl.setAttribute('role', 'status');
        document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
}

function mostrarTooltip(html, ev) {
    const el = tooltip();
    el.innerHTML = html;
    el.classList.add('visivel');
    const r = el.getBoundingClientRect();
    let x = ev.clientX + 14;
    let y = ev.clientY - r.height - 10;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y < 8) y = ev.clientY + 18;
    el.style.left = `${x}px`;
    el.style.top  = `${y}px`;
}

function esconderTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('visivel');
}

// -----------------------------------------------------------------------------
// 1. SERIE TEMPORAL COM COMPARACAO ANO A ANO
// -----------------------------------------------------------------------------

/**
 * Linha da area alertada por mes, com o mesmo periodo do ano anterior como
 * referencia. Duas series -> legenda obrigatoria e rotulo direto no fim de cada.
 *
 * @param {Array<number>} atual    12 valores (km2) do ano em foco
 * @param {Array<number>} anterior 12 valores do ano anterior (ou null)
 */
function graficoSerie(container, { atual, anterior, rotuloAtual, rotuloAnterior, ateMes }) {
    container.innerHTML = '';

    const temAnterior = Array.isArray(anterior) && anterior.some(v => v > 0);
    if (!atual || !atual.some(v => v > 0)) {
        container.innerHTML = `<p class="chart-empty">${t('analysis.noData')}</p>`;
        return;
    }

    // O ano corrente costuma estar incompleto. Desenhar zeros nos meses sem
    // dado afirmaria "não houve desmatamento", quando o certo é "ainda não há
    // medição": a linha termina no último mês medido.
    const ultimo = Number.isInteger(ateMes) && ateMes >= 0
        ? Math.min(ateMes, 11)
        : atual.reduce((acc, v, i) => (v > 0 ? i : acc), 0);

    const W = 340, H = 168;
    const m = { t: 12, r: 14, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;

    const max = Math.max(...atual, ...(temAnterior ? anterior : [0])) * 1.12 || 1;
    const px = i => m.l + (i / 11) * iw;
    const py = v => m.t + ih - (v / max) * ih;

    const svg = svgEl('svg', {
        viewBox: `0 0 ${W} ${H}`, class: 'chart-svg',
        role: 'img', 'aria-label': t('analysis.series')
    });

    // Grade recessiva: 3 linhas horizontais, sem eixo vertical desenhado.
    for (let g = 0; g <= 2; g++) {
        const v = (max / 2) * g;
        svg.appendChild(svgEl('line', {
            x1: m.l, x2: W - m.r, y1: py(v), y2: py(v), class: 'chart-grid'
        }));
        const tx = svgEl('text', { x: m.l - 6, y: py(v) + 3.5, class: 'chart-axis-label', 'text-anchor': 'end' });
        tx.textContent = num(v, v >= 100 ? 0 : 1);
        svg.appendChild(tx);
    }

    const curtos = mesesCurtos();
    for (let i = 0; i < 12; i += 2) {
        const tx = svgEl('text', { x: px(i), y: H - 8, class: 'chart-axis-label', 'text-anchor': 'middle' });
        tx.textContent = curtos[i];
        svg.appendChild(tx);
    }

    const caminho = (vals, ate = 11) => vals.slice(0, ate + 1)
        .map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');

    if (temAnterior) {
        svg.appendChild(svgEl('path', { d: caminho(anterior), class: 'chart-line chart-line--ref' }));
    }
    svg.appendChild(svgEl('path', {
        d: `${caminho(atual, ultimo)} L${px(ultimo)},${py(0)} L${px(0)},${py(0)} Z`, class: 'chart-area'
    }));
    svg.appendChild(svgEl('path', { d: caminho(atual, ultimo), class: 'chart-line chart-line--main' }));

    // Camada de hover: faixa por mes, alvo bem maior que a marca.
    const foco = svgEl('g', { class: 'chart-focus', visibility: 'hidden' });
    const vlinha = svgEl('line', { y1: m.t, y2: m.t + ih, class: 'chart-crosshair' });
    const ponto  = svgEl('circle', { r: 4, class: 'chart-dot' });
    foco.appendChild(vlinha); foco.appendChild(ponto);
    svg.appendChild(foco);

    for (let i = 0; i <= ultimo; i++) {
        const alvo = svgEl('rect', {
            x: m.l + (i - 0.5) * (iw / 11), y: m.t,
            width: iw / 11, height: ih, fill: 'transparent', class: 'chart-hit'
        });
        alvo.addEventListener('mouseenter', ev => {
            foco.setAttribute('visibility', 'visible');
            vlinha.setAttribute('x1', px(i)); vlinha.setAttribute('x2', px(i));
            ponto.setAttribute('cx', px(i));  ponto.setAttribute('cy', py(atual[i]));
            let html = `<strong>${t('months')[i]}</strong>
                <span class="tt-row"><i style="background:var(--series-main)"></i>${rotuloAtual}: <b>${num(atual[i], 1)} km²</b></span>`;
            if (temAnterior) {
                html += `<span class="tt-row"><i style="background:var(--text-muted)"></i>${rotuloAnterior}: <b>${num(anterior[i], 1)} km²</b></span>`;
                const d = anterior[i] > 0 ? ((atual[i] - anterior[i]) / anterior[i]) * 100 : null;
                if (d !== null) html += `<span class="tt-delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${num(Math.abs(d), 0)}%</span>`;
            }
            mostrarTooltip(html, ev);
        });
        alvo.addEventListener('mousemove', ev => mostrarTooltip(tooltip().innerHTML, ev));
        alvo.addEventListener('mouseleave', () => { foco.setAttribute('visibility', 'hidden'); esconderTooltip(); });
        svg.appendChild(alvo);
    }

    container.appendChild(svg);

    const leg = document.createElement('div');
    leg.className = 'chart-legend';
    leg.innerHTML = `<span><i class="sw sw--main"></i>${rotuloAtual}</span>` +
        (temAnterior ? `<span><i class="sw sw--ref"></i>${rotuloAnterior}</span>` : '');
    container.appendChild(leg);
}

// -----------------------------------------------------------------------------
// 2. HEATMAP SAZONAL (ANO x MES)
// -----------------------------------------------------------------------------

/**
 * Matriz de magnitude: linhas = anos, colunas = meses. Rampa sequencial de
 * matiz unica, porque o dado e magnitude continua e nao identidade.
 */
function graficoSazonal(container, { anos, matriz }) {
    container.innerHTML = '';
    if (!anos.length) {
        container.innerHTML = `<p class="chart-empty">${t('analysis.noData')}</p>`;
        return;
    }

    let max = 0;
    matriz.forEach(l => l.forEach(v => { if (v > max) max = v; }));
    if (max <= 0) {
        container.innerHTML = `<p class="chart-empty">${t('analysis.noData')}</p>`;
        return;
    }

    const cel = 22, gap = 2, rotuloL = 34, rotuloT = 16;
    const W = rotuloL + 12 * cel, H = rotuloT + anos.length * cel;

    const svg = svgEl('svg', {
        viewBox: `0 0 ${W} ${H}`, class: 'chart-svg chart-svg--heat',
        role: 'img', 'aria-label': t('analysis.seasonal')
    });

    const curtos = mesesCurtos();
    for (let m = 0; m < 12; m++) {
        const tx = svgEl('text', {
            x: rotuloL + m * cel + cel / 2, y: 11,
            class: 'chart-axis-label', 'text-anchor': 'middle'
        });
        tx.textContent = curtos[m][0];
        svg.appendChild(tx);
    }

    anos.forEach((ano, r) => {
        const ty = svgEl('text', {
            x: rotuloL - 7, y: rotuloT + r * cel + cel / 2 + 3.5,
            class: 'chart-axis-label', 'text-anchor': 'end'
        });
        ty.textContent = ano;
        svg.appendChild(ty);

        for (let m = 0; m < 12; m++) {
            const v = matriz[r][m] || 0;
            const idx = v <= 0 ? -1 : Math.min(RAMPA_AZUL.length - 1,
                Math.floor(Math.sqrt(v / max) * RAMPA_AZUL.length));

            const rect = svgEl('rect', {
                x: rotuloL + m * cel + gap / 2, y: rotuloT + r * cel + gap / 2,
                width: cel - gap, height: cel - gap, rx: 3,
                fill: idx < 0 ? 'var(--surface-2)' : RAMPA_AZUL[idx],
                class: 'chart-cell'
            });
            rect.addEventListener('mouseenter', ev => mostrarTooltip(
                `<strong>${t('months')[m]} ${ano}</strong>
                 <span class="tt-row">${t('kpi.area')}: <b>${num(v, 1)} km²</b></span>`, ev));
            rect.addEventListener('mousemove', ev => mostrarTooltip(tooltip().innerHTML, ev));
            rect.addEventListener('mouseleave', esconderTooltip);
            svg.appendChild(rect);
        }
    });

    container.appendChild(svg);

    const esc = document.createElement('div');
    esc.className = 'chart-ramp';
    esc.innerHTML = `<span>${t('legend.low')}</span>` +
        RAMPA_AZUL.map(c => `<i style="background:${c}"></i>`).join('') +
        `<span>${t('legend.high')}</span>`;
    container.appendChild(esc);
}

// -----------------------------------------------------------------------------
// 3. MUNICIPIOS EM ALTA
// -----------------------------------------------------------------------------

/**
 * Barras horizontais do aumento absoluto de area contra o mesmo recorte do ano
 * anterior. Complementa o ranking por area absoluta, que esconde aceleracao.
 */
function graficoEmAlta(container, itens) {
    container.innerHTML = '';
    if (!itens.length) {
        container.innerHTML = `<p class="chart-empty">${t('analysis.noData')}</p>`;
        return;
    }

    const max = Math.max(...itens.map(i => i.delta)) || 1;
    const lista = document.createElement('ul');
    lista.className = 'trend-list';

    itens.forEach(it => {
        const li = document.createElement('li');
        const pct = it.antes > 0
            ? `+${num((it.delta / it.antes) * 100, 0)}%`
            : t('analysis.compYear');

        li.innerHTML = `
            <div class="trend-head">
                <span class="trend-name">${it.muni}<span class="uf-tag">${it.uf}</span></span>
                <span class="trend-delta">+${num(it.delta, 1)} km²</span>
            </div>
            <div class="trend-bar"><span style="width:${(it.delta / max) * 100}%"></span></div>
            <div class="trend-sub">${num(it.antes, 1)} → ${num(it.agora, 1)} km² <b>${pct}</b></div>`;
        lista.appendChild(li);
    });

    container.appendChild(lista);
}

// -----------------------------------------------------------------------------
// ALTERNANCIA GRAFICO / TABELA
// Alternativa nao-cromatica exigida pela acessibilidade: quem nao distingue as
// cores (ou imprime a pagina) le os mesmos numeros em tabela.
// -----------------------------------------------------------------------------

function tabelaDe(cabecalho, linhas) {
    const tab = document.createElement('table');
    tab.className = 'chart-table';
    tab.innerHTML =
        `<thead><tr>${cabecalho.map(h => `<th>${h}</th>`).join('')}</tr></thead>` +
        `<tbody>${linhas.map(l => `<tr>${l.map((c, i) =>
            `<td${i ? ' class="text-right"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return tab;
}
