/* pwmarket — registro de preços, busca de receitas e planejamento de crafting.
 *
 * Catálogo (itens, receitas, ícones) vem de data/catalog.js, gerado pelo
 * importar.py a partir do pwdatabase.
 *
 * Há dois tipos de dado, guardados separado de propósito:
 *
 *   PREÇOS       são do dono do painel. Publicados em data/precos.js e
 *                somente leitura para quem visita.
 *   MINHA LISTA  e a coluna "Tenho" são de quem está olhando a página. Ficam
 *   + TENHO      no localStorage de cada um e podem ser mexidos SEMPRE, mesmo
 *                em modo consulta — senão um amigo não conseguiria planejar o
 *                craft dele. Quem visita começa com a lista vazia: a lista do
 *                dono vai no arquivo apenas como backup dele.
 */

'use strict';

const CATALOGO = (window.PW_CATALOGO && window.PW_CATALOGO.itens) || {};
const CHAVE_DADOS = 'pwmarket.dados.v1';
const CHAVE_LOCAL = 'pwmarket.local.v1';

const params = new URLSearchParams(location.search);
const publicado = /github\.io$/.test(location.hostname);
const CONSULTA = params.has('consulta') || (publicado && !params.has('editar'));

// ordem das seções na aba Receitas; o resto entra em "Outros"
const SECOES = ['Armas', 'Armaduras', 'Acessórios', 'Materiais'];

let DADOS = { obs: {} };          // do dono
let LOCAL = { favoritos: [] };    // de quem visita
const expandidos = new Set();

// Quando a página é servida pelo servidor.py, os preços vão direto para
// data/precos.js e o botão Exportar deixa de ser necessário. Em file:// isso
// não existe: navegador nenhum escreve no disco a partir de uma página local.
let SERVIDOR = null;              // {arquivo} quando disponível
let salvamentoPendente = null;

/* ------------------------------------------------------------- utilidades */

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const uid = () => Math.random().toString(36).slice(2, 10);
const hoje = () => new Date().toISOString().slice(0, 10);

/** '1.5kk' -> 1500000 · '500k' -> 500000 · '1.500' -> 1500 · '75' -> 75 */
function parseMedas(entrada) {
  const s = String(entrada ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.,]+)(kk|k|m|mi)?$/);
  if (!m) return null;

  let [, num, sufixo] = m;
  if (sufixo) {
    num = num.replace(/,/g, '.');
    const partes = num.split('.');
    if (partes.length > 2) num = partes.slice(0, -1).join('') + '.' + partes.at(-1);
    const v = parseFloat(num);
    if (!isFinite(v)) return null;
    return Math.round(v * (sufixo === 'k' ? 1e3 : 1e6));
  }
  const v = parseFloat(num.replace(/\./g, '').replace(',', '.'));
  return isFinite(v) ? Math.round(v) : null;
}

/** 1500000 -> '1,5kk' · 500000 -> '500k' · 1500 -> '1.500' */
function fmtMedas(v) {
  if (v == null || !isFinite(v)) return '—';
  if (v < 0) return '-' + fmtMedas(-v);
  const curto = (n, div, suf) => {
    const x = n / div;
    const s = (x % 1 === 0 ? String(x) : x.toFixed(x < 10 ? 2 : 1))
      .replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return s.replace('.', ',') + suf;
  };
  if (v >= 1e6) return curto(v, 1e6, 'kk');
  if (v >= 1e4) return curto(v, 1e3, 'k');
  return v.toLocaleString('pt-BR');
}

const fmtCheio = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('pt-BR') + ' medas');
const fmtData = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—');

const item = (id) => CATALOGO[String(id)];
const iconeDe = (id) => `data/icons/${id}.png`;
const ICONE_FALHA = "this.style.visibility='hidden'";

function nomeHTML(it) {
  if (!it) return '<span class="item-nome">item desconhecido</span>';
  return `<span class="item-nome r${it.raridade ?? 0}">${esc(it.nome)}</span>`;
}

/** Materiais craftáveis caem em "Itens Básicos" no pwdatabase; renomeia. */
function secaoDe(it) {
  const t = it?.tipo || '';
  if (SECOES.includes(t)) return t;
  if (t === 'Itens Básicos' || t === 'Materiais') return 'Materiais';
  return 'Outros';
}

/* -------------------------------------------------- saneamento de entrada */

/* Tudo que vem de arquivo (data/precos.js ou um .js/.json importado) passa
 * por aqui antes de existir no app. É a fronteira: depois deste ponto os
 * campos têm tipo garantido, então nenhum deles pode carregar marcação para
 * dentro do HTML — nem por descuido de escape em algum template futuro. */

function sanitizarObs(bruto) {
  const saida = {};
  if (!bruto || typeof bruto !== 'object') return saida;
  for (const [id, lista] of Object.entries(bruto)) {
    if (!/^\d{1,10}$/.test(id) || !Array.isArray(lista)) continue;
    const limpa = lista.slice(0, 500).map((o) => ({
      id: String(o?.id ?? '').slice(0, 32) || uid(),
      v: Math.max(0, Math.round(Number(o?.v)) || 0),
      q: Math.max(1, Math.floor(Number(o?.q)) || 1),
      d: /^\d{4}-\d{2}-\d{2}$/.test(o?.d) ? o.d : hoje(),
      t: o?.t === 'compra' ? 'compra' : 'venda',
      n: String(o?.n ?? '').slice(0, 300),
    })).filter((o) => o.v > 0);
    if (limpa.length) saida[id] = limpa;
  }
  return saida;
}

function sanitizarFavoritos(bruto) {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set();
  const saida = [];
  for (const p of bruto.slice(0, 300)) {
    const itemId = String(p?.itemId ?? '').replace(/\D/g, '').slice(0, 10);
    const receitaId = String(p?.receitaId ?? '').replace(/\D/g, '').slice(0, 10);
    if (!itemId || !receitaId) continue;
    const chave = `${itemId}:${receitaId}`;
    if (vistos.has(chave)) continue;   // chave duplicada quebraria o toggle
    vistos.add(chave);

    const tenho = {};
    for (const [k, v] of Object.entries(p?.tenho ?? {})) {
      if (/^\d{1,10}$/.test(k)) tenho[k] = Math.max(0, Math.floor(Number(v)) || 0);
    }
    saida.push({ chave, itemId, receitaId, qtd: Math.max(1, Math.floor(Number(p?.qtd)) || 1), tenho });
  }
  return saida;
}

/* ------------------------------------------------------------ persistência */

function carregar() {
  const base = window.PW_PRECOS || {};

  // preços: publicado, sobreposto pelo local quando o dono está editando
  DADOS = { obs: sanitizarObs(base.obs) };
  try {
    const bruto = localStorage.getItem(CHAVE_DADOS);
    if (bruto) {
      const d = JSON.parse(bruto);
      if (d.obs) DADOS.obs = sanitizarObs(d.obs);
    }
  } catch (e) {
    console.warn('não consegui ler os preços locais:', e);
  }

  // favoritos: os do visitante; sem nada salvo, começa com os sugeridos
  let salvo = null;
  try {
    salvo = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || 'null');
  } catch (e) {
    console.warn('não consegui ler os favoritos locais:', e);
  }
  LOCAL = {
    favoritos: salvo && Array.isArray(salvo.favoritos)
      ? sanitizarFavoritos(salvo.favoritos)
      : sugeridos(),
  };
}

/** A lista guardada em data/lista.js.
 *
 * Esse arquivo fica fora do git de propósito, então no site publicado ele não
 * existe e todo visitante começa com a lista vazia. Localmente, ele é o backup
 * da lista de quem usa a máquina.
 *
 * `PW_PRECOS.projetos` é o formato antigo, quando os dois viviam no mesmo
 * arquivo; ainda é lido para não descartar a lista de quem já tinha uma.
 */
function sugeridos() {
  if (CONSULTA) return [];
  const lista = window.PW_LISTA || {};
  const antigo = window.PW_PRECOS || {};
  return sanitizarFavoritos(lista.favoritos || antigo.projetos || antigo.favoritos || []);
}

function salvarDados() {
  if (CONSULTA) return;  // preços são do dono
  try {
    localStorage.setItem(CHAVE_DADOS, JSON.stringify({ obs: DADOS.obs }));
  } catch (e) {
    alert('Não consegui salvar no navegador: ' + e.message);
  }
  if (SERVIDOR) agendarEnvio();
}

/* ---------------------------------------------------- gravação no disco */

async function detectarServidor() {
  // file:// nunca tem servidor; no GitHub Pages a API não existe e o pedido só
  // viraria um 404 no console de quem abre a página
  if (CONSULTA || !/^https?:$/.test(location.protocol)) return null;
  try {
    const r = await fetch('api/status', { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d && d.ok ? d : null;
  } catch {
    return null;  // servido por outro http qualquer, sem a nossa API
  }
}

/** Junta gravações próximas: registrar 3 preços seguidos escreve uma vez. */
function agendarEnvio() {
  clearTimeout(salvamentoPendente);
  salvamentoPendente = setTimeout(enviarAoServidor, 600);
}

async function enviarAoServidor() {
  if (!SERVIDOR || CONSULTA) return;
  marcarSalvamento('salvando…');
  try {
    const r = await fetch('api/salvar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ obs: DADOS.obs, favoritos: LOCAL.favoritos }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.erro || `HTTP ${r.status}`);
    marcarSalvamento(`salvo em ${SERVIDOR.arquivo}`, 'ok');
  } catch (e) {
    // sem alert: o dado continua no localStorage, dá para exportar na mão
    marcarSalvamento(`falha ao gravar: ${e.message}`, 'erro');
    console.error('gravação no disco falhou:', e);
  }
}

function marcarSalvamento(texto, estado = '') {
  const el = $('#estadoSalvo');
  if (!el) return;
  el.textContent = texto;
  el.className = 'estado-salvo ' + estado;
}

/** Favoritos salvam sempre — são de quem está usando a página. */
function salvarLocal() {
  try {
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify(LOCAL));
  } catch (e) {
    console.warn('não consegui salvar os favoritos:', e);
  }
  // com o servidor no ar e sendo o dono, os favoritos viram os sugeridos
  if (SERVIDOR && !CONSULTA) agendarEnvio();
}

/* ------------------------------------------------------------ estatísticas */

/** Referência é a mediana: uma loja com preço absurdo não distorce o valor. */
function stats(id) {
  const lista = DADOS.obs[String(id)];
  if (!lista || !lista.length) return null;

  const unit = lista.map((o) => o.v / (o.q || 1)).sort((a, b) => a - b);
  const n = unit.length;
  const mediana = n % 2 ? unit[(n - 1) / 2] : (unit[n / 2 - 1] + unit[n / 2]) / 2;
  const porData = [...lista].sort((a, b) => String(a.d).localeCompare(String(b.d)));

  return {
    n,
    min: unit[0],
    max: unit[n - 1],
    ref: Math.round(mediana),
    ultima: porData[porData.length - 1],
    dataUltima: porData[porData.length - 1].d || '',
  };
}

function avaliar(unit, ref) {
  if (!ref) return null;
  const dif = (unit - ref) / ref;
  if (dif <= -0.15) return { classe: 'barato', txt: 'barato', dif };
  if (dif >= 0.15) return { classe: 'caro', txt: 'caro', dif };
  return { classe: 'normal', txt: 'na média', dif };
}

const pctTxt = (dif) => (dif > 0 ? '+' : '') + Math.round(dif * 100) + '%';

/* -------------------------------------------------------------------- tags */

/* O jogador procura por "dusk 99 dourado", "arma vale da lua", "set pesado" —
 * e nenhum desses é campo do pwdatabase. As tags saem do próprio catálogo:
 *
 *   conteúdo  a zona onde a receita é feita. Nos materiais isso não aparece
 *             (a forja fica no meio do mapa), então vem de quem os consome.
 *   nível     nivel_req do item.
 *   cor       raridade — a mesma que colore o nome dentro do jogo.
 *   set       classe da armadura. Sai do nome da receita ("Bota Pesada Dourada
 *             V. da Lua"), não do subtipo: o pwdatabase tem só dois subtipos de
 *             capacete para três classes, e erra o do set leve.
 */

const GRUPOS_TAG = [
  { id: 'conteudo', rot: 'Conteúdo', tags: [['dusk', 'Dusk'], ['lua', 'Vale da Lua']] },
  { id: 'nivel', rot: 'Nível', tags: [['lv90', '90'], ['lv95', '95'], ['lv99', '99']] },
  // "roxinho" é como o jogador chama o azul-violeta do pwdatabase (raridade 1):
  // Fragmento de Esqueleto, Caveira das Charadas. Material barato, e é
  // justamente o que ninguém quer ver ocupando a tela.
  { id: 'cor', rot: 'Cor', tags: [['dourado', 'Dourado'], ['verde', 'Verde'], ['roxo', 'Roxo'], ['roxinho', 'Roxinho'], ['laranja', 'Laranja']] },
  { id: 'set', rot: 'Set', tags: [['pesado', 'Pesado'], ['leve', 'Leve'], ['mistico', 'Místico']] },
];

const ROTULO_TAG = new Map(GRUPOS_TAG.flatMap((g) => g.tags));
const GRUPO_DA_TAG = new Map(GRUPOS_TAG.flatMap((g) => g.tags.map(([t]) => [t, g.id])));
const ORDEM_TAG = [...ROTULO_TAG.keys()];

const COR_RARIDADE = { 1: 'roxinho', 2: 'dourado', 3: 'roxo', 4: 'laranja', 7: 'verde' };
const ORDEM_COR = ['dourado', 'verde', 'roxo', 'roxinho', 'laranja'];
const NIVEIS_TAG = [90, 95, 99];

const RE_DUSK = /crep[úu]sculo/i;
const RE_LUA = /vale da lua|v\.? ?(?:da )?lua/i;
// os dois últimos são chinês: as capas do Vale da Lua ficaram sem tradução
const RE_PESADO = /pesad|pes\.|重甲/i;
const RE_LEVE = /leve|轻甲/i;
const RE_MAGICO = /m[áa]g|法系/i;

const SUBTIPO_SET = {
  'armadura pesada': 'pesado', 'perneiras pesadas': 'pesado', 'botas pesadas': 'pesado',
  'braceletes pesados': 'pesado', 'elmo pesado': 'pesado',
  'armadura leve': 'leve', 'perneiras leves': 'leve', 'botas leves': 'leve', 'manopla': 'leve',
  'túnica': 'mistico', 'calças místicas': 'mistico', 'sandálias': 'mistico',
  'luvas': 'mistico', 'touca mística': 'mistico',
};

const ehEquipamento = (it) => it?.tipo === 'Armas' || it?.tipo === 'Armaduras' || it?.tipo === 'Acessórios';

/** Onde a receita é feita, pelo que a forja e o nome dela entregam. */
function zonaReceita(r) {
  const txt = `${r?.local || ''} ${r?.npc || ''} ${r?.nome || ''}`;
  if (RE_DUSK.test(txt)) return 'dusk';
  if (RE_LUA.test(txt)) return 'lua';
  return null;
}

/** Zonas de um item pelas próprias receitas — ou pelo nome, quando ele se entrega. */
function zonasProprias(it) {
  const z = new Set();
  for (const r of it.receitas || []) {
    const q = zonaReceita(r);
    if (q) z.add(q);
  }
  if (!z.size && RE_DUSK.test(it.nome || '')) z.add('dusk');
  return z;
}

/* Material nenhum diz de onde vem: "Essência do Crepúsculo" é óbvia, mas
 * "Pedra da Terra do Sonho" é forjada num NPC solto no mapa. Quem responde é
 * o consumo — se um equipamento do Vale da Lua usa o material, o material é
 * do Vale da Lua. Vale para a cadeia inteira, por isso repete até parar de
 * mudar (a maior tem 3 níveis). Um material usado nas duas zonas fica com as
 * duas tags, que é a resposta certa. */
let ZONAS = null;

function zonasDeItem(id) {
  if (!ZONAS) {
    ZONAS = new Map();
    for (const [iid, it] of Object.entries(CATALOGO)) ZONAS.set(iid, zonasProprias(it));
    for (let volta = 0; volta < 8; volta++) {
      let mudou = false;
      for (const [iid, it] of Object.entries(CATALOGO)) {
        const zonas = ZONAS.get(iid);
        if (!zonas.size) continue;
        for (const r of it.receitas || []) {
          for (const g of r.ingredientes || []) {
            const alvo = ZONAS.get(String(g.id));
            if (!alvo) continue;
            for (const q of zonas) {
              if (!alvo.has(q)) { alvo.add(q); mudou = true; }
            }
          }
        }
      }
      if (!mudou) break;
    }
  }
  return ZONAS.get(String(id)) || new Set();
}

/** Classe da armadura de uma receita, ou null se ela não disser. */
function setReceita(it, r) {
  const nome = r?.nome || '';
  if (RE_PESADO.test(nome)) return 'pesado';
  if (RE_LEVE.test(nome)) return 'leve';
  if (RE_MAGICO.test(nome)) return 'mistico';
  return SUBTIPO_SET[(it.subtipo || '').split('/').pop().trim().toLowerCase()] || null;
}

/** Tags de uma receita, sempre na ordem dos grupos. */
function tagsDe(it, r) {
  const t = new Set();

  // No equipamento a zona é da receita — as armas do Vale da Lua têm uma
  // versão feita em Trocas Comerciais, e ela continua sendo do Vale da Lua.
  if (ehEquipamento(it)) {
    const z = zonaReceita(r);
    for (const q of z ? [z] : zonasProprias(it)) t.add(q);
  } else {
    for (const q of zonasDeItem(it.id)) t.add(q);
  }

  if (NIVEIS_TAG.includes(it.nivel_req)) t.add('lv' + it.nivel_req);
  if (COR_RARIDADE[it.raridade]) t.add(COR_RARIDADE[it.raridade]);
  if (it.tipo === 'Armaduras') {
    const s = setReceita(it, r);
    if (s) t.add(s);
  }

  return ORDEM_TAG.filter((x) => t.has(x));
}

/* ------------------------------------------------------------------ origem */

/* De onde o material cai. Vem do "Drop from" do pwdatabase, já podado pelo
 * importar.py: só as duas zonas do painel e um chefe por sala.
 *
 * A sala é o número entre parênteses da coordenada. O pwdatabase não a nomeia,
 * mas ela separa os modos da dusk — o mesmo chefe aparece em salas diferentes,
 * com mais vida no modo difícil. O rótulo ("Dusk 3-3") vem do ajustes.json,
 * então corrigir um modo é editar um JSON, não o código.
 *
 * A TAXA é do banco oficial. Servidor privado mexe em drop rate, então ela
 * aparece sempre rotulada como do pwdatabase — o nome do chefe é o dado
 * confiável aqui, o percentual é referência. */

/* O MODO é do item, não da sala.
 *
 * Cada capítulo da dusk tem três dificuldades, e o mesmo chefe larga material
 * diferente em cada uma — o Rei Cang Li dá Destino do Crepúsculo no 3-2 e
 * Máscara Dourada no 3-3. Então quem responde "que modo eu faço" é o item.
 *
 * Isso não vem do pwdatabase; vem dos guias que o dono do painel passou,
 * transcritos em ajustes.json. Conferidos contra a tabela de drop: em 73 dos
 * 78 materiais com dado dos dois lados o chefe bate, e os 5 restantes são só
 * nome diferente. Item que cai em vários modos tem todos listados. */

const GUIA_ITEM = (window.PW_CATALOGO && window.PW_CATALOGO.guia) || {};
const ZONAS_SALA = (window.PW_CATALOGO && window.PW_CATALOGO.zonas) || {};

/** "Dusk", "Vale da Lua" — a zona, curta. */
function zonaCurta(sala) {
  const z = ZONAS_SALA[String(sala)]?.zona || '';
  return /crep[úu]sculo/i.test(z) ? 'Dusk' : z;
}

/** Onde o material cai: [[chefe, modo], ...]. O Vale da Lua não tem guia, então
 *  os pares saem da própria tabela de drop, com a zona no lugar do modo. */
function origensDoItem(it) {
  const doGuia = GUIA_ITEM[String(it?.id)];
  if (doGuia?.length) return doGuia.map(([c, m]) => [c, `Dusk ${m}`]);

  const vistos = new Map();
  for (const d of it?.drops || []) {
    const par = [d.nome, zonaCurta(d.sala) || 'Outros'];
    vistos.set(par.join('|'), par);
  }
  return [...vistos.values()];
}

/** Modos de um material, sem repetir. */
function modosDoItem(it) {
  return [...new Set(origensDoItem(it).map(([, m]) => m))];
}

/** "Dusk 3-2, 3-3" — compacto, sem repetir "Dusk" a cada modo. */
function rotuloModos(modos) {
  const dusk = modos.filter((m) => /^Dusk \d-\d$/.test(m)).map((m) => m.slice(5));
  const resto = modos.filter((m) => !/^Dusk \d-\d$/.test(m));
  return [dusk.length ? `Dusk ${dusk.join(', ')}` : null, ...resto].filter(Boolean).join(' · ');
}

/** Modos existentes, na ordem em que o jogador pensa (1-1 → 3-3 → Vale da Lua). */
function modosConhecidos() {
  const vistos = new Set();
  for (const it of Object.values(CATALOGO)) {
    if (it.drops?.length) modosDoItem(it).forEach((m) => vistos.add(m));
  }
  // "Dusk 1-1" antes de "Dusk · Qin Tian" antes de "Vale da Lua"
  const peso = (m) => (/^Dusk \d-\d$/.test(m) ? 0 : m.startsWith('Dusk') ? 1 : 2);
  return [...vistos].sort((a, b) =>
    peso(a) - peso(b) || a.localeCompare(b, 'pt-BR', { numeric: true }));
}

const fmtPct = (p) => (p == null ? '' : (p >= 10 ? p.toFixed(1) : p.toFixed(2))
  .replace(/\.?0+$/, '').replace('.', ',') + '%');

/** Uma linha curta: "Rei Cang Li · 0,58%". O modo é do item, vai à parte. */
function textoOrigem(d, comPct = true) {
  return [d.nome, comPct ? fmtPct(d.pct) : null].filter(Boolean).join(' · ');
}

/* O catálogo não muda em tempo de execução, e a grade de receitas remonta a
 * cada tecla digitada na busca — 1059 fichas de ingrediente por render. Montar
 * os mesmos textos toda vez é desperdício puro, então guarda. */
const CACHE_ORIGEM = new Map();

/** Resumo de uma linha para a ficha do ingrediente e a tabela da receita. */
function origemDe(id) {
  const chave = String(id);
  if (CACHE_ORIGEM.has(chave)) return CACHE_ORIGEM.get(chave);

  const it = item(id);
  const ds = it?.drops || [];
  const modos = ds.length ? rotuloModos(modosDoItem(it)) : '';
  const primeiro = ds.length ? textoOrigem(ds[0]) : null;
  const saida = !ds.length ? null : {
    lista: ds,
    modos,
    // o modo vem primeiro: é por ele que o jogador escolhe o que vai fazer
    curto: [modos, ds.length > 1 ? `${primeiro} +${ds.length - 1}` : primeiro]
      .filter(Boolean).join(' · '),
    // o title completo: até 6 chefes, senão vira parede de texto
    longo: (modos ? `${modos}\n\n` : '')
      + 'Cai de:\n' + ds.slice(0, 6).map((d) => '· ' + textoOrigem(d)).join('\n')
      + (ds.length > 6 ? `\n· +${ds.length - 6} outros` : '')
      + '\n(taxas do pwdatabase, podem diferir no servidor)',
  };
  CACHE_ORIGEM.set(chave, saida);
  return saida;
}

/* ---------------------------------------------------------------- receitas */

/* Mesma história do CACHE_ORIGEM: todasReceitas() é chamada três vezes por
 * render (lista, contagem dos chips e rodapé) e a string de busca de cada
 * receita costura nome, tags, ingredientes e chefes. Devolve uma cópia rasa
 * porque renderReceitas ordena o resultado no lugar. */
let CACHE_RECEITAS = null;

function todasReceitas() {
  if (!CACHE_RECEITAS) CACHE_RECEITAS = montarReceitas();
  return CACHE_RECEITAS.slice();
}

/** Achata o catálogo em uma lista de receitas, uma entrada por receita. */
function montarReceitas() {
  const saida = [];
  for (const it of Object.values(CATALOGO)) {
    for (const r of it.receitas || []) {
      if (!r.ingredientes || !r.ingredientes.length) continue;
      const tags = tagsDe(it, r);
      saida.push({
        chave: `${it.id}:${r.id}`,
        it,
        r,
        secao: secaoDe(it),
        tags,
        // texto único para a busca: item, receita, forja, tags, ingredientes e
        // os chefes que largam esses ingredientes. As tags entram aqui também
        // para "dusk 99" funcionar digitado — a palavra "dusk" não aparece em
        // campo nenhum do pwdatabase. E buscar "cang li" lista tudo que
        // depende de material que ele solta.
        busca: [
          it.nome, it.tipo, it.subtipo, r.nome, r.npc, r.local,
          ...tags.map((x) => ROTULO_TAG.get(x)),
          ...r.ingredientes.flatMap((g) => {
            const ing = item(g.id);
            if (!ing?.drops?.length) return [g.nome];
            return [g.nome, ...ing.drops.map((d) => d.nome), ...modosDoItem(ing)];
          }),
        ].join(' ').toLowerCase(),
      });
    }
  }
  return saida;
}

/** Custo de uma receita a preço de referência, ignorando estoque. */
function custoReceita(r, qtd = 1) {
  let total = 0;
  let semPreco = 0;
  for (const g of r.ingredientes) {
    const s = stats(g.id);
    if (s?.ref != null) total += s.ref * g.qtd * qtd;
    else semPreco++;
  }
  return { total, semPreco, completo: semPreco === 0 };
}

const ehFavorito = (chave) => LOCAL.favoritos.some((f) => f.chave === chave);

function alternarFavorito(chave) {
  const i = LOCAL.favoritos.findIndex((f) => f.chave === chave);
  if (i >= 0) {
    LOCAL.favoritos.splice(i, 1);
  } else {
    const [itemId, receitaId] = chave.split(':');
    LOCAL.favoritos.push({ chave, itemId, receitaId, qtd: 1, tenho: {} });
  }
  salvarLocal();
}

/* ================================================================ PREÇOS */

function renderPrecos() {
  const alvo = $('#conteudoPrecos');
  const termo = $('#filtroPrecos').value.trim().toLowerCase();
  const ordem = $('#ordemPrecos').value;

  let ids = Object.keys(DADOS.obs).filter((id) => (DADOS.obs[id] || []).length);

  if (!ids.length) {
    alvo.innerHTML = `<div class="vazio"><strong>Nenhum preço registrado ainda</strong>
      ${CONSULTA ? 'O dono do painel ainda não publicou preços.' :
        'Use <em>+ Registrar preço</em> para anotar o que você viu nas lojas e no chat.'}
      <div style="margin-top:14px">Catálogo local: ${Object.keys(CATALOGO).length} itens.
      Para trazer mais: <code>py importar.py --nome "…"</code></div></div>`;
    return;
  }

  if (termo) {
    ids = ids.filter((id) => {
      const it = item(id);
      return it && [it.nome, it.tipo, it.subtipo].join(' ').toLowerCase().includes(termo);
    });
  }

  const st = {};
  ids.forEach((id) => (st[id] = stats(id)));

  const nomeDe = (id) => (item(id)?.nome || '').toLowerCase();
  ids.sort((a, b) => {
    switch (ordem) {
      case 'ref-desc': return (st[b].ref || 0) - (st[a].ref || 0);
      case 'ref-asc': return (st[a].ref || 0) - (st[b].ref || 0);
      case 'recente': return String(st[b].dataUltima).localeCompare(String(st[a].dataUltima));
      case 'obs': return st[b].n - st[a].n;
      default: return nomeDe(a).localeCompare(nomeDe(b), 'pt-BR');
    }
  });

  if (!ids.length) {
    alvo.innerHTML = `<div class="vazio"><strong>Nada com esse filtro</strong>
      Nenhum item registrado casa com “${esc(termo)}”.</div>`;
    return;
  }

  const linhas = ids.map((id) => {
    const it = item(id);
    const s = st[id];
    const obs = [...DADOS.obs[id]].sort((a, b) => String(b.d).localeCompare(String(a.d)));
    const aberto = expandidos.has(id);

    const historico = obs.map((o) => {
      const unit = o.v / (o.q || 1);
      const av = avaliar(unit, s.ref);
      return `<div class="obs">
        <span class="data">${fmtData(o.d)}</span>
        <span class="medas" title="${fmtCheio(unit)} por unidade">${fmtMedas(unit)}</span>
        ${o.q > 1 ? `<span class="faixa">(${o.q}× por ${fmtMedas(o.v)})</span>` : ''}
        <span class="faixa">${o.t === 'compra' ? 'WTB' : 'venda'}</span>
        ${av && s.n > 1 ? `<span class="pastilha ${av.classe}">${pctTxt(av.dif)}</span>` : ''}
        <span class="nota">${esc(o.n || '')}</span>
        ${CONSULTA ? '' : `<button class="mini perigo so-edicao" data-del-obs="${id}" data-obs-id="${esc(o.id)}">remover</button>`}
      </div>`;
    }).join('');

    return `<tr data-id="${id}">
      <td>
        <div class="item-cel">
          <img class="icone" src="${iconeDe(id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
          <div>
            ${nomeHTML(it)}
            <div class="item-sub">${esc(it?.subtipo || it?.tipo || '—')}</div>
          </div>
        </div>
      </td>
      <td class="num"><span class="medas ref" title="${fmtCheio(s.ref)}">${fmtMedas(s.ref)}</span></td>
      <td class="num"><span class="faixa" title="mínimo e máximo observados">${fmtMedas(s.min)} – ${fmtMedas(s.max)}</span></td>
      <td class="meio"><span class="contagem" title="observações registradas">${s.n}</span></td>
      <td class="num"><span class="faixa">${fmtData(s.dataUltima)}</span></td>
      <td class="acoes">
        <button class="mini" data-expandir="${id}">${aberto ? 'fechar' : `histórico (${s.n})`}</button>
        ${CONSULTA ? '' : `<button class="mini so-edicao" data-add-obs="${id}">+ obs</button>`}
      </td>
    </tr>
    <tr class="historico ${aberto ? '' : 'oculto'}" data-hist="${id}">
      <td colspan="6"><div class="obs-lista">${historico}</div></td>
    </tr>`;
  }).join('');

  alvo.innerHTML = `<div class="tabela-wrap"><table>
    <thead><tr>
      <th>Item</th><th class="num">Preço ref.</th><th class="num">Faixa</th>
      <th class="meio">Obs.</th><th class="num">Última</th><th></th>
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

/* ============================================================== RECEITAS */

const filtroTags = new Set();

/** OR dentro do grupo, AND entre grupos: marcar Dourado e Verde alarga a
 *  busca, marcar Dourado e Dusk aperta — que é como o jogador pensa. */
function casaTags(x, ativas) {
  if (!ativas.size) return true;
  for (const g of GRUPOS_TAG) {
    const doGrupo = g.tags.filter(([t]) => ativas.has(t));
    if (doGrupo.length && !doGrupo.some(([t]) => x.tags.includes(t))) return false;
  }
  return true;
}

/** Receitas que passam pela busca e pela seção — a base das contagens. */
function receitasFiltradas(comTags = true) {
  const termo = $('#filtroReceitas').value.trim().toLowerCase();
  const secao = $('#secaoReceitas').value;

  let lista = todasReceitas();
  if (secao) lista = lista.filter((x) => x.secao === secao);
  if (termo) {
    // cada palavra tem que aparecer em algum campo — busca AND
    const palavras = termo.split(/\s+/);
    lista = lista.filter((x) => palavras.every((p) => x.busca.includes(p)));
  }
  if (comTags) lista = lista.filter((x) => casaTags(x, filtroTags));
  return lista;
}

/** Quantas receitas sairiam ao marcar esta tag, respeitando os outros grupos.
 *  Sem isso o filtro é tentativa e erro: dá para clicar e cair em zero. */
function contarTag(base, tag) {
  const grupo = GRUPO_DA_TAG.get(tag);
  const ativas = new Set([...filtroTags].filter((t) => GRUPO_DA_TAG.get(t) !== grupo));
  ativas.add(tag);
  return base.reduce((n, x) => n + (casaTags(x, ativas) ? 1 : 0), 0);
}

function renderChipsTags() {
  const base = receitasFiltradas(false);

  // tag que não sobrou nada só ocupa espaço; a marcada fica para poder desmarcar
  const grupos = GRUPOS_TAG.map((g) => {
    const chips = g.tags
      .map(([t, rot]) => ({ t, rot, n: contarTag(base, t) }))
      .filter((c) => c.n > 0 || filtroTags.has(c.t));
    if (!chips.length) return '';
    return `<div class="grupo-tag"><span class="rot">${esc(g.rot)}</span>${chips.map((c) => {
      const on = filtroTags.has(c.t);
      return `<button class="chip-tag p-${esc(c.t)}${on ? ' on' : ''}" data-tag="${esc(c.t)}"
        aria-pressed="${on}" title="${on ? 'Desmarcar' : 'Filtrar por'} ${esc(c.rot)}"
        >${esc(c.rot)}<span class="n">${c.n}</span></button>`;
    }).join('')}</div>`;
  }).join('');

  $('#chipsTags').innerHTML = grupos + (filtroTags.size
    ? '<button class="chip-tag limpar" data-limpar-tags="1">✕ limpar</button>' : '');
}

function alternarTag(tag) {
  if (!ROTULO_TAG.has(tag)) return;
  if (filtroTags.has(tag)) filtroTags.delete(tag);
  else filtroTags.add(tag);
  renderReceitas();
}

function renderReceitas() {
  const alvo = $('#conteudoReceitas');
  const termo = $('#filtroReceitas').value.trim().toLowerCase();
  const secao = $('#secaoReceitas').value;
  const ordem = $('#ordemReceitas').value;

  renderChipsTags();
  const lista = receitasFiltradas();

  if (!lista.length) {
    alvo.innerHTML = `<div class="vazio"><strong>Nenhuma receita encontrada</strong>
      ${termo || secao || filtroTags.size ? 'Tente outro termo, seção ou combinação de tags.'
        : `O catálogo tem ${Object.keys(CATALOGO).length} itens, nenhum com receita.`}</div>`;
    return;
  }

  const custos = new Map(lista.map((x) => [x.chave, custoReceita(x.r)]));
  lista.sort((a, b) => {
    switch (ordem) {
      case 'nivel':
        return (a.it.nivel_req || 0) - (b.it.nivel_req || 0)
          || a.it.nome.localeCompare(b.it.nome, 'pt-BR');
      case 'custo-asc': return custos.get(a.chave).total - custos.get(b.chave).total;
      case 'custo-desc': return custos.get(b.chave).total - custos.get(a.chave).total;
      default: return a.it.nome.localeCompare(b.it.nome, 'pt-BR');
    }
  });

  // agrupa mantendo a ordem de SECOES
  const grupos = new Map();
  for (const x of lista) {
    if (!grupos.has(x.secao)) grupos.set(x.secao, []);
    grupos.get(x.secao).push(x);
  }
  const ordemSecao = [...SECOES, 'Outros'].filter((s) => grupos.has(s));

  alvo.innerHTML = ordemSecao.map((s) => `
    <div class="secao">${esc(s)} <span class="qtd">${grupos.get(s).length}</span></div>
    <div class="grade-receitas">${grupos.get(s).map(cardReceita).join('')}</div>
  `).join('');
}

const SINAL = '<span class="falta-preco" title="sem preço registrado">!</span>';

function cardReceita(x) {
  const { it, r, chave } = x;
  const c = custoReceita(r);
  const fav = ehFavorito(chave);

  const chips = r.ingredientes.map((g) => {
    const s = stats(g.id);
    const semPreco = s?.ref == null;
    const nome = item(g.id)?.nome || g.nome;
    const preco = semPreco ? 'sem preço registrado'
      : `${fmtMedas(s.ref)} un · subtotal ${fmtMedas(s.ref * g.qtd)}`;
    const o = origemDe(g.id);
    const dica = `${esc(nome)} — ${g.qtd}× · ${preco}${o ? '\n\n' + esc(o.longo) : ''}`;
    return `<span class="ing-chip${semPreco ? ' sem-preco' : ''}" title="${dica}">
      <img src="${iconeDe(g.id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">${g.qtd}${semPreco ? SINAL : ''}</span>`;
  }).join('');

  // O "+" sozinho não diz por que o número está incompleto — o aviso ao lado diz.
  const custo = c.total === 0 && !c.completo
    ? `<span class="aviso-sem-preco">${SINAL} Nenhum material tem preço registrado</span>`
    : `<span class="custo-chip${c.completo ? '' : ' parcial'}"
         title="${c.completo ? fmtCheio(c.total)
           : `${fmtCheio(c.total)} — parcial, ${c.semPreco} ingrediente(s) sem preço`}"
         >${fmtMedas(c.total)}${c.completo ? '' : '+'}</span>`
      + (c.completo ? ''
        : `<span class="aviso-sem-preco">${SINAL} Há materiais sem preço registrado</span>`);

  const prob = r.prob != null && r.prob < 100
    ? `<span class="pastilha caro" title="chance por tentativa">${r.prob}%</span>` : '';

  // clicáveis: a tag no cartão é o caminho mais curto para "quero mais disso"
  const tags = x.tags.map((t) => `<button class="pill p-${esc(t)}${filtroTags.has(t) ? ' on' : ''}"
      data-tag="${esc(t)}" title="Filtrar por ${esc(ROTULO_TAG.get(t))}"
      >${esc(ROTULO_TAG.get(t))}</button>`).join('');

  return `<div class="receita clicavel${fav ? ' favorita' : ''}" data-receita="${esc(chave)}"
       title="Ver a receita e adicionar à sua lista">
    <img class="icone" src="${iconeDe(it.id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
    <div class="corpo">
      <div class="topo">
        <div class="titulo">${nomeHTML(it)}</div>
        ${it.nivel_req ? `<span class="lv">lv ${it.nivel_req}</span>` : ''}
        <button class="estrela${fav ? ' on' : ''}" data-fav="${esc(chave)}"
                title="${fav ? 'Tirar da minha lista' : 'Adicionar à minha lista'}">${fav ? '★' : '☆'}</button>
      </div>
      <div class="rec" title="${esc(r.nome)}">${esc(r.nome)} ${prob}</div>
      <div class="forja">${esc(r.npc || '—')}${r.local ? ' · ' + esc(r.local) : ''}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      <div class="pe">
        <div class="ingredientes">${chips}</div>
        ${custo}
      </div>
    </div>
  </div>`;
}

/* ================================================================= DROPS */

/* A aba responde a pergunta inversa da aba Receitas: em vez de "o que preciso
 * para esta peça", ela responde "o que este chefe me dá".
 *
 * Por isso o bloco é o CHEFE em um modo — "Rei Cang Li · Dusk 3-2" — e não o
 * item. É assim que a run acontece: você entra num modo, mata os chefes dele e
 * cada um solta a lista dele. Material que cai em mais de um lugar aparece em
 * cada bloco onde cai, com um botão para ver os outros. */

const filtroModos = new Set();
const filtroCores = new Set();
const fontesAbertas = new Set();

/** Chance deste material neste chefe, pela tabela de drop do pwdatabase. */
function chanceEm(it, chefe) {
  const ds = it.drops || [];
  const doChefe = ds.filter((d) => d.nome === chefe);
  // "Baú e mobs" não é um chefe: o guia agrupa baú, mobs comuns e chefe menor.
  // Aí vale a melhor chance registrada, que é a informação útil.
  const alvo = doChefe.length ? doChefe : (chefe === 'Baú e mobs' ? ds : []);
  return alvo.length ? Math.max(...alvo.map((d) => d.pct || 0)) : null;
}

let CACHE_USOS = null;

/** Quantas receitas do catálogo consomem este item. */
function usosDe(id) {
  if (!CACHE_USOS) {
    CACHE_USOS = new Map();
    for (const it of Object.values(CATALOGO)) {
      for (const r of it.receitas || []) {
        for (const g of r.ingredientes || []) {
          const k = String(g.id);
          CACHE_USOS.set(k, (CACHE_USOS.get(k) || 0) + 1);
        }
      }
    }
  }
  return CACHE_USOS.get(String(id)) || 0;
}

/** Um bloco por (chefe, modo), com os materiais que ele larga naquele modo. */
let CACHE_BLOCOS = null;

function todosBlocos() {
  if (CACHE_BLOCOS) return CACHE_BLOCOS;
  const mapa = new Map();
  for (const it of Object.values(CATALOGO)) {
    if (!it.drops?.length) continue;
    const origens = origensDoItem(it);
    for (const [chefe, modo] of origens) {
      const chave = `${chefe}|${modo}`;
      if (!mapa.has(chave)) mapa.set(chave, { chave, chefe, modo, itens: [] });
      mapa.get(chave).itens.push({
        it,
        pct: chanceEm(it, chefe),
        cor: COR_RARIDADE[it.raridade] || null,
        usos: usosDe(it.id),
        // as outras origens do mesmo material — é o que o "+N" abre
        outras: origens.filter(([c, m]) => c !== chefe || m !== modo),
      });
    }
  }

  for (const b of mapa.values()) {
    b.itens.sort((a, c) => (c.pct ?? -1) - (a.pct ?? -1)
      || a.it.nome.localeCompare(c.it.nome, 'pt-BR'));
    b.busca = [b.chefe, b.modo, ...b.itens.map((l) => l.it.nome)].join(' ').toLowerCase();
  }
  CACHE_BLOCOS = [...mapa.values()];
  return CACHE_BLOCOS;
}

/** Modos existentes, na ordem em que o jogador pensa (1-1 → 3-3 → Vale da Lua). */
function modosConhecidos() {
  const vistos = new Set();
  for (const it of Object.values(CATALOGO)) {
    if (it.drops?.length) modosDoItem(it).forEach((m) => vistos.add(m));
  }
  const peso = (m) => (/^Dusk \d-\d$/.test(m) ? 0 : m === 'Vale da Lua' ? 2 : 1);
  return [...vistos].sort((a, b) =>
    peso(a) - peso(b) || a.localeCompare(b, 'pt-BR', { numeric: true }));
}

/** Cores presentes nos materiais que dropam, na ordem em que o jogador pensa. */
function coresConhecidas() {
  const tem = new Set();
  for (const it of Object.values(CATALOGO)) {
    if (it.drops?.length && COR_RARIDADE[it.raridade]) tem.add(COR_RARIDADE[it.raridade]);
  }
  return ORDEM_COR.filter((c) => tem.has(c));
}

/* A cor filtra DENTRO do bloco, não o bloco inteiro: marcar "dourado" junto com
 * o 3-3 mostra os chefes do 3-3 com só o que eles largam de dourado. Bloco que
 * fica sem item nenhum sai da lista. */
function blocosFiltrados() {
  const termo = $('#filtroDrops').value.trim().toLowerCase();
  const palavras = termo ? termo.split(/\s+/) : [];

  const saida = [];
  for (const b of todosBlocos()) {
    if (filtroModos.size && !filtroModos.has(b.modo)) continue;

    // o termo casa o bloco inteiro (nome do chefe) ou item a item
    const cabecalho = `${b.chefe} ${b.modo}`.toLowerCase();
    const blocoCasa = palavras.length && palavras.every((p) => cabecalho.includes(p));
    let itens = b.itens;
    if (palavras.length && !blocoCasa) {
      itens = itens.filter((l) => palavras.every((p) => l.it.nome.toLowerCase().includes(p)));
    }
    if (filtroCores.size) itens = itens.filter((l) => l.cor && filtroCores.has(l.cor));
    if (!itens.length) continue;

    saida.push({ ...b, itens });
  }
  return saida;
}

const GRUPOS_DROP = [
  { id: 'modo', rot: 'Modo', set: filtroModos, valores: modosConhecidos },
  { id: 'cor', rot: 'Cor', set: filtroCores, valores: coresConhecidas },
];

/** Quantos materiais sobrariam ao marcar este chip, respeitando o outro grupo. */
function contarChipDrop(grupo, valor) {
  const alvo = GRUPOS_DROP.find((g) => g.id === grupo).set;
  const guardado = [...alvo];
  alvo.clear();
  alvo.add(valor);
  const n = new Set(blocosFiltrados().flatMap((b) => b.itens.map((l) => String(l.it.id)))).size;
  alvo.clear();
  guardado.forEach((v) => alvo.add(v));
  return n;
}

function renderChipsDrops() {
  const marcado = GRUPOS_DROP.some((g) => g.set.size);

  const html = GRUPOS_DROP.map((g) => {
    const chips = g.valores()
      .map((v) => ({ v, n: contarChipDrop(g.id, v) }))
      .filter((c) => c.n > 0 || g.set.has(c.v));
    if (!chips.length) return '';
    return `<div class="grupo-tag"><span class="rot">${esc(g.rot)}</span>${chips.map((c) => {
      const on = g.set.has(c.v);
      const rot = g.id === 'cor' ? ROTULO_TAG.get(c.v) || c.v : c.v;
      return `<button class="chip-tag${g.id === 'cor' ? ' p-' + esc(c.v) : ''}${on ? ' on' : ''}"
        data-drop-grupo="${esc(g.id)}" data-drop-valor="${esc(c.v)}" aria-pressed="${on}"
        title="${on ? 'Desmarcar' : 'Filtrar por'} ${esc(rot)}"
        >${esc(rot)}<span class="n">${c.n}</span></button>`;
    }).join('')}</div>`;
  }).join('');

  $('#chipsDrops').innerHTML = html
    + (marcado ? '<button class="chip-tag limpar" data-limpar-modos="1">✕ limpar</button>' : '');
}

function renderDrops() {
  const alvo = $('#conteudoDrops');
  const termo = $('#filtroDrops').value.trim();
  const ordem = $('#ordemDrops').value || 'modo';

  renderChipsDrops();
  const lista = blocosFiltrados();

  if (!lista.length) {
    alvo.innerHTML = `<div class="vazio"><strong>Nada encontrado</strong>
      ${termo || filtroModos.size || filtroCores.size ? 'Tente outro termo, modo ou cor.'
        : 'O catálogo ainda não tem origem de drop. Rode <code>py importar.py --redrops</code>.'}</div>`;
    return;
  }

  const melhor = (b) => Math.max(...b.itens.map((l) => l.pct ?? 0));
  lista.sort((a, b) => {
    switch (ordem) {
      case 'nome': return a.chefe.localeCompare(b.chefe, 'pt-BR');
      case 'pct-desc': return melhor(b) - melhor(a);
      case 'pct-asc': return melhor(a) - melhor(b);
      default:
        return a.modo.localeCompare(b.modo, 'pt-BR', { numeric: true })
          || b.itens.length - a.itens.length
          || a.chefe.localeCompare(b.chefe, 'pt-BR');
    }
  });

  const grupos = new Map();
  for (const b of lista) {
    const g = ordem === 'modo' ? b.modo : 'Chefes';
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(b);
  }

  alvo.innerHTML = [...grupos].map(([g, bs]) => `
    <div class="secao">${esc(g)} <span class="qtd">${bs.length} chefe${bs.length > 1 ? 's' : ''}</span></div>
    <div class="grade-drops">${bs.map(cardBloco).join('')}</div>
  `).join('')
    + `<p class="nota-drops">Quem larga o quê vem dos guias da dusk; as chances vêm do
       <strong>pwdatabase</strong>, do banco oficial do jogo. O The PW Clássico pode ter
       ajustado os valores — o chefe é o dado firme, a porcentagem é referência.</p>`;
}

/* Material que cai em mais de um lugar ganha um "+N": abrir mostra os outros
 * chefes e modos. Sem isso, quem olha o bloco do Feng Wuhen no 2-1 não faz
 * ideia de que as Luvas também caem no 2-2. */
function linhaDrop(l, chaveBloco) {
  const id = `${chaveBloco}|${l.it.id}`;
  const aberto = fontesAbertas.has(id);
  const extra = l.outras.length
    ? `<button class="mais-fontes${aberto ? ' on' : ''}" data-expandir="${esc(id)}"
         title="${aberto ? 'Fechar' : 'Ver os outros lugares onde cai'}"
         >+${l.outras.length}</button>` : '';

  const detalhe = aberto ? `
    <div class="fontes">${l.outras.map(([c, m]) => `
      <div><span class="modo">${esc(m)}</span> ${esc(c)}
        <span class="medas fraco">${fmtPct(chanceEm(l.it, c))}</span></div>`).join('')}
    </div>` : '';

  return `<div class="linha-drop">
    <img class="icone pequeno" src="${iconeDe(l.it.id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
    <span class="nome" title="${esc(l.it.nome)}${l.usos ? ` — usado em ${l.usos} receita(s)` : ''}"
      >${nomeHTML(l.it)}</span>
    ${extra}
    <span class="chance medas${(l.pct ?? 0) >= 5 ? '' : ' fraco'}">${l.pct == null ? '—' : fmtPct(l.pct)}</span>
  </div>${detalhe}`;
}

/* No Vale da Lua quase todo mob larga quase todo material — tem chefe com 23
 * linhas. Na dusk o guia já entrega listas curtas. Acima do limite o bloco
 * mostra os de maior chance e abre no clique. */
const LIMITE_ITENS = 6;
const blocosAbertos = new Set();

function cardBloco(b) {
  const aberto = blocosAbertos.has(b.chave);
  const cortar = b.itens.length > LIMITE_ITENS && !aberto;
  const mostrados = cortar ? b.itens.slice(0, LIMITE_ITENS) : b.itens;
  const escondidos = b.itens.length - mostrados.length;

  const alternar = b.itens.length > LIMITE_ITENS
    ? `<button class="mais-chefes" data-abrir-bloco="${esc(b.chave)}">${escondidos
        ? `+ ${escondidos} material${escondidos > 1 ? 'is' : ''}`
        : '− recolher'}</button>`
    : '';

  return `<div class="drop-card">
    <div class="bloco-topo">
      <span class="chefe">${esc(b.chefe)}</span>
      <span class="modo">${esc(b.modo)}</span>
    </div>
    ${mostrados.map((l) => linhaDrop(l, b.chave)).join('')}
    ${alternar}
  </div>`;
}

/* ------------------------------------------------- preview de uma receita */

/** Monta a tabela de ingredientes. Sem `favChave`, a coluna Tenho é só leitura
 *  — é o preview de como a receita vai aparecer depois de favoritada. */
function tabelaIngredientes(c, favChave = null) {
  const linhas = c.linhas.map((l) => {
    // No lugar do "craftável": de onde o material sai. Um material craftável
    // que também dropa mostra os dois — são dois caminhos de verdade.
    const o = origemDe(l.ing.id);
    const sub = [
      l.temReceita ? 'craftável' : null,
      o ? `<span class="origem" title="${esc(o.longo)}">${esc(o.curto)}</span>` : null,
    ].filter(Boolean).join(' · ');

    return `
    <tr class="${l.falta === 0 ? 'completo' : ''}">
      <td>
        <div class="item-cel">
          <img class="icone pequeno" src="${iconeDe(l.ing.id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
          <div>
            ${nomeHTML(item(l.ing.id) || { nome: l.ing.nome, raridade: l.ing.raridade })}
            ${sub ? `<div class="item-sub">${sub}</div>` : ''}
          </div>
        </div>
      </td>
      <td class="num"><span class="medas fraco">${l.precisa}</span></td>
      <td class="meio">${favChave
        ? `<input class="qtd-input" type="number" min="0" step="1" value="${l.tenho}"
                  data-tenho="${esc(favChave)}" data-ing="${l.ing.id}">`
        : `<span class="medas fraco">${l.tenho}</span>`}</td>
      <td class="num"><span class="medas">${l.falta || '—'}</span></td>
      <td class="num">${l.unit != null
        ? `<span class="medas fraco" title="${fmtCheio(l.unit)}">${fmtMedas(l.unit)}</span>`
        : `<span class="aviso-sem-preco">${SINAL} sem preço</span>`}</td>
      <td class="num">${l.sub != null
        ? `<span class="medas" title="${fmtCheio(l.sub)}">${l.falta ? fmtMedas(l.sub) : '—'}</span>`
        : `<span class="medas fraco">?</span>`}</td>
    </tr>`;
  }).join('');

  return `<div class="tabela-wrap"><table>
    <thead><tr>
      <th>Ingrediente</th><th class="num">Precisa</th><th class="meio">Tenho</th>
      <th class="num">Falta</th><th class="num">Preço un.</th><th class="num">Subtotal</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table></div>`;
}

function avisoParcial(c) {
  if (!c.semPreco.length) return '';
  return `<div class="aviso-preco">${SINAL} Total parcial: ${c.semPreco.length} ingrediente(s)
    sem preço registrado — ${c.semPreco.map((i) => esc(item(i.id)?.nome || i.nome)).join(', ')}.
    Registre o preço deles para o custo ficar completo.</div>`;
}

let previewChave = null;

function abrirPreviewReceita(chave) {
  const x = todasReceitas().find((r) => r.chave === chave);
  if (!x) return;
  previewChave = chave;

  const fav = LOCAL.favoritos.find((f) => f.chave === chave);
  const c = calcular(fav || { itemId: x.it.id, receitaId: x.r.id, qtd: 1, tenho: {} });
  if (!c) return;

  const prob = c.receita.prob != null && c.receita.prob < 100
    ? `<span class="pastilha caro" title="chance por tentativa">${c.receita.prob}%</span>` : '';

  $('#corpoReceita').innerHTML = `
    <div class="preview-topo">
      <img class="icone" src="${iconeDe(x.it.id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
      <div>
        <div class="titulo">${nomeHTML(x.it)} ${x.it.nivel_req ? `<span class="lv">lv ${x.it.nivel_req}</span>` : ''} ${prob}</div>
        <div class="meta">${esc(c.receita.nome)}</div>
        <div class="meta">${esc(c.receita.npc || '—')}${c.receita.local ? ' · ' + esc(c.receita.local) : ''}</div>
      </div>
    </div>
    ${tabelaIngredientes(c, null)}
    ${avisoParcial(c)}
    <div class="total">
      <span class="rotulo">${fav ? 'Falta comprar' : 'Custo estimado'}</span>
      <span class="valor" title="${fmtCheio(c.total)}">${fmtMedas(c.total)}${c.semPreco.length ? '+' : ''}</span>
    </div>
    ${fav ? '' : `<div class="preview-nota">${SINAL}
      <div>Esta é uma <strong>prévia</strong>. A coluna <strong>Tenho</strong> fica editável
      depois que a receita entrar na <strong>sua lista</strong> — é lá que você marca o que já
      tem e acompanha quanto ainda falta comprar.</div></div>`}`;

  const botao = $('#btnFavoritarPreview');
  botao.className = 'acao grande' + (fav ? ' ja' : '');
  botao.innerHTML = fav
    ? '<strong>Já está na sua lista</strong>Ir para a lista e continuar de onde parou'
    : '<strong>Adicionar à minha lista</strong>Adicione à sua lista para poder acompanhar '
      + 'a receita e marcar os materiais que você já possui';

  $('#modalReceita').classList.remove('oculto');
  botao.focus();
}

function confirmarPreview() {
  if (!previewChave) return;
  if (!ehFavorito(previewChave)) {
    alternarFavorito(previewChave);
    renderReceitas();
  }
  fecharModais();
  irPara('favoritos');
  renderFav();
  // leva o olho até o card recém-adicionado; a chave é sempre "digitos:digitos"
  // depois do saneamento, então cabe direto no seletor
  const alvo = $(`[data-fav-card="${previewChave}"]`);
  if (alvo && alvo.scrollIntoView) alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ============================================================= FAVORITOS */

/** Resolve um favorito em linhas de ingrediente + totais. */
function calcular(fav) {
  const it = item(fav.itemId);
  const receita = (it?.receitas || []).find((r) => String(r.id) === String(fav.receitaId))
    || (it?.receitas || [])[0];
  if (!receita) return null;

  const qtd = Math.max(1, fav.qtd || 1);
  let total = 0;
  const semPreco = [];

  const linhas = receita.ingredientes.map((ing) => {
    const precisa = ing.qtd * qtd;
    const tenho = Math.max(0, Number(fav.tenho?.[ing.id]) || 0);
    const falta = Math.max(0, precisa - tenho);
    const s = stats(ing.id);
    const unit = s?.ref ?? null;
    const sub = unit != null ? falta * unit : null;

    if (sub != null) total += sub;
    else if (falta > 0) semPreco.push(ing);

    return { ing, precisa, tenho, falta, unit, sub, temReceita: !!item(ing.id)?.receitas?.length };
  });

  return { it, receita, qtd, linhas, total, semPreco };
}

function renderFav() {
  const alvo = $('#conteudoFav');
  const termo = $('#filtroFav').value.trim().toLowerCase();

  atualizarBadge();

  if (!LOCAL.favoritos.length) {
    alvo.innerHTML = `<div class="vazio"><strong>Sua lista está vazia</strong>
      Vá em <em>Receitas</em>, abra a que você quer produzir e clique em
      <em>Adicionar à minha lista</em> — ou use a estrela ☆ direto no cartão.
      <div style="margin-top:12px">Aqui você marca o que já tem e acompanha
      quanto ainda falta comprar.</div></div>`;
    return;
  }

  const lista = LOCAL.favoritos.filter((f) => {
    if (!termo) return true;
    const it = item(f.itemId);
    return [it?.nome, it?.tipo, it?.subtipo].join(' ').toLowerCase().includes(termo);
  });

  if (!lista.length) {
    alvo.innerHTML = `<div class="vazio"><strong>Nada com esse filtro</strong></div>`;
    return;
  }

  const resumo = resumoLista(lista);
  const cards = lista.map((fav) => {
    const c = calcular(fav);
    if (!c) {
      return `<div class="projeto"><div class="projeto-topo">
        <div><div class="projeto-titulo">Receita indisponível</div>
        <div class="projeto-meta">O item ${esc(fav.itemId)} não está mais no catálogo.</div></div>
        <div class="direita">
          <button class="mini perigo" data-del-fav="${esc(fav.chave)}">remover</button>
        </div></div></div>`;
    }

    const prob = c.receita.prob != null && c.receita.prob < 100
      ? `<span class="pastilha caro" title="chance de sucesso por tentativa">${c.receita.prob}%</span>` : '';

    return `<div class="projeto" data-fav-card="${esc(fav.chave)}">
      <div class="projeto-topo">
        <img class="icone" src="${iconeDe(fav.itemId)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
        <div>
          <div class="projeto-titulo">${nomeHTML(c.it)} <span class="medas fraco">×${c.qtd}</span></div>
          <div class="projeto-meta">${esc(c.receita.nome)}${c.receita.npc ? ' · ' + esc(c.receita.npc) : ''}${c.receita.local ? ' · ' + esc(c.receita.local) : ''}</div>
        </div>
        <div class="direita">
          ${prob}
          <input class="qtd-input" type="number" min="1" step="1" value="${c.qtd}"
                 data-qtd-fav="${esc(fav.chave)}" title="unidades a produzir">
          <button class="mini perigo" data-del-fav="${esc(fav.chave)}">remover</button>
        </div>
      </div>
      ${tabelaIngredientes(c, fav.chave)}
      ${avisoParcial(c)}
      <div class="total">
        <span class="rotulo">Falta comprar</span>
        <span class="valor" title="${fmtCheio(c.total)}">${fmtMedas(c.total)}${c.semPreco.length ? '+' : ''}</span>
      </div>
    </div>`;
  }).join('');

  // o mesmo somatório em cima e embaixo: em cima para saber o tamanho do
  // investimento antes de rolar, embaixo para fechar a conta depois de ver tudo
  alvo.innerHTML = resumo + cards + resumo;
}

/** Soma o que falta comprar em todas as receitas da lista. */
function resumoLista(lista) {
  let total = 0;
  let receitas = 0;
  let prontas = 0;
  const semPreco = new Set();

  for (const fav of lista) {
    const c = calcular(fav);
    if (!c) continue;
    receitas++;
    total += c.total;
    c.semPreco.forEach((i) => semPreco.add(i.id));
    if (!c.linhas.some((l) => l.falta > 0)) prontas++;
  }

  const aviso = semPreco.size
    ? `<span class="aviso-sem-preco">${SINAL} ${semPreco.size} material(is) sem preço —
       o total é o mínimo, não o valor final</span>`
    : '';

  return `<div class="resumo-lista">
    <div class="resumo-info">
      <strong>${receitas}</strong> receita(s) na lista${prontas ? ` · <strong>${prontas}</strong> com tudo em mãos` : ''}
      ${aviso}
    </div>
    <div class="resumo-total">
      <span class="rotulo">Investimento total</span>
      <span class="valor" title="${fmtCheio(total)}">${fmtMedas(total)}${semPreco.size ? '+' : ''}</span>
    </div>
  </div>`;
}

function atualizarBadge() {
  const b = $('#badgeFav');
  b.textContent = LOCAL.favoritos.length || '';
  b.classList.toggle('tem', LOCAL.favoritos.length > 0);
}

/* ============================================== busca de item no modal */

function buscarCatalogo(termo) {
  const t = termo.trim().toLowerCase();
  let lista = Object.values(CATALOGO);
  if (t) lista = lista.filter((i) => [i.nome, i.tipo, i.subtipo].join(' ').toLowerCase().includes(t));
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, 60);
}

function renderResultados(caixa, lista, aoEscolher) {
  caixa.hidden = false;
  if (!lista.length) {
    caixa.innerHTML = `<div class="resultado"><div class="info">
      <div class="sub">Nada no catálogo local. Importe com
      <code>py importar.py --nome "…"</code></div></div></div>`;
    return;
  }
  caixa.innerHTML = lista.map((i) => `
    <div class="resultado" data-escolher="${i.id}">
      <img class="icone pequeno" src="${iconeDe(i.id)}" alt="" loading="lazy" onerror="${ICONE_FALHA}">
      <div class="info">
        ${nomeHTML(i)}
        <div class="sub">${esc(i.subtipo || i.tipo || '—')}${i.receitas?.length ? ` · ${i.receitas.length} receita(s)` : ''}</div>
      </div>
    </div>`).join('');

  $$('[data-escolher]', caixa).forEach((el) =>
    el.addEventListener('click', () => aoEscolher(el.dataset.escolher)));
}

/* ------------------------------------------------------- modal de preço */

let itemEscolhido = null;

function abrirModalPreco(idPre = null) {
  itemEscolhido = null;
  $('#buscaItem').value = '';
  $('#valorObs').value = '';
  $('#qtdObs').value = '1';
  $('#notaObs').value = '';
  $('#dataObs').value = hoje();
  $('#tipoObs').value = 'venda';
  $('#resultadosItem').hidden = true;
  $('#avaliacaoPreco').classList.add('oculto');

  if (idPre && item(idPre)) escolherItem(idPre);
  else mostrarBuscaItem();

  $('#modalPreco').classList.remove('oculto');
  (idPre ? $('#valorObs') : $('#buscaItem')).focus();
}

function mostrarBuscaItem() {
  $('#blocoBuscaItem').hidden = false;
  $('#blocoItemEscolhido').hidden = true;
}

function escolherItem(id) {
  const it = item(id);
  if (!it) return;
  itemEscolhido = String(id);
  $('#blocoBuscaItem').hidden = true;
  $('#blocoItemEscolhido').hidden = false;
  $('#escolhidoIcone').src = iconeDe(id);
  $('#escolhidoNome').className = 'item-nome r' + (it.raridade ?? 0);
  $('#escolhidoNome').textContent = it.nome;
  const s = stats(id);
  $('#escolhidoSub').textContent = (it.subtipo || it.tipo || '')
    + (s ? ` · ref. ${fmtMedas(s.ref)} (${s.n} obs.)` : ' · sem preço ainda');
  atualizarAvaliacao();
  $('#valorObs').focus();
}

/** Mostra na hora se o valor digitado está barato ou caro contra a mediana. */
function atualizarAvaliacao() {
  const caixa = $('#avaliacaoPreco');
  const v = parseMedas($('#valorObs').value);
  const q = Math.max(1, parseInt($('#qtdObs').value, 10) || 1);
  const s = itemEscolhido ? stats(itemEscolhido) : null;

  if (v == null || !itemEscolhido) { caixa.classList.add('oculto'); return; }

  const unit = v / q;
  caixa.classList.remove('oculto');
  if (!s) {
    caixa.innerHTML = `<span class="pastilha normal">1ª obs.</span>
      <span class="texto">Unitário <span class="medas">${fmtMedas(unit)}</span>
      (${fmtCheio(unit)}). Sem histórico para comparar ainda.</span>`;
    return;
  }
  const av = avaliar(unit, s.ref);
  caixa.innerHTML = `<span class="pastilha ${av.classe}">${av.txt} ${pctTxt(av.dif)}</span>
    <span class="texto">Unitário <span class="medas">${fmtMedas(unit)}</span>
    contra referência <span class="medas">${fmtMedas(s.ref)}</span>
    (faixa ${fmtMedas(s.min)}–${fmtMedas(s.max)}, ${s.n} obs.)</span>`;
}

function salvarObs() {
  if (!itemEscolhido) return alert('Escolha um item primeiro.');
  const v = parseMedas($('#valorObs').value);
  if (v == null || v <= 0) return alert('Valor inválido. Use 1.5kk, 500k ou 750.');
  const q = Math.max(1, parseInt($('#qtdObs').value, 10) || 1);

  (DADOS.obs[itemEscolhido] ||= []).push({
    id: uid(), v, q,
    d: $('#dataObs').value || hoje(),
    t: $('#tipoObs').value,
    n: $('#notaObs').value.trim(),
  });

  salvarDados();
  fecharModais();
  renderTudo();
}

function fecharModais() {
  $('#modalPreco').classList.add('oculto');
  $('#modalReceita').classList.add('oculto');
}

/* ------------------------------------------------------ exportar/importar */

function baixar(nome, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/javascript' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/** Baixa os dois arquivos: preços (para commitar) e lista (pessoal). */
function exportar() {
  // Sai como .js (e não .json) para poder ir direto em data/ e continuar
  // funcionando via file://, igual ao catálogo.
  baixar('precos.js',
    '// pwmarket — preços observados. Gerado pelo botão Exportar.\n'
    + `window.PW_PRECOS = ${JSON.stringify({ obs: DADOS.obs }, null, 1)};\n`);

  if (LOCAL.favoritos.length) {
    baixar('lista.js',
      '// pwmarket — sua lista de receitas. Não vai para o git.\n'
      + `window.PW_LISTA = ${JSON.stringify({ favoritos: LOCAL.favoritos }, null, 1)};\n`);
  }
}

function importar(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const t = String(leitor.result).trim();
      const cru = t.startsWith('{') ? t : t.match(/=\s*(\{[\s\S]*\})\s*;?\s*$/)?.[1];
      if (!cru) throw new Error('não reconheci o formato do arquivo');
      const d = JSON.parse(cru);
      // sanea antes de perguntar: o número mostrado é o que de fato vai entrar
      const obs = sanitizarObs(d.obs);
      const favs = sanitizarFavoritos(d.favoritos || d.projetos);
      const nObs = Object.keys(obs).length;
      if (!nObs && !favs.length) throw new Error('o arquivo não tem preços nem lista válidos');

      // aceita os dois arquivos, um de cada vez: só substitui o que o
      // arquivo realmente traz, senão importar a lista apagaria os preços
      const partes = [];
      if (nObs) partes.push(`${nObs} item(ns) com preço`);
      if (favs.length) partes.push(`${favs.length} receita(s) na lista`);
      if (!confirm(`Substituir ${partes.join(' e ')}?`)) return;

      if (nObs) { DADOS = { obs }; salvarDados(); }
      if (favs.length) { LOCAL = { favoritos: favs }; salvarLocal(); }
      renderTudo();
    } catch (e) {
      alert('Falha ao importar: ' + e.message);
    }
  };
  leitor.readAsText(arquivo);
}

/* -------------------------------------------------------------- navegação */

function irPara(nome) {
  $$('nav button').forEach((b) => b.classList.toggle('ativo', b.dataset.painel === nome));
  $$('.painel').forEach((p) => p.classList.toggle('ativo', p.id === 'painel-' + nome));
}

function atualizarRodape() {
  const nItens = Object.keys(CATALOGO).length;
  const nPrecos = Object.keys(DADOS.obs).filter((k) => DADOS.obs[k]?.length).length;
  const nObs = Object.values(DADOS.obs).reduce((s, l) => s + (l?.length || 0), 0);
  const nRec = todasReceitas().length;
  $('#rodapeCatalogo').textContent =
    `${nItens} itens · ${nRec} receitas · ${nPrecos} com preço · ${nObs} observações`;
}

function preencherSecoes() {
  const grupos = new Map();
  for (const x of todasReceitas()) grupos.set(x.secao, (grupos.get(x.secao) || 0) + 1);
  const sel = $('#secaoReceitas');
  for (const s of [...SECOES, 'Outros']) {
    if (!grupos.has(s)) continue;
    const o = document.createElement('option');
    o.value = s;
    o.textContent = `${s} (${grupos.get(s)})`;
    sel.appendChild(o);
  }
}

function renderTudo() {
  renderPrecos();
  renderReceitas();
  renderDrops();
  renderFav();
  atualizarRodape();
}

/* ------------------------------------------------------------------ eventos */

function ligar() {
  if (CONSULTA) {
    document.body.classList.add('consulta');
    if (publicado) $('#faixaConsulta').classList.remove('oculto');
  }

  $$('nav button').forEach((b) => b.addEventListener('click', () => irPara(b.dataset.painel)));

  $('#filtroPrecos').addEventListener('input', renderPrecos);
  $('#ordemPrecos').addEventListener('change', renderPrecos);
  $('#btnRegistrar').addEventListener('click', () => abrirModalPreco());

  $('#filtroReceitas').addEventListener('input', renderReceitas);
  $('#secaoReceitas').addEventListener('change', renderReceitas);
  $('#ordemReceitas').addEventListener('change', renderReceitas);

  $('#filtroDrops').addEventListener('input', renderDrops);
  $('#ordemDrops').addEventListener('change', renderDrops);

  $('#filtroFav').addEventListener('input', renderFav);
  $('#btnLimparFav').addEventListener('click', () => {
    if (!LOCAL.favoritos.length) return;
    if (!confirm(`Tirar todas as ${LOCAL.favoritos.length} receita(s) da sua lista? `
      + 'O que você marcou em Tenho se perde junto.')) return;
    LOCAL.favoritos = [];
    salvarLocal();
    renderReceitas();
    renderFav();
  });

  // modal
  $('#buscaItem').addEventListener('input', (e) =>
    renderResultados($('#resultadosItem'), buscarCatalogo(e.target.value), escolherItem));
  $('#buscaItem').addEventListener('focus', (e) =>
    renderResultados($('#resultadosItem'), buscarCatalogo(e.target.value), escolherItem));
  $('#btnTrocarItem').addEventListener('click', () => {
    itemEscolhido = null;
    mostrarBuscaItem();
    $('#avaliacaoPreco').classList.add('oculto');
    $('#buscaItem').focus();
  });
  $('#valorObs').addEventListener('input', atualizarAvaliacao);
  $('#qtdObs').addEventListener('input', atualizarAvaliacao);
  $('#btnSalvarObs').addEventListener('click', salvarObs);
  $('#valorObs').addEventListener('keydown', (e) => { if (e.key === 'Enter') salvarObs(); });
  $('#notaObs').addEventListener('keydown', (e) => { if (e.key === 'Enter') salvarObs(); });

  $$('[data-fechar]').forEach((b) => b.addEventListener('click', fecharModais));
  $$('.modal-fundo').forEach((f) =>
    f.addEventListener('click', (e) => { if (e.target === f) fecharModais(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModais(); });

  $('#btnGravar').addEventListener('click', (e) => { e.preventDefault(); enviarAoServidor(); });
  $('#btnExportar').addEventListener('click', (e) => { e.preventDefault(); exportar(); });
  $('#btnImportar').addEventListener('click', (e) => { e.preventDefault(); $('#arquivoImportar').click(); });
  $('#arquivoImportar').addEventListener('change', (e) => {
    if (e.target.files[0]) importar(e.target.files[0]);
    e.target.value = '';
  });

  $('#btnFavoritarPreview').addEventListener('click', confirmarPreview);

  // Delegação: as listas são reconstruídas a cada render.
  document.addEventListener('click', (e) => {
    // clique no cartão da receita abre o preview — menos quando foi na estrela,
    // que já tem ação própria
    const cartao = e.target.closest('[data-receita]');
    if (cartao && !e.target.closest('.estrela, [data-tag]')) {
      abrirPreviewReceita(cartao.dataset.receita);
      return;
    }

    const b = e.target.closest('button');
    if (!b) return;

    if (b.dataset.tag) {
      alternarTag(b.dataset.tag);
      return;
    }
    if (b.dataset.limparTags) {
      filtroTags.clear();
      renderReceitas();
      return;
    }
    if (b.dataset.dropGrupo) {
      const g = GRUPOS_DROP.find((x) => x.id === b.dataset.dropGrupo);
      const v = b.dataset.dropValor;
      if (g) {
        if (g.set.has(v)) g.set.delete(v);
        else g.set.add(v);
        renderDrops();
      }
      return;
    }
    if (b.dataset.limparModos) {
      GRUPOS_DROP.forEach((g) => g.set.clear());
      renderDrops();
      return;
    }
    if (b.dataset.expandir) {
      const id = b.dataset.expandir;
      if (fontesAbertas.has(id)) fontesAbertas.delete(id);
      else fontesAbertas.add(id);
      renderDrops();
      return;
    }
    if (b.dataset.abrirBloco) {
      const k = b.dataset.abrirBloco;
      if (blocosAbertos.has(k)) blocosAbertos.delete(k);
      else blocosAbertos.add(k);
      renderDrops();
      return;
    }

    if (b.dataset.fav) {
      alternarFavorito(b.dataset.fav);
      renderReceitas();
      renderFav();
    } else if (b.dataset.delFav) {
      alternarFavorito(b.dataset.delFav);
      renderReceitas();
      renderFav();
    } else if (b.dataset.expandir) {
      const id = b.dataset.expandir;
      expandidos.has(id) ? expandidos.delete(id) : expandidos.add(id);
      renderPrecos();
    } else if (b.dataset.addObs) {
      abrirModalPreco(b.dataset.addObs);
    } else if (b.dataset.delObs) {
      const id = b.dataset.delObs;
      DADOS.obs[id] = (DADOS.obs[id] || []).filter((o) => o.id !== b.dataset.obsId);
      if (!DADOS.obs[id].length) { delete DADOS.obs[id]; expandidos.delete(id); }
      salvarDados();
      renderTudo();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.tenho) {
      const f = LOCAL.favoritos.find((x) => x.chave === el.dataset.tenho);
      if (f) {
        (f.tenho ||= {})[el.dataset.ing] = Math.max(0, parseInt(el.value, 10) || 0);
        salvarLocal();
        renderFav();
      }
    } else if (el.dataset.qtdFav) {
      const f = LOCAL.favoritos.find((x) => x.chave === el.dataset.qtdFav);
      if (f) {
        f.qtd = Math.max(1, parseInt(el.value, 10) || 1);
        salvarLocal();
        renderFav();
      }
    }
  });
}

/* ---------------------------------------------------------------- início */

if (!window.PW_CATALOGO) {
  document.querySelector('main').innerHTML = `<div class="vazio">
    <strong>Catálogo não carregado</strong>
    Não encontrei <code>data/catalog.js</code>. Rode o importador primeiro:
    <div style="margin-top:12px"><code>py importar.py --nome "Pedra da Luz"</code></div></div>`;
} else {
  carregar();
  preencherSecoes();
  ligar();
  renderTudo();

  // Descobre o servidor depois de desenhar a tela — a página tem que subir
  // igual mesmo sem ele. Nada é gravado por conta própria aqui: a primeira
  // escrita só acontece na primeira alteração, ou no "Gravar agora".
  detectarServidor().then((s) => {
    if (!s || CONSULTA) return;
    SERVIDOR = s;
    document.body.classList.add('com-servidor');
    marcarSalvamento(`grava direto em ${s.arquivo}`, 'ok');
  });
}
