# pwmarket

Dashboard de preços e crafting para o **The PW Clássico**, servidor brasileiro de
Perfect World. Você anota o que vê nas lojinhas e no chat, e o painel te diz qual
é o preço normal de cada coisa — e quanto falta pra fechar um craft.

Os dados dos itens (nome, tipo, ícone, receitas) vêm do
[pwdatabase BR](https://www.pwdatabase.com/br/), importados sob demanda. Como o
foco é o Palácio do Crepúsculo, receitas que não usam material de dusk são
descartadas na importação — veja `IGNORAR_RECEITA_COM` no `importar.py`.

## Abrir

Dois modos, e a página é a mesma nos dois:

| | Como abrir | Onde os preços ficam |
|---|---|---|
| **Arquivo** | duplo-clique em `index.html` | localStorage; publicar exige **Exportar dados** |
| **Servidor** | `abrir.bat` (ou `py servidor.py`) | vão **direto para `data/precos.js`** |

> O catálogo é carregado via `<script src="data/catalog.js">` de propósito:
> `fetch()` de arquivo local é bloqueado por CORS em `file://`, um `<script>`
> não é. O `data/catalog.json` fica ao lado como fonte legível.

### Modo servidor — gravação automática

```powershell
py servidor.py          # abre http://127.0.0.1:8731 no navegador
py servidor.py --porta 8732 --sem-navegador
```

Uma página em `file://` **não pode escrever no disco** — proibição do navegador,
não escolha do projeto. Servindo daqui, ela ganha para onde mandar os dados, e
cada preço registrado cai em `data/precos.js` sozinho (agrupado a cada 600ms,
para 3 registros seguidos virarem uma escrita só). O rodapé mostra o estado, e
**Gravar agora** força a escrita — útil na primeira vez, para levar ao disco o
que já estava no localStorage.

Antes de sobrescrever, a versão anterior vai para `data/precos.bak.js` (fora do
git). Payload malformado é recusado com 400 sem tocar no arquivo bom.

O servidor escuta **apenas em 127.0.0.1**: ninguém na sua rede alcança. Ele só
grava `data/precos.js` — nenhuma outra rota escreve nada.

Publicar continua sendo `git commit` + `push`; o servidor tira só o trabalho de
exportar e mover o arquivo na mão.

## Importar itens do pwdatabase

O catálogo começa vazio e cresce conforme você usa. Só stdlib do Python — sem
venv, sem dependências.

```powershell
py importar.py --nome "Pedra da Luz"    # busca por nome
py importar.py --id 20320               # direto pelo id da URL do pwdatabase
py importar.py --subtipo 20442          # uma subcategoria inteira
py importar.py --tipo 20441             # um tipo inteiro
py importar.py --categoria 15           # uma categoria inteira
py importar.py --listar                 # o que já tem no catálogo
py importar.py --remover 20320
py importar.py --reicones               # rebaixa ícones que faltam
py importar.py --faxina                 # aplica IGNORAR_RECEITA_COM ao catálogo
```

`--faxina` remove as receitas fora do Crepúsculo de um catálogo já importado,
junto com os itens que só existiam para servir de ingrediente a elas. A regra
olha apenas os ingredientes *dessas* receitas, então material que você importou
de propósito nunca é apagado por engano.

Quando o nome não é exato, o script lista os candidatos com os ids para você
rodar de novo com `--id`.

Itens com receita puxam os ingredientes automaticamente — o cálculo de crafting
precisa deles. Use `--sem-ingredientes` para desligar.

Os ids saem da própria URL do pwdatabase:
`pwdatabase.com/br/items/20320` → `--id 20320`.

### Receitas de decomposição

No pwdatabase, "Item can be crafted" inclui receitas de **decomposição** — as
que destroem um equipamento e devolvem material. A Pedra Perfeita, por exemplo,
tem 120 receitas: uma para cada arma que pode ser desmanchada nela.

Por isso o importador **não** expande os ingredientes quando um item passa de 8
receitas — senão precificar uma gema arrastaria armadura de todo tipo para o
catálogo. Quando isso acontece ele avisa e diz o que fazer; nada é cortado em
silêncio. Para forçar, use `--max-receitas 120`.

O mesmo mecanismo explica as porcentagens estranhas: a receita
`Punho Azul Material de Troca` sai `☆Corações Elevados` em 0,30% das vezes e
`Branta Voadora` no resto. O número que aparece no projeto é a chance do item
que você escolheu, por tentativa.

### Sobre o scraping

- O `robots.txt` deles libera tudo fora de `/cgi-bin/` e pede
  `Crawl-delay: 1`. O importador respeita esse intervalo entre requisições,
  então importar uma categoria grande é lento de propósito.
- Os ícones são **baixados** para `data/icons/` em vez de linkados. Isso
  mantém a página funcionando offline, não consome banda deles a cada
  visita, e não quebra se eles mudarem de host.

## Registrar preços

**+ Registrar preço** → escolhe o item → valor e quantidade.

O campo de valor aceita atalhos: `1.5kk`, `1,5kk`, `500k`, `750`, `12.345`.
Sem sufixo, o ponto é separador de milhar (`1.500` = mil e quinhentos).

Informe o **valor total** e a **quantidade** do lote; o unitário é derivado.
Se alguém vende 10 Pedras por 500k, registre `500k` e `10` — o painel guarda
50k por unidade.

Enquanto você digita, ele já compara com o histórico e diz se está **barato**
ou **caro**, com a diferença percentual.

### Por que mediana e não média

O "Preço ref." de cada item é a **mediana** das observações. Uma loja pedindo
10× o valor normal não desloca a referência — é exatamente o tipo de anúncio
que aparece bastante e que arruinaria uma média.

A coluna **Faixa** mostra o mínimo e o máximo observados, então você continua
vendo os extremos.

## Receitas

Catálogo navegável de tudo que dá para produzir, em seções: **Armas**,
**Armaduras**, **Acessórios**, **Materiais** (e *Outros*, se aparecer algum tipo
novo). Um item com duas receitas aparece duas vezes — a escolha entre elas é
uma decisão de custo, não um detalhe.

A busca cobre **nome do item, nome da receita, forja, localização e os
ingredientes**. Então `símbolo do crepúsculo` lista tudo que consome esse
material, e `jóias` filtra pela forja. Vários termos funcionam como E:
`asura bota` acha só as receitas daquela peça.

Cada cartão mostra os ingredientes como fichas com quantidade (passe o mouse
para nome e subtotal) e o **custo estimado** a preço de referência. Um `+` no
custo quer dizer que falta preço de algum ingrediente, então o número é piso,
não total.

Clique na estrela **☆** para favoritar.

## Favoritos

As receitas que você marcou, cada uma com a tabela de planejamento: preencha
**Tenho** e ele calcula o que falta e quanto custa comprar o restante, pelo
preço de referência de cada ingrediente.

Quando algum ingrediente ainda não tem preço registrado, o total aparece
marcado como **parcial**, com a lista de quem está faltando. Um total
incompleto apresentado como final levaria a decisão errada, então ele nunca é
mostrado sem esse aviso.

Ingredientes que também têm receita aparecem marcados como **craftável** —
às vezes vale produzir em vez de comprar.

**Restaurar sugeridos** volta para a lista que o dono do painel publicou.

### De quem é cada dado

Isto importa para compartilhar:

| Dado | De quem | Modo consulta |
|---|---|---|
| Preços observados | do dono do painel | somente leitura |
| Favoritos e coluna **Tenho** | de quem está com a página aberta | **editáveis** |

Favorito é preferência de quem olha, não informação do jogo — travar isso em
modo consulta deixaria seus amigos sem conseguir planejar nada. Eles pesquisam,
favoritam e preenchem o estoque deles; fica tudo no navegador de cada um, e os
seus preços continuam intactos. Os dois vivem em chaves separadas
(`pwmarket.dados.v1` e `pwmarket.local.v1`).

## Publicar no GitHub Pages

Para publicar:

1. Garanta que `data/precos.js` está em dia — no **modo servidor** ele já está;
   no modo arquivo, **Exportar dados** e mova o download para `pwmarket/data/`.
2. Commite e dê push.

Com Pages habilitado no repo, o painel fica em
`scabini.github.io/pwfarm/pwmarket/`.

O `precos.js` leva os **preços** e os **favoritos sugeridos** — a lista inicial
que seus amigos vão ver na aba Favoritos.

**Modo consulta.** Em `github.io` a página abre com os preços em somente
leitura. Não é trava de segurança — é que ninguém consegue gravar no repo pelo
navegador, e deixar o botão de registrar preço ativo daria a impressão falsa de
que a alteração vale para todos. Pesquisar receitas, favoritar e preencher
**Tenho** continuam funcionando, porque são dados de quem está usando.

Para editar preços na versão publicada, use `?editar=1` na URL. Suas mudanças
ficam no seu navegador até você exportar e commitar de novo. Para simular o modo
consulta localmente, use `?consulta=1`.

**Importar dados** faz o caminho de volta — aceita tanto o `precos.js`
exportado quanto um `.json` cru.

## Arquivos

```
index.html        estrutura da página
style.css         tema preto + vermelho, cores de raridade do jogo
app.js            preços, estatísticas e cálculo de crafting
importar.py       CLI de importação
pwdb.py           cliente e parser do pwdatabase
data/
  catalog.json    catálogo (fonte legível, versionada)
  catalog.js      mesmo conteúdo para carregar via file://
  icons/<id>.png  ícones baixados
  precos.js       seus preços, quando você exporta para publicar
```

As cores dos nomes de item seguem as classes `item_colorN` do próprio
pwdatabase, então a raridade aparece igual ao jogo.

## Limites conhecidos

- Categorias grandes são paginadas no site; o importador traz a primeira
  página e avisa quando há mais itens do que ele pegou, em vez de truncar em
  silêncio.
- O crafting não expande receitas em cadeia: se um ingrediente é craftável,
  ele é marcado, mas o custo considerado é o de compra dele. Para os 10–20
  projetos que esse painel atende, um nível resolve.
- O parser depende do HTML do pwdatabase. Se eles mudarem o layout, o
  importador falha alto (`não achei o cabeçalho do item`) em vez de gravar
  dados vazios.
- O cálculo assume que a receita produz **1 unidade**. Algumas receitas têm
  `Amount crafted` maior (as de decomposição devolvem 2), o que faria o custo
  por unidade ser superestimado. Nenhuma receita do Palácio do Crepúsculo cai
  nesse caso.
- Ingredientes sem classe de raridade no HTML já entram normalmente — foi o
  caso da Essência do Crepúsculo, que aparece em toda receita do Palácio e
  antes era descartada em silêncio.
- **Variantes de material não são importadas.** Algumas receitas aceitam dois
  conjuntos de materiais, e a página do item só mostra o primeiro. O Colar das
  Mentiras (`recipe/1993`), por exemplo, também pode ser feito sem a Presa
  Prismática e sem Essência, gastando 120× Tábua Polida / Aço Temperado / Pó de
  Esmeril / Carvão de Pedra + 260× Ordem do Imperador. Só a página
  `/br/recipe/<id>` expõe o segundo conjunto. Suportar isso pede uma requisição
  extra por receita e um seletor de variante no projeto.
