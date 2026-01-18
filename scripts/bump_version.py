#!/usr/bin/env python3
import argparse
import re
from pathlib import Path


def bump_semver(version: str, kind: str) -> str:
    parts = version.split(".")
    if len(parts) != 3:
        raise ValueError("Version must be in major.minor.patch format")
    major, minor, patch = [int(part) for part in parts]
    if kind == "major":
        return f"{major + 1}.0.0"
    if kind == "minor":
        return f"{major}.{minor + 1}.0"
    if kind == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError("Unknown bump kind. Use major, minor, or patch.")


def read_cargo_version(path: Path) -> str:
    content = path.read_text()
    in_package = False
    for line in content.splitlines():
        trimmed = line.strip()
        if trimmed.startswith("[") and trimmed.endswith("]"):
            in_package = trimmed == "[package]"
        if in_package and trimmed.startswith("version") and "=" in trimmed:
            match = re.search(r'"([^"]+)"', line)
            if match:
                return match.group(1)
    raise ValueError("Cargo.toml version not found")


def replace_cargo_version(path: Path, next_version: str) -> None:
    content = path.read_text()
    in_package = False
    updated_lines = []
    replaced = False
    for line in content.splitlines():
        trimmed = line.strip()
        if trimmed.startswith("[") and trimmed.endswith("]"):
            in_package = trimmed == "[package]"
        if in_package and trimmed.startswith("version") and "=" in trimmed:
            new_line = re.sub(r'"([^"]+)"', f'"{next_version}"', line, count=1)
            updated_lines.append(new_line)
            replaced = True
            continue
        updated_lines.append(line)
    if not replaced:
        raise ValueError("Cargo.toml version not found")
    path.write_text("\n".join(updated_lines) + ("\n" if content.endswith("\n") else ""))


def read_tauri_version(path: Path) -> str:
    content = path.read_text()
    match = re.search(r'"version"\s*:\s*"([^"]+)"', content)
    if not match:
        raise ValueError("tauri.conf.json version not found")
    return match.group(1)


def replace_tauri_version(path: Path, next_version: str) -> None:
    content = path.read_text()
    def replace(match: re.Match) -> str:
        return f'{match.group(1)}{next_version}{match.group(3)}'

    updated, count = re.subn(r'("version"\s*:\s*")([^"]+)(")', replace, content, count=1)
    if count == 0:
        raise ValueError("tauri.conf.json version not found")
    path.write_text(updated)


def main() -> None:
    parser = argparse.ArgumentParser(description="Bump RecallCheck version in Cargo.toml and tauri.conf.json")
    parser.add_argument("kind", nargs="?", choices=["major", "minor", "patch"], default="patch")
    parser.add_argument("--set", dest="set_version", help="Set an explicit version (major.minor.patch)")
    parser.add_argument(
        "--sync-from",
        dest="sync_from",
        choices=["cargo", "tauri"],
        help="Resolve mismatched versions by choosing a source before bumping",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    cargo_path = root / "src-tauri" / "Cargo.toml"
    tauri_path = root / "src-tauri" / "tauri.conf.json"

    current_cargo = read_cargo_version(cargo_path)
    current_tauri = read_tauri_version(tauri_path)
    if current_cargo != current_tauri and not args.set_version and not args.sync_from:
        raise SystemExit(
            "Version mismatch between Cargo.toml and tauri.conf.json. "
            "Use --set or --sync-from cargo|tauri."
        )

    if args.set_version:
        next_version = args.set_version.strip()
        if not re.match(r"^\d+\.\d+\.\d+$", next_version):
            raise SystemExit("Explicit version must be major.minor.patch")
    else:
        base_version = current_cargo
        if args.sync_from == "tauri":
            base_version = current_tauri
        next_version = bump_semver(base_version, args.kind)

    replace_cargo_version(cargo_path, next_version)
    replace_tauri_version(tauri_path, next_version)
    print(f"Bumped version: {current_cargo} -> {next_version}")


if __name__ == "__main__":
    main()
