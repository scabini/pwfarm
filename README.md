# pwfarm

Ferramentas para Perfect World, feitas para o servidor brasileiro
**The PW Clássico**.

## 🔗 [Abrir o pwmarket](https://scabini.github.io/pwfarm/pwmarket/)

Painel de preços de mercado e planejamento de crafting do **Palácio do
Crepúsculo**.

- **Preços em medas** observados nas lojinhas e no chat, com o valor de
  referência de cada material e a faixa em que ele costuma aparecer.
- **Receitas** de armas, armaduras e acessórios de dusk, com busca por item,
  forja ou ingrediente — dá para descobrir tudo que consome um material.
- **Minha lista**: escolha o que quer produzir, marque o que já tem, e veja
  quanto ainda falta comprar.

A página funciona sem cadastro. Os preços são publicados por quem mantém o
painel; a sua lista e o que você marca em *Tenho* ficam guardados no seu próprio
navegador e não são vistos por mais ninguém.

## As outras ferramentas

Rodam localmente no Windows, cada uma com seu próprio venv. Não são páginas web.

| | |
|---|---|
| [autoclicker](autoclicker/) | Auto clicker configurado por JSON, com F12 como tecla de pânico |
| [keypress_macro](keypress_macro/) | Macros de teclado por JSON: sequências, chords, hold e loop |
| [launcher](launcher/) | Interface em Tkinter que encontra e roda as automações acima |

## Rodar o painel na sua máquina

```powershell
git clone https://github.com/scabini/pwfarm.git
cd pwfarm/pwmarket
py servidor.py
```

Ou abra `pwmarket/index.html` direto no navegador — funciona sem servidor
nenhum, só sem gravar os preços em disco.

Detalhes de uso e de como importar itens novos:
[pwmarket/README.md](pwmarket/README.md).

## Créditos

Nomes, ícones e receitas dos itens vêm do
[pwdatabase](https://www.pwdatabase.com/br/), importados sob demanda e
respeitando o `Crawl-delay` do site. Perfect World é da Beijing Perfect World.
