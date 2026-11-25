#!/usr/bin/env python3
"""hanja/index.html 공용 화면에서 서연·서우 전용 화면을 만들어 냅니다.

index.html 을 고친 뒤 이 스크립트를 다시 돌리면
hanja/seoyeon.html · hanja/seowoo.html 이 같은 내용으로 다시 만들어집니다.

    python3 tools/build-profiles.py
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "hanja" / "index.html"

CHILDREN = [
    {"id": "seoyeon", "name": "서연"},
    {"id": "seowoo", "name": "서우"},
]

HEAD_NOTE = (
    "<!-- 이 파일은 tools/build-profiles.py 가 hanja/index.html 에서 만들어 냅니다.\n"
    "     직접 고치면 다음 생성 때 덮어써지니 index.html 을 고쳐 주세요. -->\n"
)


def build(src: str, child: dict) -> str:
    cid, name = child["id"], child["name"]
    out = src

    def sub(old, new):
        nonlocal out
        if old not in out:
            sys.exit(f"[{cid}] 바꿀 곳을 찾지 못했습니다: {old[:60]!r}")
        out = out.replace(old, new, 1)

    sub("<!doctype html>\n", "<!doctype html>\n" + HEAD_NOTE)
    sub('<html lang="ko">', f'<html lang="ko" data-child="{cid}">')
    sub("<title>매일 한자 · 서연·서우</title>", f"<title>매일 한자 · {name}</title>")
    sub(
        '<meta name="apple-mobile-web-app-title" content="매일 한자">',
        f'<meta name="apple-mobile-web-app-title" content="{name} 한자">',
    )
    sub('<link rel="manifest" href="./manifest.json">',
        f'<link rel="manifest" href="./manifest-{cid}.json">')
    # 헤더의 공용 '◀ 보드' 링크는 그대로 두고, 잠금 값을 app.js 보다 먼저 심습니다.
    sub('<script src="./data-a.js"></script>',
        f'<script>window.HANJA_LOCK = "{cid}";</script>\n<script src="./data-a.js"></script>')
    return out


def main() -> None:
    src = SRC.read_text(encoding="utf-8")
    for child in CHILDREN:
        target = ROOT / "hanja" / f"{child['id']}.html"
        target.write_text(build(src, child), encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
