#!/usr/bin/env python3
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path


def build_xpi(plugin_dir: Path, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(plugin_dir.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(plugin_dir))
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build the Codex Zotero bridge plugin as an XPI archive.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output XPI path. Defaults to assets/codex-zotero-bridge.xpi.",
    )
    args = parser.parse_args()

    skill_dir = Path(__file__).resolve().parents[1]
    plugin_dir = skill_dir / "assets" / "zotero-codex-bridge"
    output_path = args.output or (skill_dir / "assets" / "codex-zotero-bridge.xpi")

    built = build_xpi(plugin_dir, output_path)
    print(built)


if __name__ == "__main__":
    main()
