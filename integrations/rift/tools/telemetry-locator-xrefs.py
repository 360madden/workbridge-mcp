#!/usr/bin/env python3
"""Offline RIFT native-locator RIP-reference census using pinned RRE PE and Capstone 5.0.7.

PE .pdata function-range constrained linear sweeps check RIP-relative memory references
in two archived AMD64 executables. Xrefs and byte matches are STATIC CANDIDATES ONLY:
they do not establish live pointer identity, dereferenceability, or game behavior.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import struct
import sys
import time

CAPSTONE_VERSION = "5.0.7"
MAX_PDATA_BYTES = 6 * 1024 * 1024
MAX_TEXT_BYTES = 64 * 1024 * 1024
MAX_FUNCTIONS = 400_000
MAX_FUNCTION_LENGTH = 128 * 1024
MAX_SOURCE_BYTES = 1024 * 1024 * 1024
MIN_COVERAGE = 0.995
MAX_SAMPLES = 3
ROOT_SEARCH_RADIUS = 0x2000
RIP = re.compile(r"\brip\s*([+-])\s*0x([0-9a-f]+)", re.I)
SHA = re.compile(r"[0-9a-fA-F]{64}\Z")
ROOTS = frozenset(("ManagerRva", "PlayerSystemRva", "ClockRootRva"))
STATIC_HELPER = Path(__file__).with_name("telemetry-locator-drift.py")


class XrefError(Exception):
    pass


def fail(code: str) -> None:
    raise XrefError(code)


def sha_file(path: Path, limit: int, expected: str) -> str:
    if not SHA.fullmatch(expected):
        fail("INVALID_PIN")
    try:
        before = path.lstat()
        if not path.is_file() or path.is_symlink() or before.st_size < 1 or before.st_size > limit:
            fail("XREF_SOURCE_INVALID")
        digest = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                digest.update(chunk)
        after = path.lstat()
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns
        ):
            fail("XREF_SOURCE_CHANGED")
        actual = digest.hexdigest()
        if actual != expected.lower():
            fail("XREF_SOURCE_HASH")
        return actual
    except XrefError:
        raise
    except OSError:
        fail("XREF_SOURCE_UNAVAILABLE")


def import_static_helper(expected: str):
    sha_file(STATIC_HELPER, 256 * 1024, expected)
    spec = importlib.util.spec_from_file_location("workbridge_m6b_static_helper", STATIC_HELPER)
    if spec is None or spec.loader is None:
        fail("XREF_STATIC_HELPER_IMPORT")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def import_capstone():
    try:
        import capstone
    except ImportError:
        fail("XREF_CAPSTONE_MISSING")
    if capstone.__version__ != CAPSTONE_VERSION:
        fail("XREF_CAPSTONE_VERSION")
    return capstone


def section(pe: dict, name: str) -> dict:
    rows = [row for row in pe["sections"] if row["name"] == name]
    if len(rows) != 1:
        fail("XREF_SECTION_MISSING_OR_AMBIGUOUS")
    return rows[0]


def read_section(path: Path, part: dict, maximum: int) -> bytes:
    if part["rawSize"] < 12 or part["rawSize"] > maximum:
        fail("XREF_SECTION_BOUNDS")
    with path.open("rb") as f:
        f.seek(part["rawOffset"])
        data = f.read(part["rawSize"])
    if len(data) != part["rawSize"]:
        fail("XREF_SECTION_TRUNCATED")
    return data


def rip_target(rva: int, size: int, text: str):
    match = RIP.search(text)
    if match is None:
        return None
    disp = int(match.group(2), 16) * (1 if match.group(1) == "+" else -1)
    return rva + size + disp


def inspect_xrefs(image: Path, pe: dict, capstone, sample_interest=None) -> dict:
    tx = section(pe, ".text")
    pd = section(pe, ".pdata")
    data_sec = section(pe, ".data")
    code = read_section(image, tx, MAX_TEXT_BYTES)
    pdata = read_section(image, pd, MAX_PDATA_BYTES)
    records_bytes = (len(pdata) // 12) * 12
    # PE raw-section alignment may leave up to eleven zero padding bytes.
    # Reject nonzero trailing data rather than reading a truncated record.
    if any(pdata[records_bytes:]):
        fail("XREF_PDATA_TRUNCATED")
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = False
    counter = Counter()
    samples: dict[int, list] = {}
    function_count = instruction_count = decoded_bytes = function_bytes = unmatched_rip = 0
    invalid_entries = 0
    prior_end = None
    run_start = time.monotonic()
    for lo, hi, unwind in struct.iter_unpack("<III", pdata[:records_bytes]):
        if not (tx["rva"] <= lo < hi <= tx["rva"] + len(code)):
            invalid_entries += 1
            continue
        if hi - lo > MAX_FUNCTION_LENGTH:
            fail("XREF_FUNCTION_TOO_LARGE")
        if prior_end is not None and lo < prior_end:
            fail("XREF_FUNCTION_OVERLAP")
        prior_end = hi
        function_count += 1
        if function_count > MAX_FUNCTIONS:
            fail("XREF_FUNCTION_LIMIT")
        source = code[lo - tx["rva"]:hi - tx["rva"]]
        function_bytes += len(source)
        decoded_end = lo
        for instruction_rva, instruction_size, mnemonic, operands in md.disasm_lite(source, lo):
            instruction_count += 1
            decoded_end = instruction_rva + instruction_size
            if "rip" not in operands:
                continue
            addr = rip_target(instruction_rva, instruction_size, operands)
            if addr is None:
                unmatched_rip += 1
                continue
            if not (data_sec["rva"] <= addr < data_sec["rva"] + max(data_sec["virtualSize"], data_sec["rawSize"])):
                continue
            counter[addr] += 1
            if sample_interest is not None and sample_interest(addr):
                hits = samples.setdefault(addr, [])
                if len(hits) < MAX_SAMPLES:
                    raw = code[instruction_rva - tx["rva"]:instruction_rva + instruction_size - tx["rva"]]
                    hits.append({
                        "functionRva": f"0x{lo:X}",
                        "instructionRva": f"0x{instruction_rva:X}",
                        "instructionBytes": raw.hex(),
                        "mnemonic": mnemonic,
                        "operands": operands,
                        "referencedRva": f"0x{addr:X}",
                    })
        decoded_bytes += decoded_end - lo
    if function_count < 1_000 or invalid_entries > 100 or function_bytes < 1024 * 1024:
        fail("XREF_FUNCTION_COVERAGE")
    fraction = decoded_bytes / function_bytes
    if fraction < MIN_COVERAGE or unmatched_rip > 0:
        fail("XREF_DECODE_INCOMPLETE")
    return {
        "section": data_sec,
        "counts": counter,
        "samples": samples,
        "metrics": {
            "functionCount": function_count,
            "invalidPdataEntries": invalid_entries,
            "instructionsDecoded": instruction_count,
            "functionBytes": function_bytes,
            "decodedBytes": decoded_bytes,
            "decodedFraction": round(fraction, 6),
            "textRawBytes": len(code),
            "textCoveredFraction": round(function_bytes / len(code), 6),
            "ripTargetsInData": sum(counter.values()),
            "distinctDataTargets": len(counter),
            "unparsedRipOperands": unmatched_rip,
            "elapsedSeconds": round(time.monotonic() - run_start, 3),
        },
    }


def verify_rip_samples(image: Path, pe: dict, capstone, rows: list[dict]) -> None:
    """Re-decode bounded xref witnesses using typed RIP-relative operands."""
    tx = section(pe, ".text")
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    for row in rows:
        ip = int(row["instructionRva"], 16)
        raw = bytes.fromhex(row["instructionBytes"])
        if len(raw) > 15 or not (tx["rva"] <= ip < tx["rva"] + tx["rawSize"]):
            fail("XREF_WITNESS_INVALID")
        if int(row["referencedRva"], 16) >= pe["sizeOfImage"]:
            fail("XREF_WITNESS_INVALID")
        with image.open("rb") as f:
            f.seek(tx["rawOffset"] + ip - tx["rva"])
            saved = f.read(len(raw))
        if raw != saved:
            fail("XREF_WITNESS_CHANGED")
        one = list(md.disasm(raw, ip, count=1))
        if len(one) != 1 or one[0].size != len(raw):
            fail("XREF_WITNESS_DECODE")
        ins = one[0]
        if not any(
            operand.type == capstone.x86.X86_OP_MEM and
            operand.mem.base == capstone.x86.X86_REG_RIP and
            ins.address + ins.size + operand.mem.disp == int(row["referencedRva"], 16)
            for operand in ins.operands
        ):
            fail("XREF_WITNESS_TARGET")


def choose_root_matches(
    old_addr: int, expected_count: int, section_delta: int,
    new_counts: Counter, new_data: dict,
) -> tuple[int | None, list]:
    center = old_addr + section_delta
    matches = sorted(
        address for address, count in new_counts.items()
        if abs(address - center) <= ROOT_SEARCH_RADIUS and
        new_data["rva"] <= address < new_data["rva"] + max(new_data["virtualSize"], new_data["rawSize"])
        and count == expected_count
    )
    return (matches[0] if len(matches) == 1 else None), matches


def audit(args: argparse.Namespace) -> dict:
    if socket.gethostname().upper() != args.expect_host.upper():
        fail("WRONG_HOST")
    capstone = import_capstone()
    # Bind the generated report to these exact analysis-script bytes too.
    own_path = Path(__file__)
    own_sha = hashlib.sha256(own_path.read_bytes()).hexdigest()
    sha_file(own_path, 256 * 1024, own_sha)
    static = import_static_helper(args.expected_static_helper_sha)
    # Reuse exact SHA-pinned RRE parser via the preexisting M6b helper.
    try:
        baseline = static.inspect(args)
    except static.AuditError as exc:
        code = str(exc)
        fail("XREF_STATIC_" + code if re.fullmatch(r"[A-Z_]{3,64}", code) else "XREF_STATIC_BASELINE")
    if baseline["summary"]["locatorCount"] != 9:
        fail("XREF_STATIC_LOCATORS")
    old_image = Path(args.before)
    new_image = Path(args.after)
    rre_file = Path(args.workspace_root) / "rre" / "tools" / "rift_update_analyzer.py"
    sha_file(rre_file, 256 * 1024, args.expected_rre_parser_sha)
    spec = importlib.util.spec_from_file_location("workbridge_m6c_rre_parser", rre_file)
    if spec is None or spec.loader is None:
        fail("XREF_RRE_IMPORT")
    rre = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rre)
    old_pe = rre.inspect_pe(old_image, old_image.stat().st_size)
    new_pe = rre.inspect_pe(new_image, new_image.stat().st_size)
    old_targets = {row["name"]: int(row["historicalRva"], 16) for row in baseline["locators"]}
    data_old, data_new = section(old_pe, ".data"), section(new_pe, ".data")
    delta = data_new["rva"] - data_old["rva"]
    selectors = {
        row["name"]: int(row["sectionRelativeHypothesis"]["candidateRva"], 16)
        for row in baseline["locators"]
        if row["name"] not in ROOTS and row["sectionRelativeHypothesis"]["sameBytes16"] is True
    }
    if len(selectors) != 6:
        fail("XREF_SELECTOR_BASELINE_CHANGED")
    roots_centers = [old_targets[name] + delta for name in sorted(ROOTS)]

    old_result = inspect_xrefs(
        old_image, old_pe, capstone,
        sample_interest=lambda addr: addr in old_targets.values(),
    )
    new_result = inspect_xrefs(
        new_image, new_pe, capstone,
        sample_interest=lambda addr: addr in selectors.values() or any(
            abs(addr - center) <= ROOT_SEARCH_RADIUS for center in roots_centers
        ),
    )
    reports = []
    root_residuals = []
    for row in baseline["locators"]:
        name = row["name"]
        before_rva = old_targets[name]
        old_count = old_result["counts"].get(before_rva, 0)
        if name in ROOTS:
            candidate, matches = choose_root_matches(
                before_rva, old_count, delta, new_result["counts"], data_new
            )
            kind = "unique_nearby_rip_refcount" if candidate is not None else "ambiguous_or_missing"
            if candidate is not None:
                root_residuals.append(candidate - (before_rva + delta))
        else:
            candidate = selectors[name]
            matches = [candidate]
            kind = "section_relative_byte_and_rip_refcount"
        new_count = new_result["counts"].get(candidate, 0) if candidate is not None else None
        old_examples = old_result["samples"].get(before_rva, [])
        new_examples = new_result["samples"].get(candidate, []) if candidate is not None else []
        verify_rip_samples(old_image, old_pe, capstone, old_examples)
        verify_rip_samples(new_image, new_pe, capstone, new_examples)
        reports.append({
            "name": name,
            "historicalRva": f"0x{before_rva:X}",
            "sectionOffsetCandidateRva": f"0x{before_rva + delta:X}",
            "hypothesisKind": kind,
            "candidateRva": f"0x{candidate:X}" if candidate is not None else None,
            "oldRIPReferences": old_count,
            "newRIPReferencesAtCandidate": new_count,
            "equalReferenceCounts": candidate is not None and old_count == new_count and old_count > 0,
            "rootSearchRadius": ROOT_SEARCH_RADIUS if name in ROOTS else None,
            "countMatchingNearbyCandidates": len(matches) if name in ROOTS else None,
            "rootResidualShift": f"0x{candidate - before_rva - delta:X}" if name in ROOTS and candidate is not None else None,
            "historicalSamples": old_examples,
            "newSamples": new_examples,
            "typedOperandWitnessesValidated": len(old_examples) + len(new_examples),
            "nativeLocatorQualified": False,
        })
    common_residual = (
        root_residuals[0]
        if len(root_residuals) == len(ROOTS) and len(set(root_residuals)) == 1
        else None
    )
    if any(x["oldRIPReferences"] < 1 for x in reports):
        fail("XREF_OLD_REFERENCE_MISSING")

    for path, maximum, sha in [
        (old_image, MAX_SOURCE_BYTES, args.expected_before_sha),
        (new_image, MAX_SOURCE_BYTES, args.expected_after_sha),
        (Path(args.reader), 256 * 1024, args.expected_reader_sha),
        (rre_file, 256 * 1024, args.expected_rre_parser_sha),
        (STATIC_HELPER, 256 * 1024, args.expected_static_helper_sha),
        (own_path, 256 * 1024, own_sha),
    ]:
        sha_file(path, maximum, sha)
    return {
        "schema": "workbridge.telemetry-pdata-xrefs.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": socket.gethostname().upper(),
        "sources": {
            "beforeSha256": args.expected_before_sha.lower(),
            "afterSha256": args.expected_after_sha.lower(),
            "telemetryReaderSha256": args.expected_reader_sha.lower(),
            "rreParserSha256": args.expected_rre_parser_sha.lower(),
            "staticAuditHelperSha256": args.expected_static_helper_sha.lower(),
            "capstoneVersion": capstone.__version__,
            "xrefToolSha256": own_sha,
        },
        "method": {
            "scope": "PE .pdata function ranges linear sweep with Capstone x86-64",
            "RIPReference": "decoded RIP-relative memory operand; first-pass target then bounded typed-operand verification",
            "scopeLimitations": "Unwind ranges exclude some leaf functions; linear disassembly may decode embedded data",
            "nativeRuntimeValidation": False,
        },
        "oldScan": old_result["metrics"],
        "newScan": new_result["metrics"],
        "sectionBaseDelta": f"0x{delta:X}",
        "commonRootResidualShift": f"0x{common_residual:X}" if common_residual is not None else None,
        "locators": reports,
        "summary": {
            "locators": len(reports),
            "selectorsWithEqualReferenceCounts": sum(
                x["equalReferenceCounts"] for x in reports if x["name"] not in ROOTS
            ),
            "rootsWithUniqueEqualCountCandidates": sum(
                x["equalReferenceCounts"] and x["countMatchingNearbyCandidates"] == 1
                for x in reports if x["name"] in ROOTS
            ),
            "allNineStaticReferenceCountsMatch": all(x["equalReferenceCounts"] for x in reports),
            "qualifiedNativeLocators": 0,
            "independentLivePointerOrOwnershipProof": False,
        },
    }


def parse_arguments(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-host", required=True)
    parser.add_argument("--workspace-root", default=r"C:\work")
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--reader", required=True)
    parser.add_argument("--expected-before-sha", required=True)
    parser.add_argument("--expected-after-sha", required=True)
    parser.add_argument("--expected-reader-sha", required=True)
    parser.add_argument("--expected-rre-parser-sha", required=True)
    parser.add_argument("--expected-static-helper-sha", required=True)
    parser.add_argument("--output", help="Optional NEW JSON file; no overwriting")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_arguments(argv)
        if args.output:
            output = Path(args.output)
            if output.suffix.lower() != ".json" or output.is_symlink() or output.exists():
                fail("XREF_OUTPUT_EXISTS_OR_INVALID")
        result = audit(args)
        formatted = json.dumps(result, sort_keys=True, indent=2) + "\n"
        if args.output:
            try:
                with Path(args.output).open("x", encoding="utf-8", newline="\n") as stream:
                    stream.write(formatted)
            except FileExistsError:
                fail("XREF_OUTPUT_EXISTS_OR_INVALID")
        sys.stdout.write(formatted)
        return 0
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "code": str(exc) if isinstance(exc, XrefError) else "XREF_AUDIT_FAILED",
            "nativeLocatorsQualified": 0,
        }), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
