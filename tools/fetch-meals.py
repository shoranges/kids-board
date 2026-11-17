#!/usr/bin/env python3
"""함박초등학교 급식표를 NEIS에서 받아 meals.json 으로 저장합니다.

- API 키 없이 쓸 수 있게 5일 단위로 나눠서 요청합니다.
- 오늘부터 이번 달 + 다음 달 말일까지 받습니다.
"""
import json, re, sys, datetime, urllib.request, urllib.parse

OFFICE = "J10"          # 경기도교육청
SCHOOL = "7751355"      # 함박초등학교
BASE = "https://open.neis.go.kr/hub/mealServiceDietInfo"
OUT = "meals.json"

ALLERGY_ONLY = re.compile(r"^[\d.\s]+$")
KEEP_DESC = True


def fetch_chunk(start, end):
    q = {
        "Type": "json",
        "ATPT_OFCDC_SC_CODE": OFFICE,
        "SD_SCHUL_CODE": SCHOOL,
        "MLSV_FROM_YMD": start.strftime("%Y%m%d"),
        "MLSV_TO_YMD": end.strftime("%Y%m%d"),
    }
    url = BASE + "?" + urllib.parse.urlencode(q)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                body = r.read().decode("utf-8")
            break
        except Exception as e:
            if attempt == 3:
                raise
    data = json.loads(body)
    blk = data.get("mealServiceDietInfo")
    if not blk:
        return []
    rows = []
    for part in blk:
        if isinstance(part, dict) and "row" in part:
            rows.extend(part["row"])
    return rows


def split_dish(raw):
    """'현미찰밥m (5.6)' -> ('현미찰밥', ['5','6'])"""
    s = (raw or "").strip()
    allergy = []
    # 괄호로 끝나면 짝이 맞는 '('를 찾아 내용을 살핍니다.
    while s.endswith(")"):
        depth = 0
        idx = -1
        for i in range(len(s) - 1, -1, -1):
            ch = s[i]
            if ch == ")":
                depth += 1
            elif ch == "(":
                depth -= 1
                if depth == 0:
                    idx = i
                    break
        if idx < 0:
            break
        inner = s[idx + 1 : -1].strip()
        if inner and ALLERGY_ONLY.match(inner):
            allergy = [p for p in re.split(r"[.\s]+", inner) if p.isdigit()]
            s = s[:idx].strip()
            continue
        if len(inner) > 10:          # 너무 긴 설명 괄호는 접기
            s = s[:idx].strip()
            continue
        break
    s = re.sub(r"\s*\((?:초|중|고)\)\s*$", "", s)   # 학교급 표식
    s = s.replace("\u2665", "").strip()          # ♥ 제거
    s = re.sub(r"\s{2,}", " ", s)
    s = re.sub(r"m$", "", s) if re.search(r"[가-힣]m$", s) else s  # NEIS 'm' 표식
    s = s.strip()
    return s, allergy


def iso(d):
    return d.strftime("%Y-%m-%d")


def main():
    today = datetime.date.today()
    first = today.replace(day=1)
    # 다음 달 말일
    if first.month == 12:
        nxt_first = datetime.date(first.year + 1, 1, 1)
    else:
        nxt_first = datetime.date(first.year, first.month + 1, 1)
    # 다음 달 말일까지
    if nxt_first.month == 12:
        after = datetime.date(nxt_first.year + 1, 1, 1)
    else:
        after = datetime.date(nxt_first.year, nxt_first.month + 1, 1)
    last = after - datetime.timedelta(days=1)

    rows = []
    cur = first
    while cur <= last:
        end = min(cur + datetime.timedelta(days=4), last)
        try:
            got = fetch_chunk(cur, end)
            rows.extend(got)
        except Exception as e:
            print("실패 %s~%s: %s" % (cur, end, e), file=sys.stderr)
        cur = end + datetime.timedelta(days=1)

    meals = {}
    school_name = "함박초등학교"
    for r in rows:
        ymd = r.get("MLSV_YMD", "")
        if len(ymd) != 8:
            continue
        if r.get("MMEAL_SC_CODE") != "2":   # 중식만
            continue
        key = "%s-%s-%s" % (ymd[:4], ymd[4:6], ymd[6:])
        if key in meals:
            continue
        school_name = r.get("SCHUL_NM") or school_name
        dishes = []
        for piece in re.split(r"<br\s*/?>", r.get("DDISH_NM", "")):
            name, allergy = split_dish(piece)
            if not name:
                continue
            dishes.append({"name": name, "allergy": allergy})
        cal = (r.get("CAL_INFO") or "").replace(" Kcal", "").replace("kcal", "").strip()
        try:
            cal_num = float(cal)
        except ValueError:
            cal_num = None
        meals[key] = {
            "ymd": ymd,
            "date": key,
            "meal": r.get("MMEAL_SC_NM") or "중식",
            "dishes": dishes,
            "cal": (r.get("CAL_INFO") or "").strip(),
            "calNum": cal_num,
        }

    out = {
        "school": {"name": school_name, "officeCode": OFFICE, "schoolCode": SCHOOL},
        "source": "NEIS open.neis.go.kr",
        "generatedAt": today.strftime("%Y-%m-%d"),
        "range": [iso(first), iso(last)],
        "meals": dict(sorted(meals.items())),
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("%s → %d일치 (%s ~ %s)" % (OUT, len(meals), iso(first), iso(last)))


if __name__ == "__main__":
    main()
