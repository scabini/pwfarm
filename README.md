# pwfarm

Automações e painéis para Perfect World — servidor brasileiro **The PW Clássico**.

| Projeto | O que é |
|---|---|
| [pwmarket](pwmarket/) | Painel web de preços em medas e planejamento de crafting do Palácio do Crepúsculo |
| [autoclicker](autoclicker/) | Auto clicker por JSON, com hotkey de pânico F12 |
| [keypress_macro](keypress_macro/) | Macros de teclado por JSON: sequências, chords, hold e loop |
| [launcher](launcher/) | UI em Tkinter que descobre e roda as automações acima |

As três automações rodam localmente e cada uma tem seu próprio venv. O
`pwmarket` é a única parte que vira página web.

## Publicar o painel no GitHub Pages

O repositório já está pronto para isso: há um `index.html` na raiz que aponta
para o painel, e um `.nojekyll` para o Pages servir os arquivos crus em vez de
passar tudo pelo Jekyll.

Falta só ligar, e são dois passos no site do GitHub:

**1. O repositório precisa ser público.** Pages em repositório privado exige
GitHub Pro/Team. Em *Settings → General → Danger Zone → Change visibility*.

**2. Ligar o Pages.** Em *Settings → Pages*:

- **Source:** `Deploy from a branch`
- **Branch:** `main`, pasta `/ (root)`
- **Save**

Em um ou dois minutos:

- `https://scabini.github.io/pwfarm/` — a capa
- `https://scabini.github.io/pwfarm/pwmarket/` — o painel

Depois disso, todo `git push` na `main` republica sozinho.

### Antes de tornar público

Duas coisas que ficam visíveis e costumam passar despercebidas:

- **O histórico do git inteiro**, não só o estado atual. Hoje são poucos commits
  e não há segredo em nenhum deles.
- **O e-mail dos commits.** Os atuais estão com um endereço corporativo. Para os
  próximos usarem o endereço privado do GitHub:

  ```powershell
  git config user.email "SEU_ID+SEU_USUARIO@users.noreply.github.com"
  ```

  (o número aparece em *Settings → Emails* no GitHub). Isso vale só daqui pra
  frente; reescrever os commits antigos é possível, mas muda os hashes.

### Como o painel se comporta publicado

Ele detecta `github.io` e entra em **modo consulta**: os preços ficam somente
leitura, porque ninguém consegue gravar no repositório pelo navegador. Quem
abrir continua podendo pesquisar receitas, favoritar e preencher a coluna
*Tenho* — isso é de cada visitante e fica no navegador de cada um.

Para editar preços na versão publicada, use `?editar=1` na URL.

Detalhes de uso, importação de itens e do servidor local: [pwmarket/README.md](pwmarket/README.md).
