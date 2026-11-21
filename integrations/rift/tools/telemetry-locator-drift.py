#!/usr/bin/env python3
"""Offline Telemetry locator drift audit using RRE's established PE parser.

Inspects two SHA-pinned *archived* executable files and a SHA-pinned C#
reader source. Never opens a running process, writes game memory, or accepts
an executable/helper command from the source file. Section-relative positions
are STATIC candidates, NOT current memory locators or runtime qualification.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import sys

LOCATORS = (
    "ManagerRva",
    "PlayerSystemRva",
    "HealthSelectorRva",
    "NameSelectorRva",
    "LocalizedNameSelectorRva",
    "AlternateSelectorRva",
    "SelectionSelectorRva",
    "PositionSelectorRva",
    "ClockRootRva",
)
SHA = re.compile(r"[a-fA-F0-9]{64}\Z")
RVA = re.compile(r"private\s+const\s+ulong\s+(\w+Rva)\s*=\s*0x([a-fA-F0-9]+)\s*;")
BUILD = re.compile(r'private\s+const\s+string\s+SupportedBuildSha256\s*=\s*"([a-fA-F0-9]{64})"\s*;')
BLOCK = 1024 * 1024
MAX_TEXT = 256 * 1024
MAX_EXE = 1024 * 1024 * 1024


class AuditError(Exception):
    pass


def error(code: str) -> None:
    raise AuditError(code)


def hex_sha(value: str) -> str:
    if not SHA.fullmatch(value or ""):
        error("INVALID_SHA256")
    return value.lower()


def file_stat(path: Path, maximum: int) -> os.stat_result:
    if path.is_symlink():
        error("SOURCE_LINK")
    info = path.stat()
    if not path.is_file() or info.st_size <= 0 or info.st_size > maximum:
        error("SOURCE_INVALID")
    return info


def fingerprint_equal(first: os.stat_result, second: os.stat_result) -> bool:
    return (
        first.st_size == second.st_size
        and first.st_mtime_ns == second.st_mtime_ns
        and first.st_ctime_ns == second.st_ctime_ns
        and first.st_ino == second.st_ino
        and first.st_dev == second.st_dev
    )


def sha_file(path: Path, maximum: int, expected: str) -> tuple[str, os.stat_result]:
    before = file_stat(path, maximum)
    dig = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(BLOCK):
            dig.update(block)
    if not fingerprint_equal(before, file_stat(path, maximum)):
        error("SOURCE_CHANGED")
    actual = dig.hexdigest()
    if actual != hex_sha(expected):
        error("SOURCE_SHA_MISMATCH")
    return actual, before


def script_bytes(path: Path, expected: str) -> tuple[str, bytes, os.stat_result]:
    sha, original = sha_file(path, MAX_TEXT, expected)
    data = path.read_bytes()
    if not fingerprint_equal(original, file_stat(path, MAX_TEXT)):
        error("SOURCE_CHANGED")
    if hashlib.sha256(data).hexdigest() != sha:
        error("SOURCE_CHANGED")
    return sha, data, original


def reader_constants(data: bytes, before_sha: str) -> dict[str, int]:
    try:
        source = data.decode("utf-8-sig", "strict")
    except UnicodeError:
        error("READER_SOURCE_ENCODING")
    version = BUILD.findall(source)
    if len(version) != 1 or version[0].lower() != before_sha:
        error("READER_BUILD_MISMATCH")
    matches = RVA.findall(source)
    names = [row[0] for row in matches]
    if len(matches) != len(LOCATORS) or set(names) != set(LOCATORS) or len(set(names)) != len(names):
        error("READER_LOCATORS_CHANGED")
    values = {name: int(value, 16) for name, value in matches}
    if any(rva <= 0 or rva > 0x80000000 for rva in values.values()):
        error("READER_RVA_OUT_OF_RANGE")
    return values


def section_for(pe: dict, rva: int) -> dict | None:
    matches = [
        s for s in pe["sections"]
        if s["rva"] <= rva < s["rva"] + max(s["virtualSize"], s["rawSize"])
    ]
    if len(matches) > 1:
        error("AMBIGUOUS_SECTION")
    return matches[0] if matches else None


def one_section(pe: dict, name: str) -> dict | None:
    matches = [s for s in pe["sections"] if s["name"] == name]
    return matches[0] if len(matches) == 1 else None


def map_locator(analyzer: object, old: Path, new: Path, old_pe: dict,
                new_pe: dict, name: str, rva: int) -> dict:
    old_section = section_for(old_pe, rva)
    current_section = section_for(new_pe, rva)
    old_bytes = analyzer.bytes_at_rva(old, old_pe, rva, 16)
    current_bytes = analyzer.bytes_at_rva(new, new_pe, rva, 16)

    aligned_rva = None
    aligned_section = None
    aligned_bytes = None
    if old_section is not None:
        aligned_section = one_section(new_pe, old_section["name"])
        if aligned_section is not None:
            relative = rva - old_section["rva"]
            aligned_rva = aligned_section["rva"] + relative
            aligned_bytes = analyzer.bytes_at_rva(new, new_pe, aligned_rva, 16)

    return {
        "name": name,
        "historicalRva": f"0x{rva:X}",
        "oldSection": old_section["name"] if old_section else None,
        "newSectionAtHistoricalRva": current_section["name"] if current_section else None,
        "oldFileBacked16": old_bytes is not None,
        "newFileBacked16AtHistoricalRva": current_bytes is not None,
        "sameHistoricalRvaBytes16": (
            old_bytes == current_bytes
            if old_bytes is not None and current_bytes is not None else None
        ),
        "sectionRelativeHypothesis": {
            "candidateRva": f"0x{aligned_rva:X}" if aligned_rva is not None else None,
            "newFileBacked16": aligned_bytes is not None,
            "sameBytes16": (
                old_bytes == aligned_bytes
                if old_bytes is not None and aligned_bytes is not None else None
            ),
            "nativeLocatorQualified": False,
            "explanation": (
                "Same relative position within a section; a matching byte window "
                "does not establish a relocated variable, pointer chain or runtime owner."
            ),
        },
        "runtimeMemoryRead": False,
    }


def inspect(args: argparse.Namespace) -> dict:
    if socket.gethostname().upper() != args.expect_host.upper():
        error("WRONG_HOST")
    if args.expect_host.upper() != "AMD-DESKTOP":
        error("UNSUPPORTED_HOST")

    before = Path(args.before)
    after = Path(args.after)
    reader = Path(args.reader)
    root = Path(args.workspace_root)
    if before.resolve() == after.resolve():
        error("SAME_PE_IMAGE")

    expected_old = hex_sha(args.expected_before_sha)
    expected_new = hex_sha(args.expected_after_sha)
    reader_sha, reader_data, reader_info = script_bytes(reader, args.expected_reader_sha)
    actual_old, old_info = sha_file(before, MAX_EXE, expected_old)
    actual_new, new_info = sha_file(after, MAX_EXE, expected_new)
    locators = reader_constants(reader_data, actual_old)

    trusted_parser = root / "rre" / "tools" / "rift_update_analyzer.py"
    parser_sha, _parser_data, parser_info = script_bytes(trusted_parser, args.expected_rre_parser_sha)
    spec = importlib.util.spec_from_file_location("workbridge_m6b_pinned_rre_parser", trusted_parser)
    if spec is None or spec.loader is None:
        error("ANALYZER_IMPORT")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    old_pe = module.inspect_pe(before, old_info.st_size)
    new_pe = module.inspect_pe(after, new_info.st_size)
    rows = [
        map_locator(module, before, after, old_pe, new_pe, name, locators[name])
        for name in LOCATORS
    ]

    # Reject source drift anywhere between parsing and result publication.
    for path, info, maximum, sha in (
        (before, old_info, MAX_EXE, actual_old),
        (after, new_info, MAX_EXE, actual_new),
        (reader, reader_info, MAX_TEXT, reader_sha),
        (trusted_parser, parser_info, MAX_TEXT, parser_sha),
    ):
        if not fingerprint_equal(info, file_stat(path, maximum)):
            error("SOURCE_CHANGED")
        if sha_file(path, maximum, sha)[0] != sha:
            error("SOURCE_CHANGED")

    return {
        "schema": "workbridge.telemetry-static-locator-drift.v1",
        "observedUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "host": socket.gethostname().upper(),
        "source": {
            "reader": {"sha256": reader_sha, "supportedBuildSha256": actual_old},
            "rreParser": {"sha256": parser_sha},
            "before": {"sha256": actual_old, "imageSize": old_pe["sizeOfImage"]},
            "after": {"sha256": actual_new, "imageSize": new_pe["sizeOfImage"]},
        },
        "sections": [
            {
                "name": s["name"],
                "oldRva": f"0x{s['rva']:X}",
                "newRva": f"0x{one_section(new_pe, s['name'])['rva']:X}"
                if one_section(new_pe, s["name"]) else None,
            }
            for s in old_pe["sections"]
        ],
        "locators": rows,
        "summary": {
            "locatorCount": len(rows),
            "oldToDifferentSection": sum(
                row["oldSection"] is not None
                and row["newSectionAtHistoricalRva"] != row["oldSection"]
                for row in rows
            ),
            "identical16AtSameRva": sum(
                row["sameHistoricalRvaBytes16"] is True for row in rows
            ),
            "identical16AtSectionRelativeHypothesis": sum(
                row["sectionRelativeHypothesis"]["sameBytes16"] is True for row in rows
            ),
            "notByteComparableAtOldRva": sum(
                row["sameHistoricalRvaBytes16"] is None for row in rows
            ),
            "nativeLocatorsQualified": 0,
        },
        "limitations": {
            "readOnlyOffline": True,
            "processMemoryRead": False,
            "loadedPointerChainsVerified": False,
            "currentGameDataBound": False,
            "runtimeLocatorQualified": False,
            "staticRelocationHypothesesOnly": True,
        },
    }


def parse_args(argv: list[str] | None) -> argparse.Namespace:
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
    parser.add_argument("--output", help="Optional NEW output .json file; never overwritten")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        result = inspect(args)
        raw = json.dumps(result, sort_keys=True, indent=2, ensure_ascii=True) + "\n"
        if args.output:
            output = Path(args.output)
            if output.suffix.lower() != ".json" or output.is_symlink():
                error("OUTPUT_PATH")
            try:
                with output.open("x", encoding="utf-8", newline="\n") as target:
                    target.write(raw)
            except FileExistsError:
                error("OUTPUT_EXISTS")
        sys.stdout.write(raw)
        return 0
    except (AuditError, OSError, ValueError, KeyError, TypeError) as exc:
        code = str(exc) if isinstance(exc, AuditError) else "LOCATOR_AUDIT_FAILED"
        print(json.dumps({"ok": False, "code": code, "nativeLocatorsQualified": 0}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
