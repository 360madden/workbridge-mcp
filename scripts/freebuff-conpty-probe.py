"""Bounded Freebuff ConPTY validation. Fixed local commands only; no AI tasks."""
import ctypes as C
from ctypes import wintypes as W
import json
import os
import re
import sys
import threading
import time
from subprocess import list2cmdline

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
MAX_CAPTURE = 90_000

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
    elif mode in ("freebuff-local-help", "freebuff-idle"):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        probe_dir = os.path.join(repo_root, "temp",
                                 "wb-freebuff-conpty-session-20261102")
        if os.path.exists(probe_dir):
            raise FileExistsError("Refusing to reuse a preexisting Freebuff probe directory")
        os.mkdir(probe_dir)
        argv = [freebuff, "--cwd", probe_dir]
    else:
        raise ValueError("Allowed: cmd, freebuff-help, freebuff-local-help, freebuff-idle")
    if not os.path.isfile(argv[0]):
        raise FileNotFoundError(argv[0])

    handles = []
    attr_list = None
    attr_initialized = False
    hpc = C.c_void_p()
    child = PROCESS_INFORMATION()
    hpc_open = False
    chunks = []
    captured = 0
    before_chars = None
    typed_chars = None
    after_enter_chars = None
    input_written = False
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
        nonlocal captured
        buf = C.create_string_buffer(4096)
        size = W.DWORD()
        while True:
            if not k32.ReadFile(output_handle, buf, 4096, C.byref(size), None):
                break
            if size.value == 0:
                break
            if captured < MAX_CAPTURE:
                portion = bytes(buf.raw[:min(size.value, MAX_CAPTURE - captured)])
                chunks.append(portion)
                captured += len(portion)

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
        if mode in ("freebuff-local-help", "freebuff-idle"):
            time.sleep(3.2)
            before_chars = captured
            if mode == "freebuff-local-help":
                written = W.DWORD()
                text_data = C.create_string_buffer(b"/help")
                check(k32.WriteFile(input_write, text_data, 5, C.byref(written), None),
                      "WriteFile Freebuff local text")
                input_written = written.value == 5
            time.sleep(1.0)
            typed_chars = captured
            if mode == "freebuff-local-help":
                enter_data = C.create_string_buffer(b"\r")
                check(k32.WriteFile(input_write, enter_data, 1, C.byref(written), None),
                      "WriteFile Freebuff local Enter")
                input_written = input_written and written.value == 1
            time.sleep(3.0)
            after_enter_chars = captured
        result = k32.WaitForSingleObject(child.hProcess, 6000 if mode != "freebuff-local-help" else 100)
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
        if probe_dir and os.path.isdir(probe_dir) and not os.listdir(probe_dir):
            os.rmdir(probe_dir)

    raw_bytes = b"".join(chunks)
    raw = raw_bytes.decode("utf-8", errors="replace")
    enter_delta = (raw_bytes[typed_chars:after_enter_chars].decode("utf-8", errors="replace")
                   if typed_chars is not None and after_enter_chars is not None else "")
    clean_enter_delta = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", enter_delta)
    help_lines = [line.strip()[:140] for line in clean_enter_delta.splitlines()
                  if re.search(r"\bhelp\b|\bshortcuts\b|\bcommands\b|\bkeyboard\b", line, re.I)]
    no_escape = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", raw)
    result = {
        "mode": mode,
        "process_exited_naturally": process_exited,
        "captured_chars": len(raw),
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
