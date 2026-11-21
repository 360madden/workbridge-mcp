#!/usr/bin/env python3
"""M6d: SHA-pinned offline cross-build RIFT instruction-context witness audit.

Checks only the 52 samples already preserved by M6c. The mask removes a
verified RIP-relative displacement, not unrelated operand bytes. Similar
instruction shapes do NOT establish live pointer ownership or gameplay state.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import struct
import sys

TOOL = Path(__file__).with_name("telemetry-locator-xrefs.py")
MAX_REPORT_BYTES = 256 * 1024
EXPECTED_LOCATORS = frozenset((
    "ManagerRva", "PlayerSystemRva", "HealthSelectorRva", "NameSelectorRva",
    "LocalizedNameSelectorRva", "AlternateSelectorRva", "SelectionSelectorRva",
    "PositionSelectorRva", "ClockRootRva",
))


class ContextError(Exception):
    pass


def fail(code: str) -> None:
    raise ContextError(code)


def load_pinned_source(path: Path, sha: str, maximum: int) -> bytes:
    if len(sha) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in sha):
        fail("M6D_PIN_INVALID")
    try:
        before = path.lstat()
        if path.is_symlink() or not path.is_file() or not (0 < before.st_size <= maximum):
            fail("M6D_SOURCE_INVALID")
        raw = path.read_bytes()
        after = path.lstat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ):
            fail("M6D_SOURCE_CHANGED")
        if hashlib.sha256(raw).hexdigest() != sha.lower():
            fail("M6D_SOURCE_HASH")
        return raw
    except ContextError:
        raise
    except OSError:
        fail("M6D_SOURCE_UNAVAILABLE")


def load_xref_module(expected: str):
    load_pinned_source(TOOL, expected, 256 * 1024)
    spec = importlib.util.spec_from_file_location("workbridge_m6d_pinned_m6c", TOOL)
    if spec is None or spec.loader is None:
        fail("M6D_XREF_IMPORT")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def function_ranges(image: Path, pe: dict, xref) -> dict[int, int]:
    pdata = xref.read_section(image, xref.section(pe, ".pdata"), xref.MAX_PDATA_BYTES)
    ranges = {}
    for start, end, _unwind in struct.iter_unpack("<III", pdata[:len(pdata) // 12 * 12]):
        if start >= end or start in ranges:
            continue
        ranges[start] = end
    return ranges


def extract_shape(image: Path, pe: dict, capstone, ranges: dict[int, int],
                  row: dict) -> dict:
    try:
        start = int(row["functionRva"], 16)
        ip = int(row["instructionRva"], 16)
        target = int(row["referencedRva"], 16)
        original = bytes.fromhex(row["instructionBytes"])
    except (KeyError, TypeError, ValueError):
        fail("M6D_WITNESS_SCHEMA")
    tx = next((s for s in pe["sections"] if s["name"] == ".text"), None)
    if tx is None:
        fail("M6D_TEXT_MISSING")
    end = ranges.get(start)
    if (end is None or start > ip or ip + len(original) > end
            or len(original) < 2 or len(original) > 15
            or ip < tx["rva"] or ip + len(original) > tx["rva"] + tx["rawSize"]):
        fail("M6D_WITNESS_RANGE")
    with image.open("rb") as stream:
        stream.seek(tx["rawOffset"] + ip - tx["rva"])
        actual = stream.read(len(original))
    if actual != original:
        fail("M6D_WITNESS_BYTES")
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    instructions = list(md.disasm(actual, ip, count=1))
    if len(instructions) != 1 or instructions[0].size != len(actual):
        fail("M6D_WITNESS_DECODE")
    ins = instructions[0]
    valid = any(
        op.type == capstone.x86.X86_OP_MEM
        and op.mem.base == capstone.x86.X86_REG_RIP
        and ins.address + ins.size + op.mem.disp == target
        for op in ins.operands
    )
    offset, length = ins.disp_offset, ins.disp_size
    if not valid or length != 4 or offset < 1 or offset + length > len(actual):
        fail("M6D_WITNESS_RIP_DISPLACEMENT")
    if ins.mnemonic != row.get("mnemonic") or ins.op_str != row.get("operands"):
        fail("M6D_WITNESS_TEXT")
    masked = actual[:offset] + b"\0" * length + actual[offset + length:]
    return {
        "functionRva": f"0x{start:X}",
        "instructionRva": f"0x{ip:X}",
        "functionOffset": ip - start,
        "instructionLength": len(actual),
        "mnemonic": ins.mnemonic,
        "maskedInstructionSha256": hashlib.sha256(masked).hexdigest(),
        "targetRva": f"0x{target:X}",
    }


def signature(row: dict) -> tuple:
    return (row["functionOffset"], row["instructionLength"],
            row["mnemonic"], row["maskedInstructionSha256"])


def pair_samples(old: list[dict], new: list[dict]) -> dict:
    """Pair exact instruction signatures as a multiset, not by sample order."""
    old_map = Counter(signature(x) for x in old)
    new_map = Counter(signature(x) for x in new)
    matched = sum((old_map & new_map).values())
    pairs = []
    for sig in sorted(old_map.keys() & new_map.keys()):
        olds = [x for x in old if signature(x) == sig]
        news = [x for x in new if signature(x) == sig]
        # Duplicate identical signatures cannot establish one-to-one identity.
        for before, after in zip(olds, news):
            pairs.append({
                "oldFunctionRva": before["functionRva"],
                "newFunctionRva": after["functionRva"],
                "functionOffset": before["functionOffset"],
                "mnemonic": before["mnemonic"],
                "normalizedInstructionHash": before["maskedInstructionSha256"],
                "uniquelyPairedInSample": len(olds) == 1 and len(news) == 1,
            })
    return {
        "matchedSampleShapes": matched,
        "oldSamples": len(old),
        "newSamples": len(new),
        "unmatchedOldShapes": len(old) - matched,
        "unmatchedNewShapes": len(new) - matched,
        "uniquelyPairedSampleShapes": sum(x["uniquelyPairedInSample"] for x in pairs),
        "pairs": pairs,
    }


def audit(args: argparse.Namespace) -> dict:
    if socket.gethostname().upper() != "AMD-DESKTOP" or args.expect_host.upper() != "AMD-DESKTOP":
        fail("M6D_WRONG_HOST")
    report_bytes = load_pinned_source(Path(args.report), args.expected_report_sha, MAX_REPORT_BYTES)
    report = json.loads(report_bytes)
    if (report.get("schema") != "workbridge.telemetry-pdata-xrefs.v1"
            or report.get("host") != "AMD-DESKTOP"
            or report.get("summary", {}).get("qualifiedNativeLocators") != 0
            or report.get("summary", {}).get("allNineStaticReferenceCountsMatch") is not True
            or len(report.get("locators", [])) != 9
            or {row.get("name") for row in report["locators"]} != EXPECTED_LOCATORS):
        fail("M6D_REPORT_SCHEMA")
    sources = report["sources"]
    if sources["xrefToolSha256"].lower() != args.expected_xref_tool_sha.lower():
        fail("M6D_TOOL_PIN")
    xref = load_xref_module(args.expected_xref_tool_sha)
    capstone = xref.import_capstone()
    if sources.get("capstoneVersion") != capstone.__version__:
        fail("M6D_CAPSTONE_PIN")

    old_file = Path(args.before)
    new_file = Path(args.after)
    rre_file = Path(args.workspace_root) / "rre" / "tools" / "rift_update_analyzer.py"
    pins = [
        (old_file, sources["beforeSha256"], xref.MAX_SOURCE_BYTES),
        (new_file, sources["afterSha256"], xref.MAX_SOURCE_BYTES),
        (Path(args.reader), sources["telemetryReaderSha256"], 256 * 1024),
        (TOOL.with_name("telemetry-locator-drift.py"), sources["staticAuditHelperSha256"], 256 * 1024),
        (rre_file, sources["rreParserSha256"], 256 * 1024),
        (TOOL, sources["xrefToolSha256"], 256 * 1024),
    ]
    for path, expected, limit in pins:
        xref.sha_file(path, limit, expected)
    spec = importlib.util.spec_from_file_location("workbridge_m6d_pinned_rre", rre_file)
    if spec is None or spec.loader is None:
        fail("M6D_RRE_IMPORT")
    rre = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rre)
    old_pe = rre.inspect_pe(old_file, old_file.stat().st_size)
    new_pe = rre.inspect_pe(new_file, new_file.stat().st_size)
    old_ranges = function_ranges(old_file, old_pe, xref)
    new_ranges = function_ranges(new_file, new_pe, xref)
    rows = []
    for locator in report["locators"]:
        if (locator.get("candidateRva") is None
                or locator.get("equalReferenceCounts") is not True
                or locator.get("nativeLocatorQualified") is not False
                or not isinstance(locator.get("historicalSamples"), list)
                or not isinstance(locator.get("newSamples"), list)):
            fail("M6D_REPORT_LOCATOR")
        for sample in locator["historicalSamples"]:
            if sample.get("referencedRva") != locator["historicalRva"]:
                fail("M6D_REPORT_TARGET_MISMATCH")
        for sample in locator["newSamples"]:
            if sample.get("referencedRva") != locator["candidateRva"]:
                fail("M6D_REPORT_TARGET_MISMATCH")
        old = [extract_shape(old_file, old_pe, capstone, old_ranges, sample)
               for sample in locator["historicalSamples"]]
        new = [extract_shape(new_file, new_pe, capstone, new_ranges, sample)
               for sample in locator["newSamples"]]
        if not old or not new or len(old) > xref.MAX_SAMPLES or len(new) > xref.MAX_SAMPLES:
            fail("M6D_SAMPLE_COUNT")
        paired = pair_samples(old, new)
        rows.append({"name": locator["name"],
                     "historicalRva": locator["historicalRva"],
                     "candidateRva": locator["candidateRva"],
                     **paired, "runtimeQualified": False})
    # Inputs remain immutable throughout the inspection, including report bytes.
    load_pinned_source(Path(args.report), args.expected_report_sha, MAX_REPORT_BYTES)
    for path, expected, limit in pins:
        xref.sha_file(path, limit, expected)
    return {
        "schema": "workbridge.telemetry-xref-context.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": socket.gethostname().upper(),
        "sources": {
            "m6cReportSha256": args.expected_report_sha.lower(),
            "m6cToolSha256": args.expected_xref_tool_sha.lower(),
            "beforeSha256": sources["beforeSha256"],
            "afterSha256": sources["afterSha256"],
            "rreParserSha256": sources["rreParserSha256"],
            "telemetryReaderSha256": sources["telemetryReaderSha256"],
            "staticAuditHelperSha256": sources["staticAuditHelperSha256"],
            "capstoneVersion": capstone.__version__,
            "m6dToolSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        },
        "method": {
            "scope": "bounded preserved M6c .pdata witnesses only",
            "mask": "Capstone-verified four-byte RIP displacement only",
            "pairing": "exact instruction-shape multiset; never RVA order or nearest RVA",
            "limits": "sampling bias, repeated signatures, instruction similarity is not code ownership",
            "runtimeMemoryRead": False,
            "currentPlayerBound": False,
        },
        "locators": rows,
        "summary": {
            "locators": len(rows),
            "matchedSampleShapes": sum(x["matchedSampleShapes"] for x in rows),
            "unmatchedOldShapes": sum(x["unmatchedOldShapes"] for x in rows),
            "unmatchedNewShapes": sum(x["unmatchedNewShapes"] for x in rows),
            "uniqueSamplePairs": sum(x["uniquelyPairedSampleShapes"] for x in rows),
            "nativeLocatorsQualified": 0,
            "runtimeOwnershipVerified": False,
            "livePlayerTelemetryVerified": False,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-host", required=True)
    parser.add_argument("--workspace-root", default=r"C:\work")
    parser.add_argument("--report", required=True)
    parser.add_argument("--expected-report-sha", required=True)
    parser.add_argument("--expected-xref-tool-sha", required=True)
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--reader", required=True)
    parser.add_argument("--output", help="New JSON report only; never overwrite")
    args = parser.parse_args(argv)
    try:
        if args.output:
            out = Path(args.output)
            if out.suffix.lower() != ".json" or out.exists() or out.is_symlink():
                fail("M6D_OUTPUT_EXISTS")
        result = audit(args)
        encoded = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.output:
            try:
                with Path(args.output).open("x", encoding="utf-8", newline="\n") as stream:
                    stream.write(encoded)
            except FileExistsError:
                fail("M6D_OUTPUT_EXISTS")
        sys.stdout.write(encoded)
        return 0
    except Exception as exc:
        code = str(exc) if isinstance(exc, ContextError) else "M6D_AUDIT_FAILED"
        print(json.dumps({"ok": False, "code": code, "nativeLocatorsQualified": 0}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
