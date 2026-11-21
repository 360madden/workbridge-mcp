#!/usr/bin/env python3
"""M6f: bounded, pinned offline inbound direct-call census for RIFT M6e roots.

Scans PE .pdata-bounded x86-64 instructions in two archived game binaries,
then pairs uniquely matching normalized *caller bodies* and mapped root-call
offsets. Reports static evidence only; never contacts a running game client.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import socket
import struct
import sys
import time

M6E_TOOL = Path(__file__).with_name("telemetry-function-relations.py")
M6C_TOOL = Path(__file__).with_name("telemetry-locator-xrefs.py")
MAX_REPORT_BYTES = 256 * 1024
MAX_FUNCTION_RANGES = 400_000
MAX_DIRECT_HITS = 20_000
MAX_CALLER_FUNCTIONS = 10_000
MAX_SAMPLE_PAIRS = 48
MIN_DECODE_RATIO = 0.995
DIRECT_TARGET = re.compile(r"0x[0-9a-f]+\Z", re.I)


class CallgraphError(Exception):
    pass


def fail(code: str) -> None:
    raise CallgraphError(code)


def pinned_bytes(path: Path, expected: str, limit: int) -> bytes:
    if not isinstance(expected, str) or re.fullmatch(r"[a-fA-F0-9]{64}", expected) is None:
        fail("M6F_INVALID_PIN")
    try:
        prior = path.lstat()
        if path.is_symlink() or not path.is_file() or not 0 < prior.st_size <= limit:
            fail("M6F_INVALID_SOURCE")
        payload = path.read_bytes()
        current = path.lstat()
        before_id = (prior.st_dev, prior.st_ino, prior.st_size, prior.st_mtime_ns, prior.st_ctime_ns)
        after_id = (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns)
        if before_id != after_id or len(payload) != prior.st_size:
            fail("M6F_CHANGED_SOURCE")
        if hashlib.sha256(payload).hexdigest() != expected.lower():
            fail("M6F_SOURCE_HASH")
        return payload
    except CallgraphError:
        raise
    except OSError:
        fail("M6F_SOURCE_UNAVAILABLE")


def load_module(path: Path, digest: str, name: str):
    pinned_bytes(path, digest, 256 * 1024)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        fail("M6F_MODULE_IMPORT")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validated_call(ip: int, raw: bytes, target: int, capstone, detail_decoder) -> None:
    """A concrete, typed x86-64 E8 rel32 call to the exact requested RVA."""
    if len(raw) != 5 or raw[0] != 0xE8:
        fail("M6F_DIRECT_CALL_ENCODING")
    displacement = struct.unpack_from("<i", raw, 1)[0]
    if ip + 5 + displacement != target:
        fail("M6F_DIRECT_CALL_TARGET")
    ins = list(detail_decoder.disasm(raw, ip, count=1))
    if (len(ins) != 1 or ins[0].size != 5 or ins[0].mnemonic != "call" or
            len(ins[0].operands) != 1 or
            ins[0].operands[0].type != capstone.x86.X86_OP_IMM or
            ins[0].operands[0].imm != target):
        fail("M6F_DIRECT_CALL_TYPED")


def census(image: Path, pe: dict, capstone, m6c, target_to_old: dict[int, int]) -> dict:
    tx, pd = m6c.section(pe, ".text"), m6c.section(pe, ".pdata")
    code = m6c.read_section(image, tx, m6c.MAX_TEXT_BYTES)
    pdata = m6c.read_section(image, pd, m6c.MAX_PDATA_BYTES)
    if len(pdata) % 12 and any(pdata[len(pdata) // 12 * 12:]):
        fail("M6F_PDATA_TRAILING_NONZERO")
    lite = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    lite.detail = False
    detailed = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    detailed.detail = True
    sources: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    ranges: dict[int, int] = {}
    counts: Counter = Counter()
    function_count = instructions = function_bytes = decoded_bytes = invalid = 0
    previous_end = None
    started = time.monotonic()
    for lo, hi, unwind in struct.iter_unpack("<III", pdata[:len(pdata) // 12 * 12]):
        if not (tx["rva"] <= lo < hi <= tx["rva"] + len(code)):
            invalid += 1
            if invalid > 100:
                fail("M6F_BAD_PDATA_COVERAGE")
            continue
        if previous_end is not None and lo < previous_end:
            fail("M6F_PDATA_OVERLAP")
        previous_end = hi
        if hi - lo > m6c.MAX_FUNCTION_LENGTH:
            fail("M6F_FUNCTION_RANGE_SIZE")
        ranges[lo] = hi
        function_count += 1
        if function_count > MAX_FUNCTION_RANGES:
            fail("M6F_FUNCTION_RANGE_LIMIT")
        function_bytes += hi - lo
        end_decoded = lo
        for ip, nbytes, mnemonic, args in lite.disasm_lite(
            code[lo - tx["rva"]:hi - tx["rva"]], lo
        ):
            instructions += 1
            end_decoded = ip + nbytes
            if mnemonic != "call" or not DIRECT_TARGET.fullmatch(args):
                continue
            target = int(args, 16)
            old_target = target_to_old.get(target)
            if old_target is None:
                continue
            raw = code[ip - tx["rva"]:ip + nbytes - tx["rva"]]
            validated_call(ip, raw, target, capstone, detailed)
            sources[lo].append((ip - lo, old_target, ip))
            counts[old_target] += 1
            if sum(counts.values()) > MAX_DIRECT_HITS or len(sources) > MAX_CALLER_FUNCTIONS:
                fail("M6F_CENSUS_SIZE_LIMIT")
        decoded_bytes += end_decoded - lo
    if (function_count < 1_000 or function_bytes < 1_000_000 or
            decoded_bytes / function_bytes < MIN_DECODE_RATIO):
        fail("M6F_DECODE_INCOMPLETE")
    return {
        "ranges": ranges,
        "sites": dict(sources),
        "counts": counts,
        "metrics": {
            "functionRanges": function_count,
            "invalidPdataRecords": invalid,
            "decodedInstructions": instructions,
            "functionBytes": function_bytes,
            "decodedBytes": decoded_bytes,
            "decodedFraction": round(decoded_bytes / function_bytes, 6),
            "directCallSitesVerified": sum(counts.values()),
            "distinctCallerFunctions": len(sources),
            "scanSeconds": round(time.monotonic() - started, 3),
        },
    }


def root_call_signature(sites: list[tuple[int, int, int]]) -> tuple[tuple[int, int], ...]:
    return tuple(sorted((offset, old_target) for offset, old_target, ip in sites))


def candidate_catalog(image: Path, pe: dict, capstone, m6e, summary: dict) -> tuple[dict, dict]:
    catalog = defaultdict(list)
    skipped = Counter()
    skip_samples: dict[str, list[str]] = defaultdict(list)
    excluded_decode_codes = frozenset((
        "M6E_INSTRUCTION_LIMIT", "M6E_FUNCTION_INCOMPLETE",
        "M6E_RIP_TARGET_UNVERIFIED", "M6E_RIP_ENCODING_UNVERIFIED",
        "M6E_BRANCH_TARGET_UNVERIFIED", "M6E_BRANCH_ENCODING_UNVERIFIED",
    ))
    for start, sites in sorted(summary["sites"].items()):
        end = summary["ranges"][start]
        if end - start > m6e.MAX_FUNCTION_BYTES:
            skipped["function_too_large"] += 1
            continue
        try:
            shape = m6e.scan_function(image, pe, summary["ranges"], capstone, start)
        except m6e.FunctionError as error:
            code = str(error)
            if code in excluded_decode_codes:
                # This candidate's *entire body* was not independently validated.
                # Exclude it from caller pairing, but retain its typed direct-call
                # observation in the complete inbound census and report coverage.
                skipped[code] += 1
                if len(skip_samples[code]) < 12:
                    skip_samples[code].append(f"0x{start:X}")
                continue
            fail("M6F_CALLER_DECODE_" + code + "_AT_" + f"{start:X}")
        # The complete-body decoder must retain every typed, verified E8
        # instruction boundary found by the full .pdata census. Targets
        # themselves were checked against the correct build during census.
        offsets = {call["offset"] for call in shape["calls"]}
        if not all(offset in offsets for offset, _, _ in sites):
            fail("M6F_SOURCE_CALL_MISMATCH")
        key = (shape["hash"], shape["size"], len(shape["instructions"]), root_call_signature(sites))
        catalog[key].append({
            "start": start,
            "sites": root_call_signature(sites),
            "normalizedSha256": shape["hash"],
            "functionBytes": shape["size"],
            "instructions": len(shape["instructions"]),
        })
    if sum(skipped.values()) > len(summary["sites"]) // 4:
        fail("M6F_CALLER_COVERAGE_BELOW_THRESHOLD")
    return dict(catalog), {"counts": dict(skipped), "sampleRvas": dict(skip_samples)}


def compare_caller_catalogs(old: dict, new: dict, limits: int = MAX_SAMPLE_PAIRS) -> dict:
    if not 0 < limits <= MAX_SAMPLE_PAIRS:
        fail("M6F_SAMPLE_LIMIT")
    matched = []
    ambiguous = 0
    old_total = sum(len(v) for v in old.values())
    new_total = sum(len(v) for v in new.values())
    paired_sites = Counter()
    for key in sorted(old.keys() & new.keys()):
        before, after = old[key], new[key]
        if len(before) != 1 or len(after) != 1:
            ambiguous += min(len(before), len(after))
            continue
        a, b = before[0], after[0]
        for offset, target in a["sites"]:
            paired_sites[target] += 1
        matched.append({
            "oldCallerRva": f"0x{a['start']:X}",
            "newCallerRva": f"0x{b['start']:X}",
            "normalizedFunctionSha256": a["normalizedSha256"],
            "functionBytes": a["functionBytes"],
            "instructions": a["instructions"],
            "mappedRootCalls": [
                {"offset": offset, "oldRootCalleeRva": f"0x{target:X}"}
                for offset, target in a["sites"]
            ],
            "semanticallyQualified": False,
        })
    examples = sorted(
        matched, key=lambda p: (-len(p["mappedRootCalls"]), int(p["oldCallerRva"], 16))
    )[:limits]
    return {
        "pairedCallerFunctions": len(matched),
        "pairedRootCalls": sum(paired_sites.values()),
        "pairedRootCallCounts": paired_sites,
        "ambiguousCallerFunctions": ambiguous,
        "unpairedOldCatalogEntries": old_total - len(matched),
        "unpairedNewCatalogEntries": new_total - len(matched),
        "examples": examples,
    }


def audit(args: argparse.Namespace) -> dict:
    if socket.gethostname().upper() != "AMD-DESKTOP" or args.expect_host.upper() != "AMD-DESKTOP":
        fail("M6F_WRONG_HOST")
    own_path = Path(__file__)
    own_sha = hashlib.sha256(own_path.read_bytes()).hexdigest()
    pinned_bytes(own_path, own_sha, 256 * 1024)
    saved = pinned_bytes(Path(args.report), args.expected_report_sha, MAX_REPORT_BYTES)
    report = json.loads(saved)
    if (report.get("schema") != "workbridge.telemetry-function-relations.v1" or
            report.get("host") != "AMD-DESKTOP" or
            report.get("summary", {}).get("nativeLocatorsQualified") != 0 or
            report.get("summary", {}).get("liveTelemetryVerified") is not False or
            report.get("summary", {}).get("uniqueFunctionPairs") != 7 or
            len(report.get("functions", [])) != 7 or
            any(f.get("normalizedBodyEqual") is not True for f in report["functions"])):
        fail("M6F_REPORT_SCHEMA")
    sources = report["sources"]
    if sources["m6eToolSha256"].lower() != args.expected_m6e_tool_sha.lower():
        fail("M6F_TOOL_PIN")
    source_path = Path(args.workspace_root) / "rre" / "tools" / "rift_update_analyzer.py"
    source_pins = [
        (Path(args.before), sources["beforeSha256"], 1024 * 1024 * 1024),
        (Path(args.after), sources["afterSha256"], 1024 * 1024 * 1024),
        (Path(args.reader), sources["telemetryReaderSha256"], 256 * 1024),
        (source_path, sources["rreParserSha256"], 256 * 1024),
        (M6C_TOOL.with_name("telemetry-locator-drift.py"), sources["staticAuditHelperSha256"], 256 * 1024),
        (M6C_TOOL, sources["m6cToolSha256"], 256 * 1024),
        (M6C_TOOL.with_name("telemetry-locator-context.py"), sources["m6dToolSha256"], 256 * 1024),
        (M6E_TOOL, sources["m6eToolSha256"], 256 * 1024),
    ]
    for path, expected, maximum in source_pins:
        pinned_bytes(path, expected, maximum)
    m6e = load_module(M6E_TOOL, sources["m6eToolSha256"], "m6f_m6e")
    m6c = load_module(M6C_TOOL, sources["m6cToolSha256"], "m6f_m6c")
    rre = load_module(source_path, sources["rreParserSha256"], "m6f_rre")
    capstone = m6c.import_capstone()
    before = Path(args.before)
    after = Path(args.after)
    old_pe = rre.inspect_pe(before, before.stat().st_size)
    new_pe = rre.inspect_pe(after, after.stat().st_size)
    old_to_new = {}
    new_to_old = {}
    for row in report["functions"]:
        old = m6e.positive_rva(row["oldFunctionRva"])
        new = m6e.positive_rva(row["newFunctionRva"])
        if old in old_to_new or new in new_to_old:
            fail("M6F_ROOT_MAPPING_AMBIGUOUS")
        old_to_new[old] = new
        new_to_old[new] = old
    old_census = census(before, old_pe, capstone, m6c, {x: x for x in old_to_new})
    new_census = census(after, new_pe, capstone, m6c, new_to_old)
    old_catalog, old_skipped = candidate_catalog(before, old_pe, capstone, m6e, old_census)
    new_catalog, new_skipped = candidate_catalog(after, new_pe, capstone, m6e, new_census)
    pairs = compare_caller_catalogs(old_catalog, new_catalog)
    target_counts = []
    for old_root, new_root in sorted(old_to_new.items()):
        target_counts.append({
            "oldTargetRva": f"0x{old_root:X}",
            "newTargetRva": f"0x{new_root:X}",
            "oldCallSites": old_census["counts"][old_root],
            "newCallSites": new_census["counts"][old_root],
            "pairedCallerCallSites": pairs["pairedRootCallCounts"][old_root],
            "countsEqual": old_census["counts"][old_root] == new_census["counts"][old_root],
        })
    # Do not treat equal totals as verified edge mappings.
    for path, expected, maximum in source_pins:
        pinned_bytes(path, expected, maximum)
    pinned_bytes(Path(args.report), args.expected_report_sha, MAX_REPORT_BYTES)
    pinned_bytes(own_path, own_sha, 256 * 1024)
    return {
        "schema": "workbridge.telemetry-inbound-callgraph.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": socket.gethostname().upper(),
        "sources": {
            "m6eReportSha256": args.expected_report_sha.lower(),
            "m6eToolSha256": sources["m6eToolSha256"].lower(),
            "m6fToolSha256": own_sha,
            "beforeSha256": sources["beforeSha256"],
            "afterSha256": sources["afterSha256"],
            "rreParserSha256": sources["rreParserSha256"],
            "capstoneVersion": capstone.__version__,
        },
        "method": {
            "scope": ".pdata-constrained code ranges, direct E8 rel32 calls to seven M6e function starts",
            "pairing": "globally unique within selected caller population: normalized whole body plus exact mapped-root callsite offsets",
            "limits": "unwind coverage, indirect calls, too-large/incomplete caller functions and unpaired or ambiguous signatures",
            "liveProcessContacted": False,
            "nativeRuntimeLocatorsQualified": 0,
        },
        "oldScan": old_census["metrics"],
        "newScan": new_census["metrics"],
        "oldUnpairedFunctionReasons": old_skipped,
        "newUnpairedFunctionReasons": new_skipped,
        "targetCounts": target_counts,
        "pairedCallerExamples": pairs["examples"],
        "summary": {
            "selectedM6eFunctionPairs": len(old_to_new),
            "oldDirectCalls": sum(old_census["counts"].values()),
            "newDirectCalls": sum(new_census["counts"].values()),
            "allTargetCountsEqual": all(x["countsEqual"] for x in target_counts),
            "oldDistinctCallerFunctions": old_census["metrics"]["distinctCallerFunctions"],
            "newDistinctCallerFunctions": new_census["metrics"]["distinctCallerFunctions"],
            "pairedCallerFunctions": pairs["pairedCallerFunctions"],
            "pairedMappedCallSites": pairs["pairedRootCalls"],
            "ambiguousCallerFunctions": pairs["ambiguousCallerFunctions"],
            "oldUnpairedCandidateFunctions": pairs["unpairedOldCatalogEntries"],
            "newUnpairedCandidateFunctions": pairs["unpairedNewCatalogEntries"],
            "samplesTruncated": pairs["pairedCallerFunctions"] > MAX_SAMPLE_PAIRS,
            "nativeRuntimeLocatorsQualified": 0,
            "livePlayerTelemetryVerified": False,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-host", required=True)
    parser.add_argument("--workspace-root", default=r"C:\work")
    parser.add_argument("--report", required=True)
    parser.add_argument("--expected-report-sha", required=True)
    parser.add_argument("--expected-m6e-tool-sha", required=True)
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--reader", required=True)
    parser.add_argument("--output", help="New report filename only; never overwrite")
    args = parser.parse_args(argv)
    try:
        if args.output:
            out = Path(args.output)
            if out.suffix.lower() != ".json" or out.is_symlink() or out.exists():
                fail("M6F_OUTPUT_EXISTS")
        result = audit(args)
        json_blob = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.output:
            try:
                with Path(args.output).open("x", encoding="utf-8", newline="\n") as stream:
                    stream.write(json_blob)
            except FileExistsError:
                fail("M6F_OUTPUT_EXISTS")
        sys.stdout.write(json_blob)
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "code": str(exc) if isinstance(exc, CallgraphError) else "M6F_AUDIT_FAILED",
            "nativeRuntimeLocatorsQualified": 0,
        }), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
