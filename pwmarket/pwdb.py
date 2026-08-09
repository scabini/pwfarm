"""Cliente e parser do pwdatabase.com (base BR).

Só stdlib de propósito: o HTML do site é server-rendered e bem estável, então
regex direcionado resolve sem arrastar uma dependência de parser.

Respeita o `Crawl-delay: 1` declarado no robots.txt deles — veja `_throttle`.
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, asdict

BASE = "https://www.pwdatabase.com"
LANG = "br"
ICON_URL = BASE + "/images/icons/generalm/{id}.png"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# robots.txt: Crawl-delay: 1
CRAWL_DELAY = 1.0
_last_request = 0.0


class PwdbError(RuntimeError):
    pass


def _throttle() -> None:
    global _last_request
    wait = CRAWL_DELAY - (time.monotonic() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


def _get(path: str, data: dict | None = None) -> str:
    """GET (or POST when `data` is given) and return decoded text."""
    _throttle()
    url = path if path.startswith("http") else f"{BASE}/{LANG}/{path}"
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise PwdbError(f"HTTP {e.code} em {url}") from e
    except urllib.error.URLError as e:
        raise PwdbError(f"falha de rede em {url}: {e.reason}") from e


def fetch_icon(item_id: int) -> bytes:
    """Ícones são determinísticos: /images/icons/generalm/<id>.png"""
    _throttle()
    req = urllib.request.Request(ICON_URL.format(id=item_id), headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise PwdbError(f"ícone {item_id}: HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise PwdbError(f"ícone {item_id}: {e.reason}") from e


# --------------------------------------------------------------------------
# helpers de texto
# --------------------------------------------------------------------------

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _clean(s: str) -> str:
    """Tira tags, decodifica entidades e normaliza espaço."""
    s = _TAG.sub(" ", s)
    s = html.unescape(s)
    # &#9734; (☆) e &#9733; (★) fazem parte do nome no jogo e sobrevivem ao unescape
    return _WS.sub(" ", s).strip()


def _num(s: str | None) -> int | None:
    """'77.480' -> 77480. O site usa ponto como separador de milhar."""
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", s)
    return int(digits) if digits else None


def _search1(pattern: str, text: str, group: int = 1) -> str | None:
    m = re.search(pattern, text, re.S)
    return m.group(group) if m else None


# --------------------------------------------------------------------------
# modelo
# --------------------------------------------------------------------------


@dataclass
class Ingrediente:
    id: int
    nome: str
    qtd: int
    raridade: int = 0


@dataclass
class Receita:
    id: int | None
    nome: str
    prob: float | None
    ingredientes: list[Ingrediente] = field(default_factory=list)
    npc: str | None = None
    local: str | None = None


@dataclass
class Drop:
    """Uma linha de 'Drop from': quem larga o item, onde e com que chance.

    `sala` é o número entre parênteses da coordenada. O pwdatabase não nomeia
    esse mapa, mas ele separa os modos da dusk — o mesmo chefe aparece em salas
    diferentes com vida diferente, que é o modo mais difícil. O rótulo humano
    ("Dusk 3-3") sai do ajustes.json.
    """
    mob: int
    nome: str
    nivel: int | None
    zona: str | None
    sala: str | None
    pct: float


@dataclass
class Item:
    id: int
    nome: str
    raridade: int = 0
    tipo: str | None = None
    subtipo: str | None = None
    nivel: int | None = None
    nivel_req: int | None = None
    stack: int | None = None
    npc_venda: int | None = None
    npc_compra: int | None = None
    desc: str | None = None
    receitas: list[Receita] = field(default_factory=list)
    drops: list[Drop] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------
# parsing
# --------------------------------------------------------------------------

# <a href='items/16702'> <img src='...'> <span class='item_color7'>Nome</span> (2)</a>
#
# O <span> de cor é OPCIONAL: ingredientes sem raridade trazem o nome cru — é o
# caso da Essência do Crepúsculo, que entra em toda receita do Palácio. Exigir o
# span fazia esses ingredientes desaparecerem da receita em silêncio, o que é
# pior do que ficar sem preço: eles nem apareciam para ser cobrados.
_INGREDIENTE = re.compile(
    r"<a href=['\"]items/(\d+)['\"]>\s*"
    r"<img[^>]*>(?:\s*<img[^>]*>)?\s*"
    r"(?:<span class='item_color(\d+)'>([^<]*)</span>|([^<(]+?))\s*"
    r"(?:\((\d+)\))?\s*</a>",
    re.S,
)


def _parse_receitas(page: str) -> list[Receita]:
    """Extrai o bloco 'Item can be crafted' e parseia cada receita.

    Importante: recorta o bloco antes de procurar ingredientes. A página também
    tem 'Used in craft for following items' (craft reverso), cujos links
    `items/<id>` casariam com o mesmo padrão e poluiriam a receita.
    """
    start = page.find("Item can be crafted")
    if start < 0:
        return []
    end = page.find("</table>", start)
    block = page[start : end if end > 0 else len(page)]

    receitas: list[Receita] = []
    # cada receita abre com <strong>Recipe</strong>: <a href="recipe/2953">Nome</a>
    partes = re.split(r"<strong>\s*Recipe\s*</strong>\s*:", block)[1:]
    for parte in partes:
        rid = _search1(r"href=['\"]recipe/(\d+)['\"]", parte)
        nome = _search1(r"href=['\"]recipe/\d+['\"]>\s*(?:<strong>)?(.*?)(?:</strong>)?\s*</a>", parte)
        prob = _search1(r"Probability to create:\s*<strong>\s*([\d.]+)\s*</strong>", parte)

        ingredientes = []
        for m in _INGREDIENTE.finditer(parte):
            nome_ing = _clean(m.group(3) if m.group(3) is not None else (m.group(4) or ""))
            if not nome_ing:
                continue
            ingredientes.append(
                Ingrediente(
                    id=int(m.group(1)),
                    nome=nome_ing,
                    qtd=int(m.group(5)) if m.group(5) else 1,
                    raridade=int(m.group(2)) if m.group(2) else 0,
                )
            )

        npc = _search1(r"href=['\"]npc/\d+['\"]>\s*(.*?)\s*</a>", parte)
        local = _search1(r'class="paddedLeft">\s*(.*?)\s*</p>', parte)

        receitas.append(
            Receita(
                id=int(rid) if rid else None,
                nome=_clean(nome or "receita"),
                prob=float(prob) if prob else None,
                ingredientes=ingredientes,
                npc=_clean(npc) if npc else None,
                local=_clean(local) if local else None,
            )
        )
    return receitas


# Uma linha da tabela "Drop from":
#   <td>1</td><td><a href="mob/14715">Nome</a></td><td>150</td>
#   <td>Palácio do Crepúsculo<br />397 519 (9)</td><td>elemento</td><td>vida</td>
#   <td>43.3333</td>
_DROP = re.compile(
    r"<tr>\s*<td>\d+</td>\s*"
    r"<td><a href=['\"]mob/(\d+)['\"]>([^<]*)</a></td>\s*"
    r"<td>(\d*)</td>\s*"
    r"<td>(.*?)</td>\s*"
    r"<td>.*?</td>\s*"          # elemento
    r"<td>.*?</td>\s*"          # vida
    r"<td>([\d.]+)</td>",
    re.S,
)


def _parse_drops(page: str) -> list[Drop]:
    """Extrai a tabela 'Drop from'. Ausente na maioria dos itens craftados."""
    i = page.find('id="mobs_drop"')
    if i < 0:
        return []
    bloco = page[i:]
    fim = bloco.find("</table>")
    if fim > 0:
        bloco = bloco[:fim]

    saida = []
    for mob, nome, nivel, onde, pct in _DROP.findall(bloco):
        # "Palácio do Crepúsculo<br />397 519 (9)" — zona e coordenada
        partes = re.split(r"<br\s*/?>", onde, maxsplit=1)
        zona = _clean(partes[0]) or None
        coord = _clean(partes[1]) if len(partes) > 1 else ""
        sala = _search1(r"\((\d+)\)", coord)
        if zona == "-":
            zona = None
        saida.append(Drop(
            mob=int(mob), nome=_clean(nome), nivel=_num(nivel) if nivel else None,
            zona=zona, sala=sala, pct=float(pct),
        ))
    return saida


def parse_item(page: str, item_id: int | None = None) -> Item:
    """Parseia uma página /br/items/<id> (ou o resultado de busca exata)."""
    m = re.search(r'<th class="itemHeader"[^>]*>(.*?)</th>', page, re.S)
    if not m:
        raise PwdbError("não achei o cabeçalho do item — a página mudou de formato?")
    cabecalho = m.group(1)

    # Normalmente o nome vem colorido pela raridade:
    #   <th class="itemHeader"><span class='item_color1'>Nome</span>
    # mas itens sem raridade (vários de quest) trazem o nome cru, seguido só do
    # link que abre o menuzinho. Nesse caso removemos o <a> e ficamos com o nome.
    sm = re.search(r"<span class=['\"]item_color(\d+)['\"]>(.*?)</span>", cabecalho, re.S)
    if sm:
        raridade, nome = int(sm.group(1)), _clean(sm.group(2))
    else:
        raridade = 0
        nome = _clean(re.sub(r"<a\s[^>]*>.*?</a>", "", cabecalho, flags=re.S))
    if not nome:
        raise PwdbError("cabeçalho do item veio sem nome")

    # iMenu(20452,event) confirma o id real (importante quando vem da busca)
    found_id = _search1(r"iMenu\((\d+)\s*,\s*event\)", page)
    resolved = int(found_id) if found_id else item_id
    if resolved is None:
        raise PwdbError(f"não consegui resolver o id de {nome!r}")

    subtipo_raw = _search1(r"Subtype:\s*(.*?)<br", page)
    price = re.search(r"Price:\s*([\d.]+)\s*/\s*([\d.]+)", page)

    return Item(
        id=resolved,
        nome=nome,
        raridade=raridade,
        tipo=_clean(_search1(r"Type:\s*<a href=['\"]key/\d+['\"]>([^<]+)</a>", page) or "") or None,
        subtipo=_clean(subtipo_raw) if subtipo_raw else None,
        nivel=_num(_search1(r"LV\.\s*([\d.]+)", page)),
        nivel_req=_num(_search1(r"Level Required:\s*([\d.]+)", page)),
        stack=_num(_search1(r"Stacked:\s*([\d.]+)", page)),
        npc_venda=_num(price.group(1)) if price else None,
        npc_compra=_num(price.group(2)) if price else None,
        desc=_clean(_search1(r"<span style='color:#ffcb4a'>(.*?)</span>", page) or "") or None,
        receitas=_parse_receitas(page),
        drops=_parse_drops(page),
    )


def get_item(item_id: int) -> Item:
    return parse_item(_get(f"items/{item_id}"), item_id)


# --------------------------------------------------------------------------
# busca e listagem
# --------------------------------------------------------------------------

# linha de tabela de listagem: <a href="items/20443"><span class='item_color1'>Nome</span></a>
_LISTA = re.compile(
    r"<a href=['\"]items/(\d+)['\"]>\s*<span class='item_color(\d+)'>([^<]+)</span>\s*</a>",
    re.S,
)


def buscar(termo: str) -> list[dict]:
    """POST /br/search. Nome exato cai direto na página do item."""
    page = _get("search", {"s": termo})

    # match exato -> o site já renderiza a ficha do item
    if '<th class="itemHeader"' in page:
        it = parse_item(page)
        return [{"id": it.id, "nome": it.nome, "raridade": it.raridade, "exato": True}]

    vistos: dict[int, dict] = {}
    for m in _LISTA.finditer(page):
        iid = int(m.group(1))
        vistos.setdefault(
            iid,
            {"id": iid, "raridade": int(m.group(2)), "nome": _clean(m.group(3)), "exato": False},
        )
    return list(vistos.values())


def listar(escopo: str, escopo_id: int) -> list[dict]:
    """Lista itens de uma categoria. `escopo` = key | itype | isubtype."""
    if escopo not in ("key", "itype", "isubtype"):
        raise ValueError(f"escopo inválido: {escopo}")
    page = _get(f"{escopo}/{escopo_id}")
    total = _search1(r"Shown\s+[\d-]+\s+of\s+(\d+)", page)

    vistos: dict[int, dict] = {}
    for m in _LISTA.finditer(page):
        iid = int(m.group(1))
        vistos.setdefault(
            iid, {"id": iid, "raridade": int(m.group(2)), "nome": _clean(m.group(3))}
        )
    itens = list(vistos.values())
    if total and int(total) > len(itens):
        # o site pagina em blocos; avisa em vez de truncar silenciosamente
        print(f"  aviso: a categoria tem {total} itens, esta página trouxe {len(itens)}")
    return itens


if __name__ == "__main__":  # smoke test manual
    it = get_item(20320)
    print(json.dumps(it.to_dict(), ensure_ascii=False, indent=2))
