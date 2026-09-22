"""像素字体覆盖度核对小工具。

用法: python fontcheck.py <字体文件路径>

报告: 总码位数 / 中日韩统一表意文字数量 / 关键界面用字抽样命中情况。
woff 与 ttf 直接读; woff2 需要 brotli (本机未装), 所以请喂 .woff。
"""

import sys

from fontTools.ttLib import TTFont


# 抽样: DSH 界面里真实会出现的字, 覆盖设置页/会话/皮肤中心/工具状态
SAMPLES = [
    "设置皮肤中心会话模型思考工具调用消息发送停止",
    "深度求索像素复古终端配色层级动效性能",
    "工作区文件终端任务看板远程统计归档",
    "新建删除重命名确认取消应用试穿背景",
    "你好世界测试中文简体字形覆盖率检查",
]


def main() -> int:
    if len(sys.argv) != 2:
        print("用法: python fontcheck.py <字体文件路径>")
        return 2

    path = sys.argv[1]
    font = TTFont(path, fontNumber=0)
    cmap: set[int] = set()
    for table in font["cmap"].tables:
        if table.isUnicode():
            cmap.update(table.cmap.keys())

    cjk = [cp for cp in cmap if 0x4E00 <= cp <= 0x9FFF]
    ext_a = [cp for cp in cmap if 0x3400 <= cp <= 0x4DBF]
    latin = [cp for cp in cmap if 0x0020 <= cp <= 0x007E]

    print(f"文件      : {path}")
    print(f"总码位    : {len(cmap)}")
    print(f"基本汉字  : {len(cjk)}  (U+4E00..U+9FFF, 共 20992)")
    print(f"扩展A汉字 : {len(ext_a)}")
    print(f"ASCII可见 : {len(latin)}  (共 95)")

    name = font["name"]
    for rec in name.names:
        if rec.nameID in (1, 2, 4) and rec.platformID == 3:
            try:
                print(f"name[{rec.nameID}]: {rec.toUnicode()}")
            except Exception:
                pass

    total = 0
    missed_all: list[str] = []
    for line in SAMPLES:
        missed = [ch for ch in line if ord(ch) not in cmap]
        total += len(line)
        missed_all.extend(missed)
        status = "OK " if not missed else "缺字"
        print(f"[{status}] {line}  缺: {''.join(missed) if missed else '-'}")

    rate = (total - len(missed_all)) / total * 100 if total else 0.0
    print(f"抽样命中率: {rate:.1f}%  ({total - len(missed_all)}/{total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())