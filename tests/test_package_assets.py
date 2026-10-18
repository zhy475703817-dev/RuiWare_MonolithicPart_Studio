import hashlib
import json
import zipfile

import pytest

from app.services.package_assets import embed_preview_stl


def package(tmp_path, url="/artifacts/hash/preview.stl", checksum=None):
    root = tmp_path / "artifacts"
    mesh = root / "hash/preview.stl"
    mesh.parent.mkdir(parents=True)
    mesh.write_bytes(b"solid mesh\nendsolid mesh\n")
    target = tmp_path / "part.rwpart"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr("manifest.json", json.dumps({"code": "TEST", "revision": 7}))
        archive.writestr("outputs.json", json.dumps({"artifacts": [{"kind": "stl", "url": url, "sha256": checksum or hashlib.sha256(mesh.read_bytes()).hexdigest()}]}))
        archive.writestr("parameters.json", b"original parameters")
    return target, root, mesh


def test_embedded_preview_is_portable_and_idempotent(tmp_path):
    target, root, mesh = package(tmp_path)
    embed_preview_stl(target, root)
    with zipfile.ZipFile(target) as archive:
        assert archive.read("preview.stl") == mesh.read_bytes()
        assert archive.read("parameters.json") == b"original parameters"
        assert json.loads(archive.read("manifest.json"))["revision"] == 7
        assert json.loads(archive.read("outputs.json"))["artifacts"][0]["url"] == "package://preview.stl"
    before = target.read_bytes()
    embed_preview_stl(target, root)
    assert target.read_bytes() == before


@pytest.mark.parametrize("url,checksum", [("/artifacts/../secret.stl", None), ("https://example.com/model.stl", None), ("/artifacts/hash/preview.stl", "wrong")])
def test_invalid_preview_does_not_modify_original_package(tmp_path, url, checksum):
    target, root, _ = package(tmp_path, url, checksum)
    before = target.read_bytes()
    with pytest.raises(ValueError):
        embed_preview_stl(target, root)
    assert target.read_bytes() == before
