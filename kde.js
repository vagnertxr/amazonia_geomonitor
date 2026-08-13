// =============================================================================
// GeomonitoR - Estimativa de densidade de kernel no navegador
// -----------------------------------------------------------------------------
// Recebe uma grade esparsa de contagens agregadas por (mes x classe) e calcula
// a densidade sob demanda para o recorte de filtros ativo. Isso permite que o
// KDE responda simultaneamente a ano, mes E classe -- combinacao que seria
// inviavel pre-calcular (2^8 conjuntos de classes x 87 meses).
//
// Pipeline: acumular -> suavizar (gaussiana separavel) -> contornar
// (marching squares). Numa grade de ~31 mil celulas todo o ciclo custa poucos
// milissegundos, entao pode rodar a cada mudanca de filtro.
// =============================================================================

// Rampa sequencial de matiz unica (laranja, ancorada em #d95926), derivada em
// OKLCH com luminosidade monotonica: 0.861 -> 0.470.
const KDE_RAMPA = ['#f2c6b6', '#e7a58e', '#db8566', '#cd633c', '#b94614', '#9c3200'];

const KDE_LARGURAS = { auto: null, detalhe: 25, padrao: 50, ampla: 100 };

/** Graus -> km no equador; suficiente para dimensionar a banda em celulas. */
const KM_POR_GRAU = 111.32;

class GradeKDE {
    constructor(json) {
        this.res    = json.res;
        this.lon0   = json.lon0;
        this.lat0   = json.lat0;
        this.nx     = json.nx;
        this.ny     = json.ny;
        this.classes = json.classes;
        this.meses   = json.meses;      // ['2020-01', ...]
        this.dados   = json.dados;      // { mesIdx: { classeIdx: [dCel, n, area, ...] } }
        this.campo   = new Float32Array(this.nx * this.ny);
        this.suave   = new Float32Array(this.nx * this.ny);
    }

    /** Indices de mes que casam com o filtro de ano/mes. */
    mesesFiltrados(ano, mes) {
        const out = [];
        for (let i = 0; i < this.meses.length; i++) {
            const [a, m] = this.meses[i].split('-');
            if (ano !== 'Todos' && a !== ano) continue;
            if (mes !== 'Todos' && m !== mes) continue;
            out.push(i);
        }
        return out;
    }

    /**
     * Soma as celulas dos meses x classes ativos no campo bruto.
     * `metrica`: 'n' (contagem de alertas) ou 'area' (hectares).
     *
     * Devolve `soma` (total na unidade da metrica) e `pontos` (contagem de
     * alertas). A banda usa `pontos`: largura de banda e funcao do tamanho da
     * amostra, nao da unidade -- senao ponderar por area mudaria a suavizacao
     * so porque hectares sao numeros maiores que contagens.
     */
    acumular(idxMeses, idxClasses, metrica) {
        this.campo.fill(0);
        const passo = metrica === 'area' ? 2 : 1;   // deslocamento dentro da tupla
        let soma = 0, pontos = 0;

        for (const mi of idxMeses) {
            const porClasse = this.dados[mi];
            if (!porClasse) continue;

            for (const ci of idxClasses) {
                const lista = porClasse[ci];
                if (!lista) continue;

                // Tuplas [deltaCelula, contagem, area] com celula em delta-encoding.
                let cel = 0;
                for (let k = 0; k < lista.length; k += 3) {
                    cel += lista[k];
                    this.campo[cel] += lista[k + passo];
                    soma   += lista[k + passo];
                    pontos += lista[k + 1];
                }
            }
        }
        return { soma, pontos };
    }

    /**
     * Convolucao gaussiana separavel (passada horizontal + vertical).
     * O(nx*ny*raio) em vez de O(nx*ny*raio^2) da versao 2D ingenua.
     */
    suavizar(sigmaCelulas) {
        const { nx, ny } = this;
        const raio = Math.max(1, Math.ceil(sigmaCelulas * 3));
        const k = new Float32Array(raio * 2 + 1);
        const den = 2 * sigmaCelulas * sigmaCelulas;
        let soma = 0;
        for (let i = -raio; i <= raio; i++) {
            const v = Math.exp(-(i * i) / den);
            k[i + raio] = v;
            soma += v;
        }
        for (let i = 0; i < k.length; i++) k[i] /= soma;

        const tmp = new Float32Array(nx * ny);

        for (let y = 0; y < ny; y++) {
            const base = y * nx;
            for (let x = 0; x < nx; x++) {
                let acc = 0;
                for (let i = -raio; i <= raio; i++) {
                    const xx = x + i;
                    if (xx < 0 || xx >= nx) continue;
                    acc += this.campo[base + xx] * k[i + raio];
                }
                tmp[base + x] = acc;
            }
        }

        for (let x = 0; x < nx; x++) {
            for (let y = 0; y < ny; y++) {
                let acc = 0;
                for (let i = -raio; i <= raio; i++) {
                    const yy = y + i;
                    if (yy < 0 || yy >= ny) continue;
                    acc += tmp[yy * nx + x] * k[i + raio];
                }
                this.suave[y * nx + x] = acc;
            }
        }
        return this.suave;
    }

    /**
     * Banda automatica: recortes esparsos pedem mais suavizacao, densos menos.
     * Escala tipo Silverman (n^-1/6), limitada a uma faixa util em km.
     */
    bandaAutomatica(pontos) {
        if (pontos <= 0) return KDE_LARGURAS.padrao;
        const km = 420 * Math.pow(pontos, -1 / 6);
        return Math.min(110, Math.max(22, km));
    }

    /**
     * Niveis por quantil da densidade positiva, descartando o piso de ruido.
     * Substitui os passos lineares min->max, cuja isolinha mais baixa apenas
     * contornava o limite do raster.
     */
    niveis(campo, quantidade = KDE_RAMPA.length) {
        const positivos = [];
        let max = 0;
        for (let i = 0; i < campo.length; i++) {
            const v = campo[i];
            if (v > max) max = v;
            if (v > 0) positivos.push(v);
        }
        if (max <= 0 || positivos.length < 8) return { niveis: [], max: 0 };

        positivos.sort((a, b) => a - b);
        const ps = [0.55, 0.70, 0.82, 0.90, 0.955, 0.985].slice(0, quantidade);
        const piso = max * 0.03;   // corta o halo residual da gaussiana

        const niveis = [];
        for (const p of ps) {
            const v = positivos[Math.min(positivos.length - 1, Math.floor(p * positivos.length))];
            if (v >= piso && (niveis.length === 0 || v > niveis[niveis.length - 1] * 1.02)) {
                niveis.push(v);
            }
        }
        return { niveis, max };
    }

    /** Converte coordenada de grade (centro de celula) para [lat, lng]. */
    paraLatLng(gx, gy) {
        return [this.lat0 + (gy + 0.5) * this.res, this.lon0 + (gx + 0.5) * this.res];
    }
}

// -----------------------------------------------------------------------------
// MARCHING SQUARES
// Percorre cada quadrado formado por 4 centros de celula vizinhos, classifica os
// cantos acima/abaixo do nivel e emite os segmentos interpolados. Depois costura
// os segmentos em polilinhas continuas, para o Leaflet desenhar poucas linhas
// longas em vez de milhares de tracinhos soltos.
// -----------------------------------------------------------------------------

const MS_ARESTAS = [
    [], [[3, 0]], [[0, 1]], [[3, 1]],
    [[1, 2]], [[3, 0], [1, 2]], [[0, 2]], [[3, 2]],
    [[2, 3]], [[2, 0]], [[0, 1], [2, 3]], [[2, 1]],
    [[1, 3]], [[1, 0]], [[0, 3]], []
];

function msInterpolar(aresta, x, y, v0, v1, v2, v3, nivel) {
    // Cantos: 0=(x,y) 1=(x+1,y) 2=(x+1,y+1) 3=(x,y+1)
    const f = (a, b) => {
        const d = b - a;
        return Math.abs(d) < 1e-12 ? 0.5 : (nivel - a) / d;
    };
    switch (aresta) {
        case 0: return [x + f(v0, v1), y];             // topo
        case 1: return [x + 1, y + f(v1, v2)];         // direita
        case 2: return [x + f(v3, v2), y + 1];         // base
        default: return [x, y + f(v0, v3)];            // esquerda
    }
}

/** Extrai as polilinhas de um nivel. Retorna arrays de pontos em coords de grade. */
function contornar(campo, nx, ny, nivel) {
    const segmentos = [];

    for (let y = 0; y < ny - 1; y++) {
        for (let x = 0; x < nx - 1; x++) {
            const v0 = campo[y * nx + x];
            const v1 = campo[y * nx + x + 1];
            const v2 = campo[(y + 1) * nx + x + 1];
            const v3 = campo[(y + 1) * nx + x];

            let caso = 0;
            if (v0 >= nivel) caso |= 1;
            if (v1 >= nivel) caso |= 2;
            if (v2 >= nivel) caso |= 4;
            if (v3 >= nivel) caso |= 8;
            if (caso === 0 || caso === 15) continue;

            for (const [ea, eb] of MS_ARESTAS[caso]) {
                segmentos.push([
                    msInterpolar(ea, x, y, v0, v1, v2, v3, nivel),
                    msInterpolar(eb, x, y, v0, v1, v2, v3, nivel)
                ]);
            }
        }
    }
    return costurar(segmentos);
}

/** Junta segmentos que compartilham extremidade em polilinhas continuas. */
function costurar(segmentos) {
    const chave = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
    const porPonto = new Map();

    segmentos.forEach((s, i) => {
        for (const p of s) {
            const k = chave(p);
            if (!porPonto.has(k)) porPonto.set(k, []);
            porPonto.get(k).push(i);
        }
    });

    const usado = new Uint8Array(segmentos.length);
    const linhas = [];

    for (let i = 0; i < segmentos.length; i++) {
        if (usado[i]) continue;
        usado[i] = 1;

        const linha = [segmentos[i][0], segmentos[i][1]];

        // Estende a polilinha pelas duas pontas ate nao haver vizinho livre.
        for (const frente of [true, false]) {
            for (;;) {
                const ponta = frente ? linha[linha.length - 1] : linha[0];
                const candidatos = porPonto.get(chave(ponta)) || [];
                let proximo = -1;
                for (const j of candidatos) {
                    if (!usado[j]) { proximo = j; break; }
                }
                if (proximo < 0) break;

                usado[proximo] = 1;
                const [a, b] = segmentos[proximo];
                const novo = chave(a) === chave(ponta) ? b : a;
                if (frente) linha.push(novo); else linha.unshift(novo);
            }
        }

        if (linha.length > 2) linhas.push(linha);
    }
    return linhas;
}

/**
 * Ciclo completo: acumula, suaviza e devolve as isolinhas em lat/lng prontas
 * para o Leaflet, junto com os metadados usados pela legenda.
 */
function calcularKDE(grade, opcoes) {
    const { ano, mes, classesAtivas, metrica, banda } = opcoes;

    const idxMeses = grade.mesesFiltrados(ano, mes);
    const idxClasses = classesAtivas
        .map(c => grade.classes.indexOf(c))
        .filter(i => i >= 0);

    if (idxMeses.length === 0 || idxClasses.length === 0) {
        return { faixas: [], sigmaKm: 0, vazio: true };
    }

    const { soma, pontos } = grade.acumular(idxMeses, idxClasses, metrica);
    if (soma <= 0) return { faixas: [], sigmaKm: 0, vazio: true };

    const sigmaKm = banda === 'auto' ? grade.bandaAutomatica(pontos) : KDE_LARGURAS[banda];
    const sigmaCelulas = sigmaKm / (grade.res * KM_POR_GRAU);

    const campo = grade.suavizar(sigmaCelulas);
    const { niveis } = grade.niveis(campo);

    const faixas = niveis.map((nivel, i) => ({
        nivel,
        cor: KDE_RAMPA[Math.round(i * (KDE_RAMPA.length - 1) / Math.max(1, niveis.length - 1))],
        linhas: contornar(campo, grade.nx, grade.ny, nivel)
            .map(l => l.map(([gx, gy]) => grade.paraLatLng(gx, gy)))
    }));

    return { faixas, sigmaKm, soma, pontos, niveis, vazio: faixas.length === 0 };
}

/**
 * Modo alternativo: retangulos por celula, coloridos pela rampa. Mais legivel
 * que isolinhas em zoom alto e reaproveita exatamente o mesmo campo suavizado.
 */
function celulasKDE(grade, niveis) {
    const { nx, ny, res } = grade;
    const campo = grade.suave;
    const celulas = [];
    if (niveis.length === 0) return celulas;

    for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
            const v = campo[y * nx + x];
            if (v < niveis[0]) continue;

            let faixa = 0;
            while (faixa + 1 < niveis.length && v >= niveis[faixa + 1]) faixa++;

            const lat = grade.lat0 + y * res;
            const lng = grade.lon0 + x * res;
            celulas.push({
                limites: [[lat, lng], [lat + res, lng + res]],
                cor: KDE_RAMPA[Math.round(faixa * (KDE_RAMPA.length - 1) / Math.max(1, niveis.length - 1))]
            });
        }
    }
    return celulas;
}
