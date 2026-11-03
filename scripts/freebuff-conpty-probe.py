"""Bounded Freebuff ConPTY validation. Fixed local commands only; no AI tasks."""
import ctypes as C
from collections import deque
from ctypes import wintypes as W
import json
import os
import re
import shutil
import sys
import threading
import time
from subprocess import list2cmdline
from freebuff_vt_screen import relevant_screen_lines, render_screen

if os.name != "nt":
    raise SystemExit("Windows only")

class COORD(C.Structure):
    _fields_ = [("X", C.c_short), ("Y", C.c_short)]

class STARTUPINFO(C.Structure):
    _fields_ = [
        ("cb", W.DWORD), ("lpReserved", W.LPWSTR), ("lpDesktop", W.LPWSTR),
        ("lpTitle", W.LPWSTR), ("dwX", W.DWORD), ("dwY", W.DWORD),
        ("dwXSize", W.DWORD), ("dwYSize", W.DWORD),
        ("dwXCountChars", W.DWORD), ("dwYCountChars", W.DWORD),
        ("dwFillAttribute", W.DWORD), ("dwFlags", W.DWORD),
        ("wShowWindow", W.WORD), ("cbReserved2", W.WORD),
        ("lpReserved2", C.POINTER(C.c_ubyte)),
        ("hStdInput", W.HANDLE), ("hStdOutput", W.HANDLE), ("hStdError", W.HANDLE),
    ]

class STARTUPINFOEX(C.Structure):
    _fields_ = [("StartupInfo", STARTUPINFO), ("lpAttributeList", C.c_void_p)]

class PROCESS_INFORMATION(C.Structure):
    _fields_ = [("hProcess", W.HANDLE), ("hThread", W.HANDLE),
                ("dwProcessId", W.DWORD), ("dwThreadId", W.DWORD)]

k32 = C.WinDLL("kernel32", use_last_error=True)
k32.CreatePipe.argtypes = [C.POINTER(W.HANDLE), C.POINTER(W.HANDLE),
                            C.c_void_p, W.DWORD]
k32.CreatePipe.restype = W.BOOL
k32.CreatePseudoConsole.argtypes = [COORD, W.HANDLE, W.HANDLE,
                                     W.DWORD, C.POINTER(C.c_void_p)]
k32.CreatePseudoConsole.restype = C.c_long
k32.ClosePseudoConsole.argtypes = [C.c_void_p]
k32.ClosePseudoConsole.restype = None
k32.InitializeProcThreadAttributeList.argtypes = [
    C.c_void_p, W.DWORD, W.DWORD, C.POINTER(C.c_size_t)]
k32.InitializeProcThreadAttributeList.restype = W.BOOL
k32.UpdateProcThreadAttribute.argtypes = [
    C.c_void_p, W.DWORD, C.c_size_t, C.c_void_p,
    C.c_size_t, C.c_void_p, C.c_void_p]
k32.UpdateProcThreadAttribute.restype = W.BOOL
k32.DeleteProcThreadAttributeList.argtypes = [C.c_void_p]
k32.DeleteProcThreadAttributeList.restype = None
k32.CreateProcessW.argtypes = [
    W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p, W.BOOL,
    W.DWORD, C.c_void_p, W.LPCWSTR,
    C.POINTER(STARTUPINFOEX), C.POINTER(PROCESS_INFORMATION)]
k32.CreateProcessW.restype = W.BOOL
k32.WaitForSingleObject.argtypes = [W.HANDLE, W.DWORD]
k32.WaitForSingleObject.restype = W.DWORD
k32.CloseHandle.argtypes = [W.HANDLE]
k32.CloseHandle.restype = W.BOOL
k32.GetStdHandle.argtypes = [W.DWORD]
k32.GetStdHandle.restype = W.HANDLE
k32.SetStdHandle.argtypes = [W.DWORD, W.HANDLE]
k32.SetStdHandle.restype = W.BOOL
k32.ReadFile.argtypes = [W.HANDLE, C.c_void_p, W.DWORD,
                         C.POINTER(W.DWORD), C.c_void_p]
k32.ReadFile.restype = W.BOOL
k32.WriteFile.argtypes = [W.HANDLE, C.c_void_p, W.DWORD,
                          C.POINTER(W.DWORD), C.c_void_p]
k32.WriteFile.restype = W.BOOL

ATTR_PSEUDOCONSOLE = 0x00020016
EXTENDED_STARTUPINFO_PRESENT = 0x00080000
WAIT_TIMEOUT = 258
MAX_CAPTURE = 180_000

def check(value, what):
    if not value:
        raise OSError(C.get_last_error(), what)

def run_test(mode):
    root = os.path.join(os.environ["SystemRoot"], "System32")
    freebuff = os.path.expandvars(r"%USERPROFILE%\.config\manicode\codebuff.exe")
    probe_dir = None
    if mode == "cmd":
        argv = [os.path.join(root, "cmd.exe"), "/c", "ver"]
    elif mode == "freebuff-help":
        argv = [freebuff, "--help"]
    elif mode == "freebuff-review-replay":
        # Reopen the latest chat without sending any model prompt. Verify topic
        # before returning any visible content; never assume last chat identity.
        argv = [freebuff, "--continue"]
    elif mode in ("freebuff-local-help", "freebuff-local-model", "freebuff-idle",
                  "freebuff-review-pilot"):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        probe_name = ("wb-freebuff-review-session-20261102" if mode == "freebuff-review-pilot"
                      else "wb-freebuff-conpty-session-20261102")
        probe_dir = os.path.join(repo_root, "temp", probe_name)
        if os.path.exists(probe_dir):
            raise FileExistsError("Refusing to reuse a preexisting Freebuff probe directory")
        os.mkdir(probe_dir)
        if mode == "freebuff-review-pilot":
            source = os.path.join(repo_root, "desktop", "Workbridge.ControlCenter",
                                  "BoundedLineReader.cs")
            shutil.copyfile(source, os.path.join(probe_dir, "BoundedLineReader.cs"))
        argv = [freebuff, "--cwd", probe_dir]
    else:
        raise ValueError("Allowed: cmd, freebuff-help, freebuff-local-help, freebuff-local-model, freebuff-idle, freebuff-review-pilot, freebuff-review-replay")
    if not os.path.isfile(argv[0]):
        raise FileNotFoundError(argv[0])

    handles = []
    attr_list = None
    attr_initialized = False
    hpc = C.c_void_p()
    child = PROCESS_INFORMATION()
    hpc_open = False
    chunks = deque()
    tail_bytes = 0
    captured = 0
    before_chars = None
    typed_chars = None
    after_enter_chars = None
    input_written = False
    pilot_prompt = None
    pilot_response_bytes = None
    pilot_finished_marker_seen = False
    pilot_elapsed_seconds = None
    screen_before_shutdown = None
    screen_received_bytes = None
    process_exited = False
    owned_process_stopped = False
    reader = None

    def close(handle):
        value = handle.value if hasattr(handle, 'value') else handle
        if value:
            k32.CloseHandle(W.HANDLE(value))
            if hasattr(handle, 'value'):
                handle.value = None

    def collect(output_handle):
        nonlocal captured, tail_bytes
        buf = C.create_string_buffer(4096)
        size = W.DWORD()
        while True:
            if not k32.ReadFile(output_handle, buf, 4096, C.byref(size), None):
                break
            if size.value == 0:
                break
            portion = bytes(buf.raw[:size.value])
            captured += len(portion)
            chunks.append(portion)
            tail_bytes += len(portion)
            # Keep the most recent terminal updates, never unbounded history.
            while tail_bytes > MAX_CAPTURE:
                excess = tail_bytes - MAX_CAPTURE
                oldest = chunks.popleft()
                if len(oldest) <= excess:
                    tail_bytes -= len(oldest)
                else:
                    chunks.appendleft(oldest[excess:])
                    tail_bytes -= excess

    try:
        input_read, input_write = W.HANDLE(), W.HANDLE()
        output_read, output_write = W.HANDLE(), W.HANDLE()
        check(k32.CreatePipe(C.byref(input_read), C.byref(input_write), None, 0), "CreatePipe input")
        handles.extend([input_read, input_write])
        check(k32.CreatePipe(C.byref(output_read), C.byref(output_write), None, 0), "CreatePipe output")
        handles.extend([output_read, output_write])
        hr = k32.CreatePseudoConsole(COORD(120, 43), input_read, output_write, 0, C.byref(hpc))
        if hr != 0:
            raise OSError("CreatePseudoConsole HRESULT 0x%08x" % (hr & 0xFFFFFFFF))
        hpc_open = True
        required = C.c_size_t()
        k32.InitializeProcThreadAttributeList(None, 1, 0, C.byref(required))
        if not required.value:
            raise OSError("InitializeProcThreadAttributeList size returned zero")
        attr_list = C.create_string_buffer(required.value)
        check(k32.InitializeProcThreadAttributeList(attr_list, 1, 0, C.byref(required)),
              "InitializeProcThreadAttributeList")
        attr_initialized = True
        check(k32.UpdateProcThreadAttribute(attr_list, 0, ATTR_PSEUDOCONSOLE, hpc,
                                             C.sizeof(C.c_void_p), None, None),
              "UpdateProcThreadAttribute")
        startup = STARTUPINFOEX()
        startup.StartupInfo.cb = C.sizeof(STARTUPINFOEX)
        startup.lpAttributeList = C.cast(attr_list, C.c_void_p)
        cmdline = C.create_unicode_buffer(list2cmdline(argv))
        # Workbridge starts this Python host with redirected standard handles.
        # Win32 child creation can prefer those handles over ConPTY unless the
        # host clears them briefly. Only this disposable Python process changes.
        std_ids = [0xFFFFFFF6, 0xFFFFFFF5, 0xFFFFFFF4]
        originals = [k32.GetStdHandle(i) for i in std_ids]
        try:
            for i in std_ids:
                check(k32.SetStdHandle(i, W.HANDLE(0)), "SetStdHandle(NULL)")
            check(k32.CreateProcessW(None, cmdline, None, None, False,
                                     EXTENDED_STARTUPINFO_PRESENT, None,
                                     os.environ.get("TEMP", root),
                                     C.byref(startup), C.byref(child)),
                  "CreateProcessW")
        finally:
            for i, original in zip(std_ids, originals):
                k32.SetStdHandle(i, W.HANDLE(original))
        close(input_read)
        close(output_write)
        reader = threading.Thread(target=collect, args=(output_read,), daemon=True)
        reader.start()
        if mode == "freebuff-review-replay":
            time.sleep(5)
            screen_before_shutdown = b"".join(chunks)
            screen_received_bytes = captured
        if mode in ("freebuff-local-help", "freebuff-local-model", "freebuff-idle",
                    "freebuff-review-pilot"):
            time.sleep(3.2)
            before_chars = captured
            pilot_prompt = (
                b"Read BoundedLineReader.cs in this isolated folder only. "
                b"Review its correctness; do not modify files or run shell commands. "
                b"Give one concrete issue with a line number, or say NO_ISSUE. "
                b"Keep the reply under 150 words. End with the prefix REVIEW_END_ "
                b"immediately followed by the decimal sum of 17 and 24."
                if mode == "freebuff-review-pilot" else None)
            local_command = { "freebuff-local-help": b"/help",
                              "freebuff-local-model": b"/model",
                              "freebuff-review-pilot": pilot_prompt }.get(mode)
            if local_command:
                written = W.DWORD()
                text_data = C.create_string_buffer(local_command)
                check(k32.WriteFile(input_write, text_data, len(local_command), C.byref(written), None),
                      "WriteFile Freebuff local slash command")
                input_written = written.value == len(local_command)
            time.sleep(1.0)
            typed_chars = captured
            if local_command:
                enter_data = C.create_string_buffer(b"\r")
                check(k32.WriteFile(input_write, enter_data, 1, C.byref(written), None),
                      "WriteFile Freebuff local Enter")
                input_written = input_written and written.value == 1
            if mode == "freebuff-review-pilot":
                # Watch the rendered terminal for a marker not present verbatim
                # in the original prompt. This avoids treating echo as completion.
                began = time.monotonic()
                deadline = began + 105.0
                while time.monotonic() < deadline:
                    time.sleep(1.5)
                    visible = "\n".join(render_screen(b"".join(chunks)))
                    if "REVIEW_END_41" in visible:
                        pilot_finished_marker_seen = True
                        time.sleep(1.5)
                        break
                pilot_elapsed_seconds = round(time.monotonic() - began, 1)
                pilot_response_bytes = max(0, captured - typed_chars)
                screen_before_shutdown = b"".join(chunks)
                screen_received_bytes = captured
            else:
                time.sleep(3.0)
            after_enter_chars = captured
        result = k32.WaitForSingleObject(child.hProcess, 100 if mode in
                 ("freebuff-local-help", "freebuff-local-model", "freebuff-review-pilot") else 6000)
        process_exited = result == 0
        if result not in (0, WAIT_TIMEOUT):
            raise OSError("WaitForSingleObject result " + str(result))
    finally:
        if hpc_open:
            k32.ClosePseudoConsole(hpc)
        if child.hThread:
            close(child.hThread)
        if child.hProcess:
            owned_process_stopped = k32.WaitForSingleObject(child.hProcess, 1500) == 0
            close(child.hProcess)
        if attr_initialized:
            k32.DeleteProcThreadAttributeList(attr_list)
        for h in handles:
            close(h)
        if reader:
            reader.join(timeout=0.5)
        if probe_dir and os.path.isdir(probe_dir):
            if mode == "freebuff-review-pilot":
                # The directory is created exclusively for this test and never reused.
                shutil.rmtree(probe_dir)
            elif not os.listdir(probe_dir):
                os.rmdir(probe_dir)

    raw_bytes = screen_before_shutdown if screen_before_shutdown is not None else b"".join(chunks)
    raw = raw_bytes.decode("utf-8", errors="replace")
    snapshot_count = screen_received_bytes if screen_received_bytes is not None else captured
    tail_start = snapshot_count - len(raw_bytes)
    enter_delta = (raw_bytes[max(0, typed_chars - tail_start):
                             max(0, after_enter_chars - tail_start)].decode("utf-8", errors="replace")
                   if typed_chars is not None and after_enter_chars is not None else "")
    clean_enter_delta = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", enter_delta)
    help_lines = [line.strip()[:140] for line in clean_enter_delta.splitlines()
                  if re.search(r"\bhelp\b|\bshortcuts\b|\bcommands\b|\bkeyboard\b", line, re.I)]
    no_escape = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", raw)
    replay_topic_confirmed = (mode == "freebuff-review-replay" and
                              "BoundedLineReader" in raw)
    screen_lines = render_screen(raw_bytes) if mode in ("freebuff-review-replay", "freebuff-review-pilot") else []
    visible = [re.sub(r"\b[^\s@]+@[^\s@]+\b", "[redacted]", line.strip())
               for line in screen_lines if line.strip()]
    result = {
        "mode": mode,
        "process_exited_naturally": process_exited,
        "captured_chars": len(raw),
        "total_stream_bytes": captured,
        "rolling_tail_truncated": captured > MAX_CAPTURE,
        "windows_version_seen": "Microsoft Windows" in no_escape,
        "freebuff_usage_seen": "Usage: freebuff" in no_escape,
        "input_written": input_written,
        "freebuff_help_text_mentioned": "/help" in no_escape,
        "bytes_before_input": before_chars,
        "bytes_after_typing": typed_chars,
        "bytes_after_enter": after_enter_chars,
        "output_growth_after_enter": (after_enter_chars - typed_chars if typed_chars is not None and after_enter_chars is not None else None),
        "help_related_lines_after_enter": help_lines[:8],
        "help_overlay_verified": ("Keyboard shortcuts" in clean_enter_delta and
                                  "Close help" in clean_enter_delta),
        "model_menu_output_seen": bool(re.search(r"(?i)select|choose|model|flash|deepseek|available", clean_enter_delta)),
        "model_names_in_output": sorted(set(re.findall(
            r"(?i)deepseek|claude|gemini|gpt|qwen|flash|sonnet|opus", clean_enter_delta))),
        "review_prompt_sent": mode == "freebuff-review-pilot" and input_written,
        "review_output_after_enter_bytes": pilot_response_bytes,
        "review_final_marker_seen": pilot_finished_marker_seen,
        "review_observation_seconds": pilot_elapsed_seconds,
        "review_visible_lines": (relevant_screen_lines(raw_bytes)
                                 if mode == "freebuff-review-pilot" or replay_topic_confirmed else []),
        "review_visible_excerpt": (visible[-22:] if mode == "freebuff-review-pilot" or replay_topic_confirmed else []),
        "replay_topic_confirmed": replay_topic_confirmed,
        "review_output_indicators": sorted(set(re.findall(
            r"(?i)NO_ISSUE|line\s+\d+|potential|bug|error|correctness|review|completed",
            clean_enter_delta)))[:10],
        "capture_bounded": len(raw) <= MAX_CAPTURE,
        "owned_process_stopped": owned_process_stopped,
        "probe_folder_cleaned": probe_dir is None or not os.path.isdir(probe_dir),
    }
    if mode == "cmd":
        result["capture_preview"] = repr(raw[:260])
    print(json.dumps(result))
    return result

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) == 2 else "cmd"
    data = run_test(mode)
    if mode == "cmd" and not data["windows_version_seen"]:
        sys.exit(2)
    if mode == "freebuff-help" and not data["freebuff_usage_seen"]:
        sys.exit(2)
    if mode == "freebuff-local-help" and not (
            data["input_written"] and data["help_overlay_verified"] and
            data["owned_process_stopped"] and data["probe_folder_cleaned"]):
        sys.exit(2)
    if mode == "freebuff-local-model" and not (
            data["input_written"] and data["model_menu_output_seen"] and
            data["owned_process_stopped"] and data["probe_folder_cleaned"]):
        sys.exit(2)
    if mode == "freebuff-review-pilot" and not (
            data["review_prompt_sent"] and data["owned_process_stopped"] and
            data["probe_folder_cleaned"] and data["review_final_marker_seen"]):
        sys.exit(2)
    if mode == "freebuff-review-replay" and not (
            data["replay_topic_confirmed"] and data["owned_process_stopped"]):
        sys.exit(2)
