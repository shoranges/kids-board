#!/usr/bin/env python3
"""공용 화면에서 서연·서우 전용 화면을 만들어 냅니다.

1) 매일 한자:  hanja/index.html  → hanja/seoyeon.html · hanja/seowoo.html
2) 키즈 보드:  index.html        → seoyeon.html · seowoo.html (+ 전용 매니페스트)

공용 화면을 고친 뒤 이 스크립트를 다시 돌리면 전용 화면이 같은 내용으로 다시 만들어집니다.

    python3 tools/build-profiles.py
"""
import json
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


def build_hanja() -> None:
    src = SRC.read_text(encoding="utf-8")
    for child in CHILDREN:
        target = ROOT / "hanja" / f"{child['id']}.html"
        target.write_text(build(src, child), encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size:,} bytes)")


# ---------------------------------------------------------------------------
# 키즈 홈 보드 (index.html → seoyeon.html · seowoo.html)
# ---------------------------------------------------------------------------
BOARD_SRC = ROOT / "index.html"
BOARD_CHILDREN = [
    {"id": "seoyeon", "name": "서연", "theme": "#FFF6EE", "bg": "#FFF8F2"},
    {"id": "seowoo", "name": "서우", "theme": "#F3F9FF", "bg": "#F7FBFF"},
]

BOARD_NOTE = (
    "<!-- 이 파일은 tools/build-profiles.py 가 index.html 에서 만들어 냅니다.\n"
    "     직접 고치면 다음 생성 때 덮어써지니 index.html 을 고쳐 주세요. -->\n"
)

BOARD_ICONS = [
    {"src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
]


def build_board(src: str, child: dict) -> str:
    cid, name = child["id"], child["name"]
    out = src

    def sub(old, new):
        nonlocal out
        if old not in out:
            sys.exit(f"[board:{cid}] 바꿀 곳을 찾지 못했습니다: {old[:70]!r}")
        out = out.replace(old, new, 1)

    sub("<!doctype html>\n", "<!doctype html>\n" + BOARD_NOTE)
    # data-board 값이 있으면 그 아이 화면만 그립니다(index.html 안 BOARD_CHILD).
    sub('<html lang="ko">', f'<html lang="ko" data-board="{cid}">')
    sub("<title>서연·서우 홈 보드</title>", f"<title>{name} 홈 보드</title>")
    sub(
        '<meta name="description" content="서연·서우 홈 보드 — 시계·날씨·공부 목록·수학 퀴즈·시간표·급식">',
        f'<meta name="description" content="{name} 전용 홈 보드 — 시간표·공부 목록·급식·매일 한자">',
    )
    sub('<meta name="apple-mobile-web-app-title" content="서연·서우">',
        f'<meta name="apple-mobile-web-app-title" content="{name} 보드">')
    sub('<link rel="manifest" href="./manifest.json">',
        f'<link rel="manifest" href="./manifest-{cid}.json">')
    sub("<h1>서연·서우 홈 보드</h1>", f"<h1>{name} 홈 보드</h1>")
    # 한자 바로가기는 그 아이 전용 한자 화면으로 (공용 ./hanja/ 대신).
    sub('<a class="hanja-link" href="./hanja/">',
        f'<a class="hanja-link" href="./hanja/{cid}.html">')
    sub("<b>매일 한자</b><span>오늘의 한자 3자 · 따라쓰기 · 문장 만들기 · 교과서 어휘</span>",
        f"<b>{name} 한자</b><span>{name} 전용 · 오늘의 한자 3자 · 따라쓰기 · 문장 만들기</span>")
    sub('<a class="tab hanja-tab" href="./hanja/"',
        f'<a class="tab hanja-tab" href="./hanja/{cid}.html"')
    return out


def board_manifest(child: dict) -> dict:
    name = child["name"]
    return {
        "name": f"{name} 키즈 보드",
        "short_name": f"{name} 보드",
        "description": f"{name} 전용 홈 보드 — 시간표·공부 목록·급식·매일 한자",
        "id": f"./{child['id']}.html",
        "lang": "ko",
        "start_url": f"./{child['id']}.html",
        "scope": "./",
        "display": "standalone",
        "orientation": "landscape",
        "background_color": child["bg"],
        "theme_color": child["theme"],
        "icons": BOARD_ICONS,
    }


def build_board_profiles() -> None:
    src = BOARD_SRC.read_text(encoding="utf-8")
    for child in BOARD_CHILDREN:
        target = ROOT / f"{child['id']}.html"
        target.write_text(build_board(src, child), encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size:,} bytes)")

        mf = ROOT / f"manifest-{child['id']}.json"
        mf.write_text(
            json.dumps(board_manifest(child), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {mf.relative_to(ROOT)}")


def main() -> None:
    build_hanja()
    build_board_profiles()


if __name__ == "__main__":
    main()
