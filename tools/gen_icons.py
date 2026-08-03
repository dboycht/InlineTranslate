#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成扩展图标（仅使用 Python 标准库，无第三方依赖）。

设计：蓝紫渐变圆角方块，内部为三组「原文 + 下方译文」的白色线条，
直观表达“在原文下方显示译文”的核心特性。
用法：python tools/gen_icons.py
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, '..', 'icons'))
SS = 4  # 超采样倍数（抗锯齿）


def _chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def _write_png(path, size, rows):
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    raw = b''.join(b'\x00' + r for r in rows)  # 每行前置 filter type 0
    png = (
        b'\x89PNG\r\n\x1a\n'
        + _chunk(b'IHDR', ihdr)
        + _chunk(b'IDAT', zlib.compress(raw, 9))
        + _chunk(b'IEND', b'')
    )
    with open(path, 'wb') as f:
        f.write(png)


def _lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _in_rounded_rect(x, y):
    """归一化坐标 (0,0)-(1,1) 是否在圆角矩形内"""
    r = 0.22
    cx, cy = min(x, 1 - x), min(y, 1 - y)
    if cx >= r or cy >= r:
        return True
    return (r - cx) ** 2 + (r - cy) ** 2 <= r * r


# 三组线条：(y, 高度, 宽度) —— 组内上方为原文条、下方为译文条
BARS = ((0.24, 0.09, 0.80), (0.48, 0.09, 0.64), (0.72, 0.09, 0.48))


def _sample(x, y):
    """返回该点的 (r, g, b, a)，坐标归一化到 [0,1]"""
    if not _in_rounded_rect(x, y):
        return (0, 0, 0, 0)
    color = _lerp((47, 107, 255), (123, 92, 255), (x + y) / 2)  # 蓝紫渐变背景
    for y0, h, w in BARS:
        # 原文条（高亮）
        if y0 - 0.015 <= y <= y0 + h - 0.015 and 0.17 <= x <= 0.17 + w:
            color = _lerp(color, (255, 255, 255), 0.94)
        # 译文条（位于原文下方、更窄更淡）
        y1, h2 = y0 + 0.13, h * 0.55
        if y1 <= y <= y1 + h2 and 0.22 <= x <= 0.22 + w * 0.78:
            color = _lerp(color, (255, 255, 255), 0.50)
    return color + (255,)


def render(size):
    n = size * SS
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    c = _sample((x * SS + sx + 0.5) / n, (y * SS + sy + 0.5) / n)
                    for i in range(4):
                        acc[i] += c[i]
            k = SS * SS
            row += bytes(v // k for v in acc)
        rows.append(bytes(row))
    return rows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, 'icon%d.png' % size)
        _write_png(path, size, render(size))
        print('written:', path)


if __name__ == '__main__':
    main()
