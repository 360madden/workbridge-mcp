from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from freebuff_vt_screen import render_screen, relevant_screen_lines

def check(condition, msg):
    assert condition, msg

lines = render_screen(b'\x1b[2J\x1b[1;1HHello\x1b[2;1HWorld\x1b[2;1HBye\x1b[K', 40, 12)
check(lines[0] == 'Hello', 'first row')
check(lines[1] == 'Bye', 'replacement + erase line')

lines = render_screen(b'\x1b]0;private title\x07\x1b[2J\x1b[1;1HVisible', 40, 12)
check(lines[0] == 'Visible', 'OSC title stripped')

lines = render_screen(b'\x1b[2J\x1b[1;1HOld\x1b[?1049h\x1b[1;1HNew', 40, 12)
check(lines[0] == 'New', 'alternate-screen reset')

lines = render_screen(b'\x1b[2J\x1b[1;1H12345\x1b[1;3HXY', 40, 12)
check(lines[0] == '12XY5', 'absolute cursor movement')

lines = render_screen(b'\x1b[2J\x1b[3;1HRetained\x1b[3;1HNew\x1b[0K', 40, 12)
check(lines[2] == 'New', 'erase to end')

lines = relevant_screen_lines(b'\x1b[2J\x1b[1;1Hline 43: potential bug\x1b[2;1Hmodel ready', limit=4)
check(len(lines) == 1 and 'line 43' in lines[0], 'review-focused bounded extraction')

print('PASS: 6 Freebuff VT screen assertions')
