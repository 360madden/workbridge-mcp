"""Small dependency-free VT screen renderer for bounded ConPTY captures.

This renderer tracks printable cells and common cursor/erase sequences used
by Windows terminal applications. It is a visualization helper, not an
authoritative terminal protocol implementation.
"""
from __future__ import annotations

import re
import unicodedata


def render_screen(raw: bytes | str, width: int = 120, height: int = 43) -> list[str]:
    if not 40 <= width <= 240 or not 12 <= height <= 100:
        raise ValueError("terminal bounds out of range")
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
    grid = [[" "] * width for _ in range(height)]
    x = 0
    y = 0
    sx = sy = 0

    def reset():
        nonlocal grid, x, y
        grid = [[" "] * width for _ in range(height)]
        x = 0
        y = 0

    def scroll():
        nonlocal grid, y
        grid.pop(0)
        grid.append([" "] * width)
        y = height - 1

    def advance():
        nonlocal x, y
        x += 1
        if x >= width:
            x = 0
            y += 1
            if y >= height:
                scroll()

    def csi(params: str, cmd: str):
        nonlocal x, y, sx, sy, grid
        is_private = params.startswith("?")
        digits = params.lstrip("?").split(";")
        try:
            values = [int(v) if v else 0 for v in digits]
        except ValueError:
            return
        v = values[0] if values else 0
        count = max(1, v)
        if cmd in ("H", "f"):
            y = min(height - 1, max(0, (v or 1) - 1))
            x = min(width - 1, max(0, ((values[1] if len(values) > 1 else 1) or 1) - 1))
        elif cmd == "G":
            x = min(width - 1, count - 1)
        elif cmd == "d":
            y = min(height - 1, count - 1)
        elif cmd == "A":
            y = max(0, y - count)
        elif cmd == "B":
            y = min(height - 1, y + count)
        elif cmd == "C":
            x = min(width - 1, x + count)
        elif cmd == "D":
            x = max(0, x - count)
        elif cmd == "E":
            y = min(height - 1, y + count)
            x = 0
        elif cmd == "F":
            y = max(0, y - count)
            x = 0
        elif cmd == "J":
            if v in (2, 3):
                reset()
            elif v == 0:
                grid[y][x:] = [" "] * (width - x)
                for row in range(y + 1, height):
                    grid[row] = [" "] * width
            elif v == 1:
                for row in range(0, y):
                    grid[row] = [" "] * width
                grid[y][:x + 1] = [" "] * (x + 1)
        elif cmd == "K":
            if v == 0:
                grid[y][x:] = [" "] * (width - x)
            elif v == 1:
                grid[y][:x + 1] = [" "] * (x + 1)
            elif v == 2:
                grid[y] = [" "] * width
        elif cmd == "s":
            sx, sy = x, y
        elif cmd == "u":
            x, y = sx, sy
        elif cmd == "X":
            end = min(width, x + count)
            grid[y][x:end] = [" "] * (end - x)
        elif cmd == "P":
            row = grid[y]
            grid[y] = row[:x] + row[min(width, x + count):] + [" "] * min(count, width - x)
        elif cmd == "@":
            row = grid[y]
            grid[y] = (row[:x] + [" "] * min(count, width - x) + row[x:])[:width]
        elif cmd == "S":
            for _ in range(min(count, height)):
                scroll()
        elif cmd == "h" and is_private and v in (47, 1047, 1049):
            reset()

    i = 0
    n = len(text)
    while i < n:
        char = text[i]
        if char == "\x1b":
            if i + 1 >= n:
                break
            command = text[i + 1]
            if command == "[":
                j = i + 2
                while j < n and not ("@" <= text[j] <= "~"):
                    j += 1
                if j >= n:
                    break
                csi(text[i + 2:j], text[j])
                i = j + 1
                continue
            if command == "]":
                j = i + 2
                while j < n and text[j] != "\x07" and not (
                        text[j] == "\x1b" and j + 1 < n and text[j + 1] == "\\"):
                    j += 1
                if j >= n:
                    break
                i = j + (2 if text[j] == "\x1b" else 1)
                continue
            if command == "7":
                sx, sy = x, y
            elif command == "8":
                x, y = sx, sy
            elif command == "D":
                y += 1
                if y >= height:
                    scroll()
            elif command == "E":
                x = 0
                y += 1
                if y >= height:
                    scroll()
            elif command == "M":
                y = max(0, y - 1)
            i += 2
            continue
        if char == "\r":
            x = 0
        elif char == "\n":
            y += 1
            if y >= height:
                scroll()
        elif char == "\b":
            x = max(0, x - 1)
        elif char == "\t":
            x = min(width - 1, ((x // 8) + 1) * 8)
        elif char >= " " and char != "\x7f" and not unicodedata.combining(char):
            if x >= width:
                x = 0
                y += 1
                if y >= height:
                    scroll()
            grid[y][x] = char
            advance()
            if unicodedata.east_asian_width(char) in ("F", "W"):
                if x < width:
                    grid[y][x] = " "
                    advance()
        i += 1
    return ["".join(row).rstrip() for row in grid]


def relevant_screen_lines(raw: bytes, *, limit: int = 18) -> list[str]:
    """Return a bounded review-focused view, excluding generic terminal chrome."""
    words = re.compile(
        r"(?i)boundedline|(?:\bline\s*\d+\b)|(?:\bissue\b)|(?:\bdefect\b)|"
        r"(?:\bbug\b)|(?:\bincorrect\b)|(?:\btest\b)|NO_ISSUE|(?:\breview\b)"
    )
    visible = render_screen(raw)
    return [line[:115] for line in visible if words.search(line)][:limit]
