from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile


def embed_preview_stl(package_path: Path, artifact_root: Path) -> dict[str, str | int] | None:
    """Embed the compile STL in a portable .rwpart and make the path package-relative."""
    with zipfile.ZipFile(package_path, "r") as source:
        if source.testzip():
            raise ValueError(f"Corrupt template package: {package_path.name}")
        outputs = json.loads(source.read("outputs.json"))
        stl = next((item for item in outputs.get("artifacts", []) if item.get("kind") == "stl"), None)
        if stl is None:
            return None
        url = str(stl.get("url", ""))
        if url == "package://preview.stl":
            content = source.read("preview.stl")
            if hashlib.sha256(content).hexdigest() != stl.get("sha256"):
                raise ValueError("Embedded STL SHA256 mismatch")
            return json.loads(source.read("manifest.json"))["previewModel"]
        prefix = "/artifacts/"
        if not url.startswith(prefix):
            raise ValueError("STL output URL must reference the local artifacts directory")
        relative = PurePosixPath(url[len(prefix):])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid STL output path")
        root = artifact_root.resolve()
        stl_path = (root / Path(*relative.parts)).resolve()
        if not stl_path.is_relative_to(root) or not stl_path.is_file():
            raise FileNotFoundError(f"STL output not found: {relative}")
        content = stl_path.read_bytes()
        checksum = hashlib.sha256(content).hexdigest()
        if stl.get("sha256") and stl["sha256"] != checksum:
            raise ValueError("STL artifact SHA256 does not match compile output")

        manifest = json.loads(source.read("manifest.json"))
        model = {"file": "preview.stl", "format": "stl", "sha256": checksum, "size": len(content)}
        manifest["previewModel"] = model
        stl["url"] = "package://preview.stl"
        stl["sha256"] = checksum
        outputs_bytes = json.dumps(outputs, ensure_ascii=False, indent=2).encode("utf-8")
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
        with tempfile.NamedTemporaryFile(dir=package_path.parent, suffix=".rwpart", delete=False) as temp:
            temp_path = Path(temp.name)
        try:
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
                for item in source.infolist():
                    if item.filename in {"manifest.json", "outputs.json", "preview.stl"}:
                        continue
                    target.writestr(item, source.read(item.filename))
                # Fixed timestamps keep repeated exports byte-for-byte stable.
                for name, data in (("manifest.json", manifest_bytes), ("outputs.json", outputs_bytes), ("preview.stl", content)):
                    info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    target.writestr(info, data)
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise
    os.replace(temp_path, package_path)
    return model
