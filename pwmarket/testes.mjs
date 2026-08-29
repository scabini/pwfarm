/* pwmarket — teste de fumaça do app.js.
 *
 *     node testes.mjs
 *
 * Não há navegador aqui: o app.js roda num DOM mínimo de mentira, com os dados
 * reais de data/. É pouco, mas pega a classe de erro que mais dói neste
 * projeto — uma exceção no meio de renderTudo(), que derruba em silêncio todos
 * os painéis desenhados DEPOIS do que quebrou. Foi assim que a aba Refino levou
 * a Minha lista junto: um `const` declarado depois do bootstrap (zona morta
 * temporal) fazia renderRefino() lançar, e renderFav() nunca rodava.
 *
 * Também mede o tempo de cada painel, porque a conta de refino é pesada e roda
 * dentro de renderTudo() — que é chamado a cada preço registrado.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/* ------------------------------------------------------------- DOM falso */

const html = ler('index.html');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const navBtns = [...html.matchAll(/<button data-painel="([^"]+)"/g)].map((m) => m[1]);
const paineis = [...html.matchAll(/<section class="painel[^"]*" id="painel-([^"]+)"/g)]
  .map((m) => m[1]);

// valor inicial de cada <select>: a primeira <option value="…">
const selects = {};
for (const m of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
  selects[m[1]] = (m[2].match(/<option value="([^"]*)"/) || [, ''])[1];
}

function elemento(id = '', tag = 'div') {
  return {
    id, tagName: tag.toUpperCase(), dataset: {}, style: {},
    value: selects[id] ?? '', textContent: '', innerHTML: '', hidden: false,
    checked: false, title: '', selected: false,
    options: [], children: [], ouvintes: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c, f) {
        if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (f) { this._s.add(c); } else { this._s.delete(c); }
      },
      contains(c) { return this._s.has(c); },
    },
    addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(f) {
      this.children.push(f);
      if (this.tagName === 'SELECT') {
        this.options.push(f);
        if (f.selected || this.options.length === 1) this.value = f.value;
      }
      return f;
    },
    setAttribute(k, v) { if (k === 'value') this.value = v; this[k] = v; },
    getAttribute(k) { return this[k] ?? null; },
    removeAttribute(k) { delete this[k]; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {}, click() {}, blur() {}, scrollIntoView() {}, remove() {},
    insertAdjacentHTML() {},
  };
}

const REG = new Map();
for (const id of ids) {
  const tag = selects[id] !== undefined ? 'select'
    : /^(filtro|busca|valor|qtd|nota|data|arquivo)/.test(id) ? 'input' : 'div';
  REG.set('#' + id, elemento(id, tag));
}
const NAV = navBtns.map((p) => {
  const b = elemento('', 'button');
  b.dataset.painel = p;
  return b;
});
const PAINEIS = paineis.map((p) => elemento('painel-' + p, 'section'));

function seletorTodos(sel) {
  if (sel === 'nav button') return NAV;
  if (sel === '.painel') return PAINEIS;
  if (REG.has(sel)) return [REG.get(sel)];
  return [];
}

const documento = {
  body: elemento('', 'body'),
  querySelector: (s) => REG.get(s) ?? seletorTodos(s)[0] ?? null,
  querySelectorAll: seletorTodos,
  createElement: (t) => elemento('', t),
  addEventListener() {},
  getElementById: (i) => REG.get('#' + i) ?? null,
};

const armazem = new Map();
const janela = {
  document: documento,
  localStorage: {
    getItem: (k) => (armazem.has(k) ? armazem.get(k) : null),
    setItem: (k, v) => armazem.set(k, String(v)),
    removeItem: (k) => armazem.delete(k),
  },
  location: { search: '', protocol: 'file:', hostname: 'localhost', href: 'file:///' },
  URLSearchParams, console, setTimeout, clearTimeout, JSON, Math, Date, Intl,
  alert: (m) => { throw new Error('alert() inesperado: ' + m); },
  confirm: () => true,
  fetch: () => Promise.reject(new Error('sem servidor no teste')),
  FileReader: class { readAsText() {} },
  Blob: class {},
  URL: { createObjectURL: () => '', revokeObjectURL() {} },
};
janela.window = janela;
janela.globalThis = janela;

/* --------------------------------------------------------------- execução */

const ctx = vm.createContext(janela);
const falhas = [];
const ok = (cond, msg) => { if (!cond) falhas.push(msg); return cond; };

const t0 = Date.now();
for (const arq of ['data/catalog.js', 'data/precos.js', 'data/lista.js']) {
  try { vm.runInContext(ler(arq), ctx, { filename: arq }); }
  catch (e) { falhas.push(arq + ' não carregou: ' + e.message); }
}
const tDados = Date.now() - t0;

const t1 = Date.now();
try {
  vm.runInContext(ler('app.js'), ctx, { filename: 'app.js' });
} catch (e) {
  falhas.push('app.js lançou durante a carga: ' + e.constructor.name + ': ' + e.message);
  console.error('\n  pilha: ' + String(e.stack).split('\n').slice(0, 4).join('\n         '));
}
const tApp = Date.now() - t1;

/* ---------------------------------------------------------------- asserts */

const risco = '-'.repeat(58);
console.log('\npwmarket — teste de fumaça\n' + risco);
console.log('dados em ' + tDados + ' ms · app.js subiu em ' + tApp + ' ms');

// 1. todo painel do HTML tem um container, e ele foi preenchido
const CONTAINERS = {
  precos: '#conteudoPrecos', receitas: '#conteudoReceitas', drops: '#conteudoDrops',
  refino: '#conteudoRefino', favoritos: '#conteudoFav',
};
console.log('\npainéis:');
for (const [nome, sel] of Object.entries(CONTAINERS)) {
  const el = REG.get(sel);
  const n = el ? el.innerHTML.length : -1;
  const bom = ok(n > 0, 'painel "' + nome + '" não renderizou nada (' + sel + ')');
  console.log('  ' + (bom ? 'ok  ' : 'FALHA ') + nome.padEnd(10)
    + (n > 0 ? n.toLocaleString('pt-BR') + ' chars' : 'VAZIO'));
}

// 2. o rodapé é escrito no fim de renderTudo(): se veio, nada lançou no meio
const rodape = REG.get('#rodapeCatalogo');
ok(rodape && /\d+ itens/.test(rodape.textContent),
  'o rodapé não foi escrito — renderTudo() não chegou ao fim');
console.log('\nrodapé: ' + (rodape?.textContent || '(vazio)'));

// 3. cada botão de nav tem painel e container correspondentes
for (const b of NAV) {
  ok(paineis.includes(b.dataset.painel),
    'nav "' + b.dataset.painel + '" sem <section> correspondente');
  ok(CONTAINERS[b.dataset.painel],
    'nav "' + b.dataset.painel + '" sem container mapeado no teste');
}

// 4. performance
const render = ctx.renderTudo;
const renderRefino = ctx.renderRefino;
if (typeof render === 'function') {
  const t = Date.now(); render(); const dt = Date.now() - t;
  console.log('\nrenderTudo() completo: ' + dt + ' ms');
  ok(dt < 1500, 'renderTudo() levou ' + dt + ' ms — acima do teto de 1500 ms');
} else {
  falhas.push('renderTudo não ficou acessível — app.js não chegou ao fim');
}
if (typeof renderRefino === 'function') {
  console.log('\nrefino por alvo (ms):');
  const sel = REG.get('#refAlvo');
  const tipo = REG.get('#refTipo');
  for (const t of ['armadura', 'arma']) {
    tipo.value = t;
    const tempos = [];
    for (let k = 1; k <= 12; k++) {
      sel.value = String(k);
      const ini = Date.now();
      renderRefino();
      const dt = Date.now() - ini;
      tempos.push(dt);
      ok(dt < 1000, 'refino ' + t + ' alvo +' + k + ' levou ' + dt + ' ms (teto 1000 ms)');
      ok(REG.get('#conteudoRefino').innerHTML.length > 0,
        'refino ' + t + ' alvo +' + k + ' não renderizou');
    }
    console.log('  ' + t.padEnd(9) + tempos.map((x, i) => '+' + (i + 1) + ':' + x).join(' '));
  }
}

// 5. a distribuição faz sentido, e o cache poupa o re-render
const { refDistribuicao, refPoliticaOtima: PO, refVisitas } = ctx;
if (typeof refDistribuicao === 'function') {
  const ACOES = ['I', 'C', 'M', 'T'];
  for (const [tipo, ni] of [['armadura', 1], ['arma', 2]]) {
    for (const alvo of [3, 6, 8, 10, 12]) {
      const custoDe = (a) => ni * 40e3 + { I: 0, C: 100e3, M: 100e3, T: 120e3 }[a];
      const { V, pol } = PO(alvo, custoDe, ACOES);
      const d = refDistribuicao(pol, alvo, custoDe);
      const onde = tipo + ' +' + alvo;
      const piso = pol.reduce((s, a) => s + custoDe(a), 0);
      ok(d.p10 >= piso, onde + ': p10 abaixo do piso da corrida perfeita');
      ok(d.p10 < d.mediana && d.mediana < d.p90, onde + ': quantis fora de ordem');
      ok(d.p10 < V[0] && V[0] < d.p90, onde + ': a média caiu fora do intervalo p10–p90');
      // num processo com reset a média fica acima da mediana, sempre
      ok(d.mediana < V[0], onde + ': mediana acima da média — distribuição não bate');
    }
  }
  console.log('\ndistribuição: quantis coerentes em 10 combinações');
}
if (typeof renderRefino === 'function') {
  REG.get('#refTipo').value = 'armadura';
  REG.get('#refAlvo').value = '12';
  const t1 = Date.now(); renderRefino(); const frio = Date.now() - t1;
  const t2 = Date.now(); renderRefino(); const quente = Date.now() - t2;
  ok(quente <= Math.max(20, frio / 4),
    'o cache não pegou: 1º render ' + frio + ' ms, 2º ' + quente + ' ms');
  console.log('cache do refino: 1º render ' + frio + ' ms, repetido ' + quente + ' ms');
}

// 6. a política ótima confere com força bruta?
//    refPoliticaOtima usa iteração de política, que é rápida mas só vale se
//    convergir mesmo para o mínimo global. Para alvos pequenos dá para testar
//    todas as 4^alvo políticas e comparar — inclusive com preços torcidos, que
//    é onde um algoritmo guloso escorregaria.
const { refPoliticaOtima, refAvaliar } = ctx;
if (typeof refPoliticaOtima === 'function') {
  const ACOES = ['I', 'C', 'M', 'T'];
  const CENARIOS = [
    { nome: 'preços do servidor', ni: 1, p: { I: 0, C: 100e3, M: 100e3, T: 120e3 }, imortal: 40e3 },
    { nome: 'arma, mesmos preços', ni: 2, p: { I: 0, C: 100e3, M: 100e3, T: 120e3 }, imortal: 40e3 },
    { nome: 'Céu e da Terra barata', ni: 1, p: { I: 0, C: 300e3, M: 300e3, T: 5e3 }, imortal: 40e3 },
    { nome: 'Maligna cara', ni: 1, p: { I: 0, C: 20e3, M: 900e3, T: 400e3 }, imortal: 10e3 },
    { nome: 'Imortal cara', ni: 2, p: { I: 0, C: 5e3, M: 6e3, T: 7e3 }, imortal: 900e3 },
  ];
  let checados = 0;
  for (const c of CENARIOS) {
    const custoDe = (a) => c.ni * c.imortal + c.p[a];
    for (let alvo = 1; alvo <= 6; alvo++) {
      let melhorForca = Infinity;
      const total = 4 ** alvo;
      for (let m = 0; m < total; m++) {
        const pol = [];
        for (let k = 0, x = m; k < alvo; k++, x = Math.floor(x / 4)) pol.push(ACOES[x % 4]);
        const V = refAvaliar(pol, alvo, custoDe);
        if (V && isFinite(V[0]) && V[0] > 0 && V[0] < melhorForca) melhorForca = V[0];
      }
      const o = refPoliticaOtima(alvo, custoDe, ACOES);
      const dif = Math.abs(o.V[0] - melhorForca) / melhorForca;
      ok(dif < 1e-6,
        'política ótima diverge da força bruta em "' + c.nome + '" alvo +' + alvo
        + ': ' + Math.round(o.V[0]) + ' vs ' + Math.round(melhorForca));
      checados++;
    }
  }
  console.log('\npolítica ótima vs força bruta: ' + checados + ' combinações conferidas');
}

// 7. `node testes.mjs --refino [alvo]` despeja o painel em texto, para
//    conferir os números sem abrir o navegador
if (process.argv.includes('--refino')) {
  const alvo = process.argv[process.argv.indexOf('--refino') + 1] || '8';
  const texto = (h) => h.replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·').replace(/&times;/g, 'x').replace(/&rarr;/g, '->')
    .replace(/&mdash;/g, '—').replace(/&#9733;/g, '*').replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  for (const t of ['armadura', 'arma']) {
    REG.get('#refTipo').value = t;
    REG.get('#refAlvo').value = alvo;
    renderRefino();
    console.log('\n' + risco + '\n' + t + ' — alvo +' + alvo + '\n' + risco);
    console.log(texto(REG.get('#conteudoRefino').innerHTML));
  }
}

/* ----------------------------------------------------------------- saída */

console.log('\n' + risco);
if (falhas.length) {
  console.log(falhas.length + ' FALHA(S):');
  falhas.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('tudo certo.');
