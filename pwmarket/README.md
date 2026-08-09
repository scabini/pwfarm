# pwmarket

Dashboard de preços e crafting para o **The PW Clássico**, servidor brasileiro de
Perfect World. Você anota o que vê nas lojinhas e no chat, e o painel te diz qual
é o preço normal de cada coisa — e quanto falta pra fechar um craft.

Os dados dos itens (nome, tipo, ícone, receitas) vêm do
[pwdatabase BR](https://www.pwdatabase.com/br/), importados sob demanda. O foco é
o **Palácio do Crepúsculo** e o **Vale da Lua**; receitas que trocam a peça por
item de loja e equipamentos de classes que o servidor não tem (adagas e orbes)
são descartados na importação — veja `IGNORAR_RECEITA_COM` e `IGNORAR_SUBTIPO`
no `importar.py`.

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
tudo cai em disco sozinho: os preços em `data/precos.js` e a sua lista em
`data/lista.js` (agrupado a cada 600ms, para 3 registros seguidos virarem uma
escrita só). O rodapé mostra o estado, e **Gravar agora** força a escrita — útil
na primeira vez, para levar ao disco o que já estava no localStorage.

Antes de sobrescrever, a versão anterior vai para `data/precos.bak.js` (fora do
git). Payload malformado é recusado com 400 sem tocar no arquivo bom.

O servidor escuta **apenas em 127.0.0.1**: ninguém na sua rede alcança. Ele só
grava esses dois arquivos — nenhuma outra rota escreve nada.

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
py importar.py --redrops                # rebusca a tabela de drop dos materiais
py importar.py --versionar              # recarimba ?v= nos assets do index.html
py importar.py --faxina                 # aplica IGNORAR_RECEITA_COM ao catálogo
```

`--faxina` aplica as duas regras de exclusão a um catálogo já importado: tira as
receitas que trocam a peça por item de loja, os itens que só existiam para servir
de ingrediente a elas, e os equipamentos de adagas e orbes. A regra dos órfãos
olha apenas os ingredientes *dessas* receitas, então material que você importou
de propósito nunca é apagado por engano.

### Diferenças do The PW Clássico

O servidor é uma versão clássica customizada, então alguns itens têm outro nome
em relação ao pwdatabase. Essas diferenças ficam em **`data/ajustes.json`**:

```json
{ "nomes": { "15307": "Pedra da Terra do Sonho" } }
```

O mesmo arquivo tem `sem_receitas`: itens que continuam no catálogo, porque são
ingredientes que você quer precificar, mas cujas receitas somem. São as caixas de
evento e loteria — a "Joia Misteriosa" sozinha traz 15 receitas apontando para
cupons e chaves de GM, que nunca entrariam no catálogo. Os três itens laranja
(*Máscara Dourada*, *Cetro do Crepúsculo*, *Espírito do Céu e da Terra*) estão
aí pelo mesmo motivo: só saíam de "Muita Sorte - Perfect World", que este
servidor não tem.

O `importar.py` aplica os dois toda vez que salva o catálogo, então os ajustes
sobrevivem a reimportações. O nome é trocado no item **e** em todas as receitas
que o usam como ingrediente — se ficassem diferentes, a busca por ingrediente na
aba Receitas encontraria o nome antigo.

Depois de editar o arquivo, rode `py importar.py --ajustes`.

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

### Cache: por que os assets têm `?v=`

O GitHub Pages serve com `Cache-Control: max-age=600` e não revalida dentro da
janela. Como o `index.html` é o documento navegado, ele costuma vir novo
enquanto o `app.js` ainda vem do cache — e essa mistura é a pior possível: a aba
nova aparece no HTML e fica **em branco**, porque o código que a desenha não
chegou. Nenhum erro no console, nada quebrado no servidor; só duas versões
conversando.

Por isso `style.css`, `app.js` e `data/catalog.js` são carregados com um
`?v=<hash do conteúdo>`. Mudou o arquivo, mudou a URL, e o navegador não tem
como servir a anterior. O `salvar()` do importador recarimba sozinho quando o
catálogo muda; **depois de mexer no `app.js` ou no `style.css`, rode
`py importar.py --versionar` antes de commitar**.

`precos.js` e `lista.js` ficam de fora de propósito: mudam a cada preço anotado,
e preço com 10 minutos de atraso não quebra nada.

No **modo servidor** o problema não existe — o `servidor.py` responde tudo com
`Cache-Control: no-store`, porque servidor local existe para editar e recarregar.

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

A busca cobre **nome do item, nome da receita, forja, localização, tags e os
ingredientes**. Então `símbolo do crepúsculo` lista tudo que consome esse
material, e `jóias` filtra pela forja. Vários termos funcionam como E:
`asura bota` acha só as receitas daquela peça.

### Filtros por tag

Ninguém procura por "Armaduras / Corpo / Armadura Pesada" — procura por *dusk
99 dourado* e *set pesado dusk*. A barra de filtros tem quatro grupos de botões
que falam essa língua:

| Grupo | Botões |
| --- | --- |
| **Conteúdo** | Dusk · Vale da Lua |
| **Nível** | 90 · 95 · 99 |
| **Cor** | Dourado · Verde · Roxo (na cor que o nome tem no jogo) |
| **Set** | Pesado · Leve · Místico |

Dentro do grupo é **ou**, entre grupos é **e**: *Dourado + Verde* alarga a
busca, *Dourado + Dusk* aperta. Cada botão traz **quanto ele daria** com o que
já está marcado, então não dá para clicar e cair em zero — e botão que zerou
desaparece da barra (é o que acontece hoje com *Laranja*, sem receita nenhuma
neste servidor). As mesmas tags aparecem em cada cartão, clicáveis: é o caminho
curto para "quero mais disso".

As tags também entram na busca por texto, então `dusk dourado 99` digitado dá o
mesmo resultado que os três botões — a palavra "dusk" não existe em campo nenhum
do pwdatabase.

Nada disso é campo importado: as tags são **derivadas** do catálogo. Conteúdo
sai da zona da forja e, nos materiais, de quem os consome — a *Pedra da Terra do
Sonho* é forjada num NPC solto no mapa e só é "dusk" porque o peito dusk 99 a
usa. Material que serve às duas zonas fica com as duas tags, que é a resposta
certa: quem for atrás de arma do Vale da Lua também precisa do *Destino do
Crepúsculo*. O set vem do **nome da receita** ("Bota Pesada Dourada V. da Lua"),
não do subtipo: o pwdatabase tem só dois subtipos de capacete para três classes,
e erra o do set leve.

Cada cartão mostra os ingredientes como fichas com quantidade (passe o mouse
para nome e subtotal) e o **custo estimado** a preço de referência.

Material sem preço registrado ganha um **!** vermelho na ficha, e o custo vem
com `+` seguido de *Há materiais sem preço registrado*. O `+` sozinho diria que
o número está incompleto sem dizer por quê.

**Clique no cartão** para ver a receita inteira como ela vai aparecer na sua
lista, com a tabela de ingredientes e o custo. A coluna *Tenho* aparece travada
nessa prévia — ela só passa a valer depois que a receita entra na sua lista, e o
botão do rodapé faz isso e já te leva para lá.

A estrela **☆** no canto do cartão adiciona direto, sem abrir a prévia.

## Drops

De onde cada material sai. É a pergunta inversa da aba Receitas: em vez de "o
que preciso para esta peça", responde **"o que farmo, e onde"**.

Um cartão por material, com todos os chefes que o largam, o modo e a chance.
Os botões filtram por modo (**Dusk 1-1** … **Dusk 3-3**, **Vale da Lua**) e a
busca cobre nome do material e nome do chefe — `cang li` lista tudo que ele
solta. O cartão ainda diz em quantas receitas o material entra e o preço de
referência, que é o que decide entre farmar e comprar.

A mesma informação aparece onde você já está olhando: no **tooltip da ficha do
ingrediente** na aba Receitas, e como linha curta na **tabela de ingredientes**,
no lugar onde antes só dizia *craftável* — um material que dropa **e** é
craftável mostra os dois, porque são dois caminhos de verdade.

Buscar por chefe também funciona na aba Receitas: `cang li` lá lista as receitas
que dependem de algo que ele larga.

### De onde vem, e o que confiar

A tabela é o `Drop from` do pwdatabase, podada na importação: só as duas zonas
que o painel cobre, e um chefe por sala (o pwdatabase lista uma linha por *mob*,
e o "Deus Tambor" tem três ids com vidas diferentes na mesma sala — para quem
farma é um chefe só).

**As taxas são do banco oficial do jogo, não do The PW Clássico.** Servidor
privado mexe em drop rate. O nome do chefe é o dado firme; a porcentagem é
referência, e o painel avisa isso onde a mostra.

### O modo (3-3) não vem pronto

O pwdatabase dá a zona, a coordenada e um número de sala — e é só isso. A sala
separa os modos (o mesmo chefe aparece em salas diferentes, com mais vida no
modo difícil), mas não recebe nome.

O de-para saiu do nível dos equipamentos que os materiais de cada sala servem,
seguindo a regra do jogo (1-x = 60/70/80, 2-x = 70/80/90, 3-x = 90/99), e a
ordem dentro do tier, de quanto item alto cada sala larga. A sala 5 é a que mais
dropa material de 99 e é onde fica o **Rei Cang Li** — bate com o 3-3.

O resultado está em `data/ajustes.json`, em `salas`:

```json
"salas": { "5": "Dusk 3-3", "3": "Dusk 3-2", "4": "Dusk 3-1" }
```

Errou alguma? Corrija a linha e rode `py importar.py --ajustes`. Nada disso está
no código, e sala sem rótulo cai em "Palácio do Crepúsculo (sala 31)" em vez de
sumir. As salas 1-x são as menos certas — elas servem equipamento lv60-80, que
este catálogo nem cobre: só 2 dos 53 ingredientes de dusk vêm de lá.

## Minha lista

As receitas que você adicionou, cada uma com a tabela de planejamento: preencha
**Tenho** e ele calcula o que falta e quanto custa comprar o restante, pelo
preço de referência de cada ingrediente.

Quando algum ingrediente ainda não tem preço registrado, o total aparece
marcado como **parcial**, com a lista de quem está faltando. Um total
incompleto apresentado como final levaria a decisão errada, então ele nunca é
mostrado sem esse aviso.

Ingredientes que também têm receita aparecem marcados como **craftável** —
às vezes vale produzir em vez de comprar.

No topo e no fim da lista aparece o **investimento total**: a soma do que falta
comprar em todas as receitas. Se algum material ainda não tem preço, o total vem
com `+` e o aviso de que é o mínimo.

### De quem é cada dado

Isto importa para compartilhar:

| Dado | Arquivo | Vai para o git? | Modo consulta |
|---|---|---|---|
| Preços observados | `data/precos.js` | **sim** | somente leitura |
| Minha lista e **Tenho** | `data/lista.js` | **não** (`.gitignore`) | editáveis |

Os dois são arquivos separados porque têm donos diferentes. O preço é publicado
para todo mundo; a lista é de quem está usando a máquina.

**Quem visita sempre começa com a lista vazia** — e isso não depende de nenhuma
regra no código: o `data/lista.js` simplesmente não existe no repositório, logo
não existe no site publicado. Cada visitante monta a dele, que fica no navegador
dele (`pwmarket.local.v1`), sem encostar nos seus preços (`pwmarket.dados.v1`).

A lista é escolha de quem olha, não informação do jogo — travar isso em modo
consulta deixaria seus amigos sem conseguir planejar nada.

## Publicar no GitHub Pages

Para publicar:

1. Garanta que `data/precos.js` está em dia — no **modo servidor** ele já está;
   no modo arquivo, **Exportar dados** e mova o download para `pwmarket/data/`.
2. Commite e dê push. O `data/lista.js` não entra: ele está no `.gitignore`.

Com Pages habilitado no repo, o painel fica em
`scabini.github.io/pwfarm/pwmarket/`.

O `precos.js` leva os **preços**. A lista de receitas vai junto apenas como
backup de quem edita — quem visita começa sempre com a lista vazia.

**Modo consulta.** Em `github.io` a página abre com os preços em somente
leitura. Não é trava de segurança — é que ninguém consegue gravar no repo pelo
navegador, e deixar o botão de registrar preço ativo daria a impressão falsa de
que a alteração vale para todos. Pesquisar receitas, montar a lista e preencher
**Tenho** continuam funcionando, porque são dados de quem está usando.

Para editar preços na versão publicada, use `?editar=1` na URL. O que for
anotado assim fica **só na cópia local de quem anotou** — mais ninguém vê, e o
painel publicado não muda. Para simular o modo consulta localmente, use
`?consulta=1`.

**Exportar dados** baixa os dois arquivos separados. **Importar dados** faz o
caminho de volta e aceita um de cada vez: mandar só o `lista.js` não apaga os
preços, e vice-versa.

## Arquivos

```
index.html        estrutura da página
style.css         tema preto + vermelho, cores de raridade do jogo
app.js            preços, estatísticas e cálculo de crafting
importar.py       CLI de importação
pwdb.py           cliente e parser do pwdatabase
servidor.py       servidor local que grava os preços em disco
abrir.bat         sobe o servidor e abre o navegador
data/
  catalog.json    catálogo (fonte legível, versionada)
  catalog.js      mesmo conteúdo para carregar via file://
  ajustes.json    nomes, receitas removidas e rótulo das salas do The PW Clássico
  icons/<id>.png  ícones baixados
  precos.js       preços — este é o arquivo que você commita
  lista.js        sua lista de receitas — fica fora do git
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
