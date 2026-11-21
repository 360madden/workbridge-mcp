#!/usr/bin/env python3
"""M6e: offline, pinned function-body continuity and direct-call edge audit.

Reports only static disassembly evidence from archived RIFT binaries. It does
not read live memory, validate native locator ownership or infer game behavior.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import struct
import sys

M6D_TOOL = Path(__file__).with_name("telemetry-locator-context.py")
M6C_TOOL = Path(__file__).with_name("telemetry-locator-xrefs.py")
ROOTS = frozenset(("ManagerRva", "PlayerSystemRva", "ClockRootRva"))
MAX_FUNCTION_BYTES = 8192
MAX_FUNCTION_PAIRS = 16
MAX_INSTRUCTIONS = 2048


class FunctionError(Exception):
    pass


def fail(code: str) -> None:
    raise FunctionError(code)


def import_pinned(path: Path, digest: str, module_name: str, maximum: int = 256 * 1024):
    sha_file(path, maximum, digest)
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        fail("M6E_MODULE_IMPORT")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha_file(path: Path, limit: int, expected: str) -> None:
    if len(expected) != 64 or any(x not in "0123456789abcdefABCDEF" for x in expected):
        fail("M6E_PIN_INVALID")
    try:
        before = path.lstat()
        if path.is_symlink() or not path.is_file() or not (0 < before.st_size <= limit):
            fail("M6E_SOURCE_INVALID")
        h = hashlib.sha256()
        with path.open("rb") as stream:
            for data in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(data)
        after = path.lstat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ):
            fail("M6E_SOURCE_CHANGED")
        if h.hexdigest() != expected.lower():
            fail("M6E_SOURCE_HASH")
    except FunctionError:
        raise
    except OSError:
        fail("M6E_SOURCE_UNAVAILABLE")


def positive_rva(text: str) -> int:
    if not isinstance(text, str) or not text.startswith("0x") or len(text) > 14:
        fail("M6E_RVA_INVALID")
    try:
        value = int(text, 16)
    except ValueError:
        fail("M6E_RVA_INVALID")
    if value <= 0 or value > 0xFFFFFFFF:
        fail("M6E_RVA_INVALID")
    return value


def verified_mask(ins, capstone) -> tuple[bytes, list[dict], int | None]:
    """Mask encoded relocatable operands only after raw-byte target verification.

    Capstone 5.0.7 occasionally reports disp_size=2 on a 66-prefixed RIP
    movdqa even though the encoded disp32 occupies four bytes. The actual
    four bytes and typed target must agree before that discrepancy is accepted.
    """
    raw = bytearray(ins.bytes)
    operands = ins.operands
    rip = [o for o in operands if (
        o.type == capstone.x86.X86_OP_MEM and
        o.mem.base == capstone.x86.X86_REG_RIP
    )]
    warnings = []
    call_target = None
    if rip:
        off = ins.disp_offset
        if (len(rip) != 1 or off < 1 or off + 4 > len(raw)
                or ins.modrm & 0xC7 != 0x05):
            fail("M6E_RIP_ENCODING_UNVERIFIED")
        displacement = struct.unpack_from("<i", raw, off)[0]
        if (displacement != rip[0].mem.disp or
                not 0 <= ins.address + ins.size + displacement < (1 << 32)):
            fail("M6E_RIP_TARGET_UNVERIFIED")
        if ins.disp_size != 4:
            warnings.append({
                "instructionRva": f"0x{ins.address:X}",
                "capstoneDeclaredDispSize": ins.disp_size,
                "independentlyVerifiedDispSize": 4,
                "kind": "capstone_disp_size_disagrees_with_encoded_rip_disp32",
            })
        raw[off:off + 4] = bytes(4)
    # Only directly encoded relative branch/call immediates may be normalized.
    is_call = ins.group(capstone.CS_GRP_CALL)
    is_jump = ins.group(capstone.CS_GRP_JUMP)
    directs = [o for o in operands if o.type == capstone.x86.X86_OP_IMM]
    if (is_call or is_jump) and directs:
        off, size = ins.imm_offset, ins.imm_size
        if len(directs) != 1 or size not in (1, 2, 4) or off < 1 or off + size > len(raw):
            fail("M6E_BRANCH_ENCODING_UNVERIFIED")
        encoded = int.from_bytes(raw[off:off + size], "little", signed=True)
        if ins.address + ins.size + encoded != directs[0].imm:
            fail("M6E_BRANCH_TARGET_UNVERIFIED")
        if is_call:
            call_target = directs[0].imm
        raw[off:off + size] = bytes(size)
    return bytes(raw), warnings, call_target


def scan_function(image: Path, pe: dict, ranges: dict[int, int],
                  capstone, start: int) -> dict:
    if start not in ranges:
        fail("M6E_FUNCTION_NOT_IN_PDATA")
    end = ranges[start]
    sec = next((row for row in pe["sections"] if row["name"] == ".text"), None)
    if sec is None or not (sec["rva"] <= start < end <= sec["rva"] + sec["rawSize"]):
        fail("M6E_FUNCTION_OUTSIDE_TEXT")
    size = end - start
    if not 0 < size <= MAX_FUNCTION_BYTES:
        fail("M6E_FUNCTION_SIZE")
    with image.open("rb") as f:
        f.seek(sec["rawOffset"] + start - sec["rva"])
        code = f.read(size)
    if len(code) != size:
        fail("M6E_FUNCTION_TRUNCATED")
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    instructions = list(md.disasm(code, start))
    if not instructions or len(instructions) > MAX_INSTRUCTIONS:
        fail("M6E_INSTRUCTION_LIMIT")
    warnings = []
    calls = []
    normalized = []
    pos = 0
    for ins in instructions:
        if ins.address != start + pos or not 0 < ins.size <= 15:
            fail("M6E_FUNCTION_DISCONTIGUOUS")
        masked, unusual, target = verified_mask(ins, capstone)
        warnings.extend(unusual)
        normalized.append({"offset": pos, "bytes": masked.hex(), "mnemonic": ins.mnemonic})
        if target is not None:
            calls.append({"offset": pos, "target": target})
        pos += ins.size
    if pos != len(code):
        fail("M6E_FUNCTION_INCOMPLETE")
    return {
        "start": start,
        "size": size,
        "instructions": normalized,
        "calls": calls,
        "metadataWarnings": warnings,
        "hash": hashlib.sha256(
            json.dumps(normalized, sort_keys=True, separators=(",", ":")).encode("ascii")
        ).hexdigest(),
    }


def compare_functions(old: dict, new: dict, targets: dict[int, int]) -> dict:
    a, b = old["instructions"], new["instructions"]
    mismatches = [
        {"index": i, "oldOffset": a[i]["offset"], "newOffset": b[i]["offset"]}
        for i in range(min(len(a), len(b))) if a[i] != b[i]
    ]
    if len(a) != len(b):
        mismatches.append({"kind": "instruction_count", "old": len(a), "new": len(b)})
    old_calls, new_calls = old["calls"], new["calls"]
    matched_sites = [
        (o, n) for o in old_calls for n in new_calls if o["offset"] == n["offset"]
    ]
    known_edges = []
    for before, after in matched_sites:
        if before["target"] in targets:
            known_edges.append({
                "callOffset": before["offset"],
                "oldCalleeRva": f"0x{before['target']:X}",
                "newCalleeRva": f"0x{after['target']:X}",
                "matchesMappedCallee": targets[before["target"]] == after["target"],
            })
    return {
        "oldFunctionRva": f"0x{old['start']:X}",
        "newFunctionRva": f"0x{new['start']:X}",
        "oldBytes": old["size"],
        "newBytes": new["size"],
        "oldInstructions": len(a),
        "newInstructions": len(b),
        "normalizedBodyEqual": a == b,
        "oldNormalizedSha256": old["hash"],
        "newNormalizedSha256": new["hash"],
        "instructionDifferences": len(mismatches),
        "differenceSamples": mismatches[:8],
        "oldDirectCalls": len(old_calls),
        "newDirectCalls": len(new_calls),
        "matchedDirectCallOffsets": len(matched_sites),
        "knownMappedCalleeEdges": known_edges,
        "oldDecoderMetadataWarnings": old["metadataWarnings"],
        "newDecoderMetadataWarnings": new["metadataWarnings"],
        "nativeRuntimeQualified": False,
    }


def root_pairs(m6d_report: dict) -> tuple[list[tuple[str, int, int]], dict[int, int]]:
    roots = [row for row in m6d_report["locators"] if row["name"] in ROOTS]
    if len(roots) != 3 or {row["name"] for row in roots} != ROOTS:
        fail("M6E_ROOTS_INVALID")
    pairs = []
    mapping = {}
    reverse = {}
    for row in roots:
        if (row.get("runtimeQualified") is not False or
                row.get("matchedSampleShapes") != row.get("oldSamples") or
                row.get("matchedSampleShapes") != row.get("newSamples") or
                row.get("unmatchedOldShapes") != 0 or
                row.get("unmatchedNewShapes") != 0):
            fail("M6E_ROOT_SAMPLE_EVIDENCE")
        for pair in row["pairs"]:
            if pair.get("uniquelyPairedInSample") is not True:
                fail("M6E_PAIR_AMBIGUOUS")
            old = positive_rva(pair["oldFunctionRva"])
            new = positive_rva(pair["newFunctionRva"])
            if ((old in mapping and mapping[old] != new) or
                    (new in reverse and reverse[new] != old)):
                fail("M6E_PAIR_CONFLICT")
            mapping[old], reverse[new] = new, old
            pairs.append((row["name"], old, new))
    if len(mapping) > MAX_FUNCTION_PAIRS or len(mapping) < 3:
        fail("M6E_PAIR_LIMIT")
    return pairs, mapping


def audit(args: argparse.Namespace) -> dict:
    if socket.gethostname().upper() != "AMD-DESKTOP" or args.expect_host.upper() != "AMD-DESKTOP":
        fail("M6E_WRONG_HOST")
    own_path = Path(__file__)
    own_sha = hashlib.sha256(own_path.read_bytes()).hexdigest()
    sha_file(own_path, 256 * 1024, own_sha)
    sha_file(Path(args.report), 256 * 1024, args.expected_report_sha)
    m6d_report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    if (m6d_report.get("schema") != "workbridge.telemetry-xref-context.v1" or
            m6d_report.get("host") != "AMD-DESKTOP" or
            m6d_report.get("summary", {}).get("nativeLocatorsQualified") != 0):
        fail("M6E_REPORT_SCHEMA")
    sources = m6d_report["sources"]
    if sources["m6dToolSha256"] != args.expected_m6d_tool_sha.lower():
        fail("M6E_M6D_TOOL_PIN")
    m6d = import_pinned(M6D_TOOL, sources["m6dToolSha256"], "m6e_m6d")
    m6c = import_pinned(M6C_TOOL, sources["m6cToolSha256"], "m6e_m6c")
    capstone = m6c.import_capstone()
    old_image, new_image = Path(args.before), Path(args.after)
    rre_file = Path(args.workspace_root) / "rre" / "tools" / "rift_update_analyzer.py"
    pins = [
        (old_image, sources["beforeSha256"], m6c.MAX_SOURCE_BYTES),
        (new_image, sources["afterSha256"], m6c.MAX_SOURCE_BYTES),
        (Path(args.reader), sources["telemetryReaderSha256"], 256 * 1024),
        (M6C_TOOL.with_name("telemetry-locator-drift.py"), sources["staticAuditHelperSha256"], 256 * 1024),
        (rre_file, sources["rreParserSha256"], 256 * 1024),
        (M6C_TOOL, sources["m6cToolSha256"], 256 * 1024),
        (M6D_TOOL, sources["m6dToolSha256"], 256 * 1024),
    ]
    for path, hash_hex, limit in pins:
        sha_file(path, limit, hash_hex)
    rre = import_pinned(rre_file, sources["rreParserSha256"], "m6e_rre")
    old_pe = rre.inspect_pe(old_image, old_image.stat().st_size)
    new_pe = rre.inspect_pe(new_image, new_image.stat().st_size)
    ranges_old = m6d.function_ranges(old_image, old_pe, m6c)
    ranges_new = m6d.function_ranges(new_image, new_pe, m6c)
    pairs, mapping = root_pairs(m6d_report)
    old_cache, new_cache = {}, {}
    functions = []
    for old_start, new_start in sorted(mapping.items()):
        old = old_cache.setdefault(old_start, scan_function(
            old_image, old_pe, ranges_old, capstone, old_start))
        new = new_cache.setdefault(new_start, scan_function(
            new_image, new_pe, ranges_new, capstone, new_start))
        functions.append(compare_functions(old, new, mapping))
    for row in functions:
        row["rootNames"] = sorted({
            name for name, old, new in pairs
            if old == positive_rva(row["oldFunctionRva"]) and new == positive_rva(row["newFunctionRva"])
        })
    # The saved witness cannot infer runtime pointer ownership.
    if any(edge["matchesMappedCallee"] is False for row in functions
           for edge in row["knownMappedCalleeEdges"]):
        fail("M6E_KNOWN_CALLEE_MAPPING_MISMATCH")
    sha_file(own_path, 256 * 1024, own_sha)
    sha_file(Path(args.report), 256 * 1024, args.expected_report_sha)
    for path, sha, limit in pins:
        sha_file(path, limit, sha)
    return {
        "schema": "workbridge.telemetry-function-relations.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": socket.gethostname().upper(),
        "sources": {
            **sources,
            "m6dReportSha256": args.expected_report_sha.lower(),
            "m6eToolSha256": own_sha,
        },
        "method": {
            "scope": "seven .pdata-constrained function pairs selected by pinned M6d root samples",
            "normalization": "decoded RIP disp32 plus validated direct relative call/jump immediate only",
            "metadataException": "Capstone disp_size may be inconsistent for prefixed RIP form; independently verify 4 actual bytes and typed target",
            "crossRootEdges": "only explicitly mapped function-start targets; all other calls unresolved",
            "allStatic": True,
            "runtimeMemoryRead": False,
        },
        "functions": functions,
        "summary": {
            "rootLocatorKinds": len(ROOTS),
            "uniqueFunctionPairs": len(functions),
            "oldInstructions": sum(x["oldInstructions"] for x in functions),
            "newInstructions": sum(x["newInstructions"] for x in functions),
            "identicalNormalizedFunctionBodies": sum(x["normalizedBodyEqual"] for x in functions),
            "differingFunctionBodies": sum(not x["normalizedBodyEqual"] for x in functions),
            "instructionDifferences": sum(x["instructionDifferences"] for x in functions),
            "oldDecoderMetadataWarnings": sum(len(x["oldDecoderMetadataWarnings"]) for x in functions),
            "newDecoderMetadataWarnings": sum(len(x["newDecoderMetadataWarnings"]) for x in functions),
            "knownMappedDirectCallEdges": sum(len(x["knownMappedCalleeEdges"]) for x in functions),
            "nativeLocatorsQualified": 0,
            "liveTelemetryVerified": False,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-host", required=True)
    parser.add_argument("--workspace-root", default=r"C:\work")
    parser.add_argument("--report", required=True)
    parser.add_argument("--expected-report-sha", required=True)
    parser.add_argument("--expected-m6d-tool-sha", required=True)
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--reader", required=True)
    parser.add_argument("--output", help="Only create a new JSON report, never overwrite")
    args = parser.parse_args(argv)
    try:
        if args.output:
            out = Path(args.output)
            if out.suffix.lower() != ".json" or out.is_symlink() or out.exists():
                fail("M6E_OUTPUT_EXISTS")
        result = audit(args)
        encoded = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.output:
            try:
                with Path(args.output).open("x", encoding="utf-8", newline="\n") as stream:
                    stream.write(encoded)
            except FileExistsError:
                fail("M6E_OUTPUT_EXISTS")
        sys.stdout.write(encoded)
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "code": str(exc) if isinstance(exc, FunctionError) else "M6E_AUDIT_FAILED",
            "nativeLocatorsQualified": 0,
        }), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
