"""Importa itens do pwdatabase para o catálogo local do pwmarket.

O catálogo é sob demanda: você importa só os itens que vai usar, e ele cresce
junto com o seu uso. Cada importação também baixa o ícone para `data/icons/`,
então o dashboard funciona offline e não faz hotlink na banda do pwdatabase.

Uso:
    py importar.py --nome "Pedra da Luz"       # busca por nome
    py importar.py --id 20320                  # direto pelo id
    py importar.py --subtipo 20442             # uma subcategoria inteira
    py importar.py --tipo 20441                # um tipo inteiro
    py importar.py --categoria 15              # uma categoria inteira (key/)
    py importar.py --listar                    # o que já está no catálogo
    py importar.py --remover 20320

Ao importar um item que tem receita, os ingredientes entram no catálogo
automaticamente (o dashboard precisa deles para o cálculo de crafting).
Use --sem-ingredientes para desligar.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import pwdb

RAIZ = Path(__file__).parent
CATALOGO = RAIZ / "data" / "catalog.json"
CATALOGO_JS = RAIZ / "data" / "catalog.js"
AJUSTES = RAIZ / "data" / "ajustes.json"
ICONES = RAIZ / "data" / "icons"

# Materiais costumam ter dezenas de receitas de *decomposição* — a Pedra
# Perfeita, por exemplo, sai de 120 armas diferentes. Expandir os ingredientes
# de todas encheria o catálogo de coisa que você nunca vai precificar, então
# acima desse limite a expansão para e o script avisa.
LIMITE_RECEITAS = 8
LIMITE_INGREDIENTES = 25

# Receitas descartadas na importação: as do Comerciante Nosta trocam a peça por
# "Alma da Batalha" (item de loja/evento) em vez de material do Palácio do
# Crepúsculo. Como este painel existe para planejar craft de dusk, elas só
# poluiriam a aba Receitas com um caminho que não passa por material nenhum.
IGNORAR_RECEITA_COM = ("Alma da Batalha",)

# Armas de classes que não existem no The PW Clássico. Ninguém no servidor
# consegue equipar, então na busca só atrapalhariam.
IGNORAR_SUBTIPO = ("Adagas", "Orbe")

# De onde vale a pena guardar drop. A tabela do pwdatabase traz o mundo
# inteiro — a União da Alma cai de 26 mobs de campo aberto, e isso não ajuda
# ninguém a planejar. Só as duas zonas que o painel cobre entram.
ZONAS_DROP = ("Crepúsculo", "Vale da Lua")


# --------------------------------------------------------------------------
# catálogo
# --------------------------------------------------------------------------


def carregar() -> dict:
    if CATALOGO.exists():
        with CATALOGO.open(encoding="utf-8") as f:
            return json.load(f)
    return {"versao": 1, "atualizado": None, "itens": {}}


def filtrar_drops(drops: list[dict], zonas: dict | None = None) -> list[dict]:
    """Reduz a tabela de drop ao que serve para planejar farm.

    Duas podas. A primeira é de zona: fora do Palácio do Crepúsculo e do Vale
    da Lua o painel não cobre o conteúdo. A segunda é do mesmo chefe repetido —
    o pwdatabase lista uma linha por *mob*, e o "Deus Tambor" tem três ids com
    vidas diferentes na mesma sala. Para quem vai farmar é um chefe só, então
    fica a linha de maior chance.

    Sobram três campos por linha. `mob` e `nivel` ninguém usa, e `zona` sai do
    número da sala — guardá-la em toda linha custaria 18 KB no catalog.js para
    repetir 16 valores. O de-para vai em `zonas`, preenchido aqui.
    """
    melhor: dict[tuple[str, str | None], dict] = {}
    for d in drops:
        zona = d.get("zona") or ""
        if not any(z in zona for z in ZONAS_DROP):
            continue
        if zonas is not None and d.get("sala"):
            zonas[str(d["sala"])] = zona
        chave = (d.get("nome") or "", d.get("sala"))
        if chave not in melhor or d.get("pct", 0) > melhor[chave].get("pct", 0):
            melhor[chave] = d
    ordenado = sorted(melhor.values(), key=lambda d: (-d.get("pct", 0), d.get("nome") or ""))
    return [{"nome": d.get("nome"), "sala": d.get("sala"), "pct": d.get("pct")}
            for d in ordenado]


def aplicar_ajustes(cat: dict) -> int:
    """Sobrepõe as diferenças do The PW Clássico em cima do que veio do pwdatabase.

    O servidor é uma versão clássica customizada, então alguns itens têm outro
    nome. O nome aparece em dois lugares — no item e repetido em cada receita
    que o usa como ingrediente — e os dois precisam bater, senão a busca por
    ingrediente na aba Receitas encontra o nome antigo.
    """
    if not AJUSTES.exists():
        return 0
    try:
        with AJUSTES.open(encoding="utf-8") as f:
            cfg = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  ! ajustes.json ignorado: {e}")
        return 0

    nomes = cfg.get("nomes") or {}
    sem_receitas = set(cfg.get("sem_receitas") or {})

    # Os rótulos de sala viajam junto com o catálogo em vez de ficarem no
    # app.js: assim renomear "Dusk 3-3" é editar um JSON e rodar --ajustes,
    # sem mexer em código nem reimportar item nenhum.
    salas = {str(k): v for k, v in (cfg.get("salas") or {}).items()}
    if cat.get("salas") != salas:
        cat["salas"] = salas

    trocas = 0
    for iid, novo in nomes.items():
        item = cat["itens"].get(str(iid))
        if item and item.get("nome") != novo:
            item["nome"] = novo
            trocas += 1

    for iid, item in cat["itens"].items():
        # caixas de evento e loteria: o item fica (é ingrediente e dá para
        # precificar), a receita sai — ela aponta para cupom e chave de GM
        if iid in sem_receitas and item.get("receitas"):
            trocas += len(item["receitas"])
            item["receitas"] = []
            continue
        # e as cópias do nome dentro das receitas
        for receita in item.get("receitas") or []:
            for ing in receita.get("ingredientes") or []:
                novo = nomes.get(str(ing["id"]))
                if novo and ing.get("nome") != novo:
                    ing["nome"] = novo
                    trocas += 1
    return trocas


def salvar(cat: dict) -> None:
    aplicar_ajustes(cat)
    cat["atualizado"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    CATALOGO.parent.mkdir(parents=True, exist_ok=True)
    with CATALOGO.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(cat, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")

    # Espelho em .js porque `fetch()` de arquivo local é bloqueado por CORS
    # quando a página abre via file:// — um <script src> não é. É isso que
    # deixa o dashboard funcionar com duplo-clique e no GitHub Pages sem mudar
    # nada. O .json fica como fonte legível/diffável.
    compacto = json.dumps(cat, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    with CATALOGO_JS.open("w", encoding="utf-8", newline="\n") as f:
        f.write("// gerado por importar.py — não edite à mão\n")
        f.write(f"window.PW_CATALOGO = {compacto};\n")


def baixar_icone(item_id: int, forcar: bool = False) -> bool:
    destino = ICONES / f"{item_id}.png"
    if destino.exists() and not forcar:
        return False
    try:
        dados = pwdb.fetch_icon(item_id)
    except pwdb.PwdbError as e:
        print(f"  ! ícone de {item_id} falhou: {e}")
        return False
    ICONES.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(dados)
    return True


# --------------------------------------------------------------------------
# importação
# --------------------------------------------------------------------------


def receita_ignorada(receita: dict) -> bool:
    """A receita usa algum ingrediente da lista de exclusão?"""
    nomes = [(ing.get("nome") or "").lower() for ing in receita.get("ingredientes") or []]
    return any(termo.lower() in nome for nome in nomes for termo in IGNORAR_RECEITA_COM)


def item_ignorado(item: dict) -> bool:
    """É equipamento de uma classe que o servidor não tem?

    Compara por segmento do subtipo ("Adagas / Adagas", "Orbe / Orbe") e não por
    substring solta, senão um material com "orbe" no nome cairia junto.
    """
    partes = [p.strip().lower() for p in (item.get("subtipo") or "").split("/")]
    partes.append((item.get("tipo") or "").strip().lower())
    return any(p == termo.lower() for p in partes for termo in IGNORAR_SUBTIPO)


def importar_item(cat: dict, item_id: int, com_ingredientes: bool = True) -> int:
    """Importa um item (e, por padrão, os ingredientes das receitas dele).

    Retorna quantos itens novos entraram no catálogo.
    """
    chave = str(item_id)
    if chave in cat["itens"]:
        print(f"  = {item_id} {cat['itens'][chave]['nome']} (já no catálogo)")
        return 0

    try:
        item = pwdb.get_item(item_id)
    except pwdb.PwdbError as e:
        print(f"  ! {item_id}: {e}")
        return 0

    registro = item.to_dict()
    if item_ignorado(registro):
        print(f"  ~ {item.id} {item.nome} — {item.subtipo}: classe fora do servidor, não importei")
        return 0

    todas = registro["receitas"]
    registro["receitas"] = [r for r in todas if not receita_ignorada(r)]
    descartadas = len(todas) - len(registro["receitas"])
    registro["drops"] = filtrar_drops(registro.get("drops") or [], cat.setdefault("zonas", {}))

    cat["itens"][chave] = registro
    baixar_icone(item_id)
    marca = f" [{len(registro['receitas'])} receita(s)]" if registro["receitas"] else ""
    if descartadas:
        marca += f" (-{descartadas} fora do Crepúsculo)"
    if registro["drops"]:
        marca += f" [{len(registro['drops'])} chefe(s)]"
    print(f"  + {item.id} {item.nome} — {item.subtipo or item.tipo or '?'}{marca}")

    # daqui pra frente só as receitas que sobraram, já em forma de dict
    receitas = registro["receitas"]

    novos = 1
    if com_ingredientes and receitas:
        if len(receitas) > LIMITE_RECEITAS:
            print(
                f"    ~ {len(receitas)} receitas (provavelmente decomposição) — "
                f"não expandi os ingredientes.\n"
                f"      Importe os que te interessam com --id, ou suba o limite "
                f"com --max-receitas {len(receitas)}."
            )
            return novos

        pendentes = {
            ing["id"]
            for receita in receitas
            for ing in receita["ingredientes"]
            if str(ing["id"]) not in cat["itens"]
        }
        if len(pendentes) > LIMITE_INGREDIENTES:
            print(
                f"    ~ {len(pendentes)} ingredientes distintos — não expandi.\n"
                f"      Importe os que precisar com --id."
            )
            return novos

        for ing_id in sorted(pendentes):
            # ingredientes entram sem expandir as receitas *deles*, senão uma
            # cadeia longa de craft viraria uma varredura sem fim
            novos += importar_item(cat, ing_id, com_ingredientes=False)
    return novos


def _norm(s: str) -> str:
    """Para comparar nomes: sem caixa, sem as estrelas de grau, espaço normalizado."""
    return re.sub(r"\s+", " ", (s or "").replace("☆", "").replace("★", "")).strip().lower()


def por_nome(cat: dict, termo: str, com_ingredientes: bool) -> int:
    print(f"buscando {termo!r}...")
    try:
        achados = pwdb.buscar(termo)
    except pwdb.PwdbError as e:
        print(f"! busca falhou: {e}")
        return 0

    if not achados:
        print("  nada encontrado.")
        return 0

    if len(achados) == 1 or achados[0].get("exato"):
        return importar_item(cat, achados[0]["id"], com_ingredientes)

    # O site às vezes devolve a lista mesmo havendo um nome idêntico ao buscado
    # (ex. "Pedra Perfeita" vem junto de "Pedra Luminosa Perfeita"). Se o alvo
    # está ali, não faz sentido pedir para o usuário rodar de novo com --id.
    exato = next((a for a in achados if _norm(a["nome"]) == _norm(termo)), None)
    if exato:
        print(f"  match exato entre {len(achados)} resultados")
        return importar_item(cat, exato["id"], com_ingredientes)

    print(f"  {len(achados)} resultados — escolha o id e rode de novo com --id:")
    for a in achados[:40]:
        print(f"    {a['id']:>7}  {a['nome']}")
    if len(achados) > 40:
        print(f"    ... e mais {len(achados) - 40}")
    return 0


def por_categoria(cat: dict, escopo: str, escopo_id: int, com_ingredientes: bool) -> int:
    print(f"listando {escopo}/{escopo_id}...")
    try:
        itens = pwdb.listar(escopo, escopo_id)
    except (pwdb.PwdbError, ValueError) as e:
        print(f"! listagem falhou: {e}")
        return 0

    print(f"  {len(itens)} itens na categoria")
    novos = 0
    for it in itens:
        novos += importar_item(cat, it["id"], com_ingredientes)
    return novos


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def cmd_faxina(cat: dict) -> int:
    """Aplica IGNORAR_RECEITA_COM ao catálogo já existente.

    Também remove os itens que só existiam para servir de ingrediente às
    receitas descartadas. A regra olha apenas os ingredientes *dessas* receitas,
    então material importado de propósito (e que ainda não é usado por nenhuma
    receita do catálogo) nunca entra na conta.
    """
    orfaos_possiveis: set[str] = set()
    removidas = 0

    # equipamento de classe que o servidor não tem
    fora = [k for k, v in cat["itens"].items() if item_ignorado(v)]
    if fora:
        print(f"  {len(fora)} item(ns) de classe fora do servidor:")
        for k in fora:
            it = cat["itens"].pop(k)
            (ICONES / f"{k}.png").unlink(missing_ok=True)
            print(f"  - {k} {it['nome']} ({it.get('subtipo')})")

    for item in cat["itens"].values():
        ficam, saem = [], []
        for r in item.get("receitas") or []:
            (saem if receita_ignorada(r) else ficam).append(r)
        if not saem:
            continue
        removidas += len(saem)
        item["receitas"] = ficam
        print(f"  - {item['nome']}: {len(saem)} receita(s)")
        for r in saem:
            for ing in r.get("ingredientes") or []:
                orfaos_possiveis.add(str(ing["id"]))

    if not removidas and not fora:
        print(f"nada a limpar — nenhuma receita casa com {IGNORAR_RECEITA_COM} "
              f"e nenhum item com {IGNORAR_SUBTIPO}")
        return 0
    if not removidas:
        salvar(cat)
        print(f"\n{len(fora)} item(ns) removidos. Catálogo: {len(cat['itens'])} itens.")
        return 0

    # quem continua sendo usado por alguma receita que ficou?
    ainda_usados = {
        str(ing["id"])
        for it in cat["itens"].values()
        for r in it.get("receitas") or []
        for ing in r.get("ingredientes") or []
    }
    orfaos = sorted(orfaos_possiveis - ainda_usados)

    if orfaos:
        print(f"\n  itens que só serviam a essas receitas:")
        for k in orfaos:
            it = cat["itens"].pop(k, None)
            if it:
                (ICONES / f"{k}.png").unlink(missing_ok=True)
                print(f"  - {k} {it['nome']}")

    salvar(cat)
    print(f"\n{removidas} receita(s) e {len(orfaos)} item(ns) removidos. "
          f"Catálogo: {len(cat['itens'])} itens.")
    return 0


def cmd_listar(cat: dict) -> None:
    itens = sorted(cat["itens"].values(), key=lambda i: (i.get("tipo") or "", i["nome"]))
    if not itens:
        print("catálogo vazio. Importe algo com --nome ou --id.")
        return
    craft = sum(1 for i in itens if i.get("receitas"))
    print(f"{len(itens)} itens no catálogo ({craft} com receita)\n")
    for i in itens:
        r = f"  [{len(i['receitas'])} receita(s)]" if i.get("receitas") else ""
        print(f"  {i['id']:>7}  {i['nome']:<42} {i.get('subtipo') or i.get('tipo') or '?'}{r}")


def main(argv: list[str] | None = None) -> int:
    global LIMITE_RECEITAS

    p = argparse.ArgumentParser(
        description="Importa itens do pwdatabase para o catálogo local.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    alvo = p.add_mutually_exclusive_group(required=True)
    alvo.add_argument("--nome", metavar="TEXTO", help="busca por nome no pwdatabase")
    alvo.add_argument("--id", type=int, metavar="N", help="importa direto por id")
    alvo.add_argument("--subtipo", type=int, metavar="N", help="importa uma subcategoria (isubtype/N)")
    alvo.add_argument("--tipo", type=int, metavar="N", help="importa um tipo (itype/N)")
    alvo.add_argument("--categoria", type=int, metavar="N", help="importa uma categoria (key/N)")
    alvo.add_argument("--listar", action="store_true", help="mostra o catálogo atual")
    alvo.add_argument("--remover", type=int, metavar="N", help="remove um item do catálogo")
    alvo.add_argument("--reicones", action="store_true", help="rebaixa os ícones que faltam")
    alvo.add_argument(
        "--redrops",
        action="store_true",
        help="rebusca a tabela de drop dos itens já no catálogo (1 requisição por item)",
    )
    alvo.add_argument(
        "--faxina",
        action="store_true",
        help="remove do catálogo as receitas fora do Crepúsculo (veja IGNORAR_RECEITA_COM)",
    )
    alvo.add_argument(
        "--ajustes",
        action="store_true",
        help="reaplica data/ajustes.json (nomes próprios do The PW Clássico)",
    )

    p.add_argument(
        "--sem-ingredientes",
        action="store_true",
        help="não importa automaticamente os ingredientes das receitas",
    )
    p.add_argument(
        "--max-receitas",
        type=int,
        default=LIMITE_RECEITAS,
        metavar="N",
        help=f"acima de N receitas, não expande ingredientes (padrão {LIMITE_RECEITAS})",
    )
    args = p.parse_args(argv)
    com_ingredientes = not args.sem_ingredientes
    LIMITE_RECEITAS = args.max_receitas

    cat = carregar()
    antes = len(cat["itens"])

    if args.listar:
        cmd_listar(cat)
        return 0

    if args.faxina:
        return cmd_faxina(cat)

    if args.ajustes:
        n = aplicar_ajustes(cat)
        salvar(cat)
        print(f"{n} nome(s) ajustado(s) a partir de {AJUSTES.name}.")
        return 0

    if args.remover:
        chave = str(args.remover)
        item = cat["itens"].pop(chave, None)
        if item is None:
            print(f"{args.remover} não está no catálogo.")
            return 1
        (ICONES / f"{args.remover}.png").unlink(missing_ok=True)
        salvar(cat)
        print(f"removido: {args.remover} {item['nome']}")
        return 0

    if args.reicones:
        faltando = [int(k) for k in cat["itens"] if not (ICONES / f"{k}.png").exists()]
        print(f"{len(faltando)} ícones faltando")
        for iid in faltando:
            if baixar_icone(iid):
                print(f"  + icons/{iid}.png")
        return 0

    if args.redrops:
        # A tabela de drop está na mesma página do item, então importações
        # novas já vêm com ela. Isto aqui é só para o que entrou antes.
        # Equipamento não interessa: ninguém farma o item pronto, farma o
        # material. Uma requisição por item, com o crawl-delay de 1s.
        alvos = sorted(
            int(k) for k, i in cat["itens"].items()
            if i.get("tipo") not in ("Armas", "Armaduras", "Acessórios")
        )
        print(f"rebuscando drop de {len(alvos)} materiais (~{len(alvos)}s)")
        com = linhas = 0
        for n, iid in enumerate(alvos, 1):
            try:
                drops = filtrar_drops([asdict(d) for d in pwdb.get_item(iid).drops],
                                      cat.setdefault("zonas", {}))
            except pwdb.PwdbError as e:
                print(f"  ! {iid}: {e}")
                continue
            cat["itens"][str(iid)]["drops"] = drops
            if drops:
                com += 1
                linhas += len(drops)
            if n % 40 == 0:
                print(f"  {n}/{len(alvos)}")
        salvar(cat)
        print(f"\n{com} materiais com origem, {linhas} linhas de chefe.")
        return 0

    if args.nome:
        por_nome(cat, args.nome, com_ingredientes)
    elif args.id:
        importar_item(cat, args.id, com_ingredientes)
    elif args.subtipo:
        por_categoria(cat, "isubtype", args.subtipo, com_ingredientes)
    elif args.tipo:
        por_categoria(cat, "itype", args.tipo, com_ingredientes)
    elif args.categoria:
        por_categoria(cat, "key", args.categoria, com_ingredientes)

    novos = len(cat["itens"]) - antes
    if novos:
        salvar(cat)
        print(f"\n{novos} item(ns) novo(s). Catálogo: {len(cat['itens'])} itens.")
    else:
        print("\nnada novo pra salvar.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrompido.")
        sys.exit(130)
