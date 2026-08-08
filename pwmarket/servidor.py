"""Servidor local do pwmarket — grava os preços direto em data/precos.js.

Por que existe: uma página aberta como `file://` não pode escrever no disco, é
proibido pelo navegador. Então nesse modo o painel guarda tudo no localStorage e
depende do botão Exportar. Servindo a página daqui, ela ganha um endpoint para
onde mandar os dados, e o arquivo que você commita fica sempre em dia.

    py servidor.py

Abre http://127.0.0.1:8731 no navegador. Ctrl+C encerra.

Só stdlib. Escuta apenas em 127.0.0.1: não fica exposto na sua rede.
"""

from __future__ import annotations

import argparse
import http.server
import json
import shutil
import socketserver
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).parent
DESTINO = RAIZ / "data" / "precos.js"
BACKUP = RAIZ / "data" / "precos.bak.js"
LISTA = RAIZ / "data" / "lista.js"
PORTA_PADRAO = 8731

# Os dois arquivos existem separados porque têm donos diferentes: os preços são
# publicados para todo mundo, a lista é de quem usa a máquina. Só o precos.js
# vai para o git; lista.js está no .gitignore, então o site publicado nunca
# carrega lista nenhuma e cada visitante começa do zero.
CAB_PRECOS = (
    "// pwmarket — preços observados. Gravado pelo servidor local (servidor.py).\n"
    "// Commite este arquivo para publicar os preços.\n"
)
CAB_LISTA = (
    "// pwmarket — sua lista de receitas. Gravado pelo servidor local.\n"
    "// Fica FORA do git (veja .gitignore): é pessoal e não vai para o site.\n"
)


def _escrever(destino: Path, variavel: str, cabecalho: str, dados: dict) -> int:
    corpo = json.dumps(dados, ensure_ascii=False, indent=1)
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("w", encoding="utf-8", newline="\n") as f:
        f.write(cabecalho)
        f.write(f"window.{variavel} = {corpo};\n")
    return destino.stat().st_size


def escrever_precos(dados: dict) -> tuple[int, int]:
    """Grava data/precos.js e data/lista.js, com backup do arquivo de preços."""
    if DESTINO.exists():
        shutil.copy2(DESTINO, BACKUP)

    n1 = _escrever(DESTINO, "PW_PRECOS", CAB_PRECOS, {"obs": dados["obs"]})
    n2 = _escrever(LISTA, "PW_LISTA", CAB_LISTA, {"favoritos": dados.get("favoritos") or []})
    return n1, n2


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    # --- respostas ------------------------------------------------------
    def _json(self, payload: dict, status: int = 200) -> None:
        corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(corpo)

    # --- rotas ----------------------------------------------------------
    def do_GET(self):  # noqa: N802  (assinatura da stdlib)
        if self.path.split("?")[0] == "/api/status":
            return self._json({
                "ok": True,
                "arquivo": str(DESTINO.relative_to(RAIZ)).replace("\\", "/"),
                "lista": str(LISTA.relative_to(RAIZ)).replace("\\", "/"),
            })
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/api/salvar":
            return self._json({"ok": False, "erro": "rota desconhecida"}, 404)

        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._json({"ok": False, "erro": "tamanho inválido"}, 400)
        if tamanho <= 0 or tamanho > 8 * 1024 * 1024:
            return self._json({"ok": False, "erro": "corpo vazio ou grande demais"}, 400)

        try:
            dados = json.loads(self.rfile.read(tamanho))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            return self._json({"ok": False, "erro": f"json inválido: {e}"}, 400)

        # forma mínima esperada — não grava lixo por cima do arquivo bom
        if not isinstance(dados, dict) or not isinstance(dados.get("obs"), dict):
            return self._json({"ok": False, "erro": "payload sem o campo obs"}, 400)
        lista = dados.get("favoritos")
        if lista is None:
            lista = dados.get("projetos")  # nome antigo do campo
        dados["favoritos"] = lista if isinstance(lista, list) else []

        try:
            n1, n2 = escrever_precos(dados)
        except OSError as e:
            return self._json({"ok": False, "erro": f"falha ao gravar: {e}"}, 500)

        itens = len(dados["obs"])
        obs = sum(len(v) for v in dados["obs"].values() if isinstance(v, list))
        agora = datetime.now(timezone.utc).astimezone().strftime("%H:%M:%S")
        print(f"  [{agora}] precos.js {itens} item(ns)/{obs} obs ({n1}b) · "
              f"lista.js {len(dados['favoritos'])} receita(s) ({n2}b)")
        return self._json({"ok": True, "itens": itens, "observacoes": obs,
                           "lista": len(dados["favoritos"]), "bytes": n1 + n2})

    def log_message(self, *args):
        pass  # o log padrão por requisição só polui; imprimimos o que importa


class Servidor(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--porta", type=int, default=PORTA_PADRAO, metavar="N")
    p.add_argument("--sem-navegador", action="store_true", help="não abre o navegador sozinho")
    args = p.parse_args(argv)

    url = f"http://127.0.0.1:{args.porta}/index.html"
    try:
        # 127.0.0.1 e não 0.0.0.0: ninguém na rede alcança este servidor
        with Servidor(("127.0.0.1", args.porta), Handler) as httpd:
            print(f"pwmarket servindo {RAIZ}")
            print(f"  {url}")
            print(f"  preços vão direto para {DESTINO.relative_to(RAIZ)}")
            print("  Ctrl+C encerra.\n")
            if not args.sem_navegador:
                webbrowser.open(url)
            httpd.serve_forever()
    except OSError as e:
        print(f"não consegui subir na porta {args.porta}: {e}")
        print("tente outra com --porta 8732")
        return 1
    except KeyboardInterrupt:
        print("\nencerrado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
