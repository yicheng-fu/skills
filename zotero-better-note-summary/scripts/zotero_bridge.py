#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from pathlib import Path


BRIDGE_ROOT = Path("/tmp/zotero-codex-bridge")
REQUEST_DIR = BRIDGE_ROOT / "requests"
RESPONSE_DIR = BRIDGE_ROOT / "responses"


def ensure_dirs() -> None:
    REQUEST_DIR.mkdir(parents=True, exist_ok=True)
    RESPONSE_DIR.mkdir(parents=True, exist_ok=True)


def send_request(command: str, payload: dict, timeout: float) -> dict:
    ensure_dirs()
    request_id = uuid.uuid4().hex
    request_path = REQUEST_DIR / f"{request_id}.json"
    temp_path = REQUEST_DIR / f"{request_id}.json.tmp"
    response_path = RESPONSE_DIR / f"{request_id}.json"

    request = {
        "id": request_id,
        "command": command,
        "payload": payload,
    }
    temp_path.write_text(
        json.dumps(request, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(request_path)

    deadline = time.time() + timeout
    while time.time() < deadline:
        if response_path.exists():
            response = json.loads(response_path.read_text(encoding="utf-8"))
            response_path.unlink(missing_ok=True)
            return response
        time.sleep(0.2)

    raise TimeoutError(
        "Timed out waiting for Zotero bridge response. "
        "Make sure Zotero is running and the bridge plugin is installed."
    )


def require_success(response: dict) -> dict:
    if response.get("ok"):
        return response["result"]
    error = response.get("error") or "Unknown Zotero bridge error"
    raise RuntimeError(error)


def read_markdown(args: argparse.Namespace) -> str:
    if args.markdown is not None:
        return args.markdown
    if args.markdown_file:
        if args.markdown_file == "-":
            return sys.stdin.read()
        return Path(args.markdown_file).read_text(encoding="utf-8")
    raise ValueError("Provide --markdown or --markdown-file")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Client for the local Codex Zotero bridge plugin.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=15.0,
        help="Seconds to wait for the Zotero bridge response.",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="Print JSON on one line.",
    )

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("ping", help="Check whether the Zotero bridge is responding.")
    subparsers.add_parser(
        "get-selected-item",
        help="Return the currently selected top-level Zotero item.",
    )

    get_item = subparsers.add_parser("get-item", help="Fetch a Zotero item by item key.")
    get_item.add_argument("--key", required=True, help="Zotero item key.")
    get_item.add_argument(
        "--library-id",
        type=int,
        default=None,
        help="Optional Zotero library ID.",
    )

    create_note = subparsers.add_parser(
        "create-note",
        help="Create a child note under a Zotero item from Markdown content.",
    )
    target_group = create_note.add_mutually_exclusive_group(required=True)
    target_group.add_argument(
        "--selected",
        action="store_true",
        help="Use the currently selected Zotero item as the parent.",
    )
    target_group.add_argument(
        "--parent-key",
        help="Use the Zotero item with this key as the parent.",
    )
    create_note.add_argument(
        "--library-id",
        type=int,
        default=None,
        help="Optional Zotero library ID for --parent-key lookups.",
    )
    create_note.add_argument(
        "--markdown",
        help="Markdown content to convert into a Better Note.",
    )
    create_note.add_argument(
        "--markdown-file",
        help="Path to a Markdown file. Use - to read from stdin.",
    )
    create_note.add_argument(
        "--title",
        default="论文总结",
        help="Optional top heading inserted so the note has a stable title.",
    )
    create_note.add_argument(
        "--no-title",
        action="store_true",
        help="Do not prepend a heading before the summary sections.",
    )
    create_note.add_argument(
        "--open",
        action="store_true",
        help="Open the created note after writing it.",
    )

    return parser


def print_json(data: dict, compact: bool) -> None:
    if compact:
        print(json.dumps(data, ensure_ascii=False))
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "ping":
        result = require_success(send_request("ping", {}, args.timeout))
        print_json(result, args.compact)
        return

    if args.command == "get-selected-item":
        result = require_success(send_request("get-selected-item", {}, args.timeout))
        print_json(result, args.compact)
        return

    if args.command == "get-item":
        payload = {
            "key": args.key,
            "libraryID": args.library_id,
        }
        result = require_success(send_request("get-item", payload, args.timeout))
        print_json(result, args.compact)
        return

    if args.command == "create-note":
        markdown = read_markdown(args)
        payload = {
            "selected": args.selected,
            "parentKey": args.parent_key,
            "libraryID": args.library_id,
            "markdown": markdown,
            "noteTitle": None if args.no_title else args.title,
            "openInWindow": args.open,
        }
        result = require_success(send_request("create-note", payload, args.timeout))
        print_json(result, args.compact)
        return

    parser.error(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    main()
