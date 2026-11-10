from __future__ import annotations

import os
from pathlib import Path
from dataclasses import dataclass


PLATFORM_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = PLATFORM_ROOT / "data"
ARTIFACT_ROOT = PLATFORM_ROOT / "artifacts"
ATTACHMENT_ROOT = DATA_ROOT / "attachments"
LOCAL_DATABASE = DATA_ROOT / "platform.db"


@dataclass(frozen=True)
class RemoteStorageSettings:
    endpoint: str
    access_key: str
    secret_key: str
    bucket: str
    prefix: str
    read_prefix: str
    secure: bool

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.access_key and self.secret_key and self.bucket and self.prefix)


def remote_storage_settings() -> RemoteStorageSettings:
    return RemoteStorageSettings(
        endpoint=os.environ.get("RUIWARE_MINIO_ENDPOINT", "").removeprefix("http://").removeprefix("https://").rstrip("/"),
        access_key=os.environ.get("RUIWARE_MINIO_ACCESS_KEY", ""),
        secret_key=os.environ.get("RUIWARE_MINIO_SECRET_KEY", ""),
        bucket=os.environ.get("RUIWARE_MINIO_BUCKET", "ruiware-templates"),
        prefix=os.environ.get("RUIWARE_MINIO_PREFIX", "").strip("/"),
        read_prefix=os.environ.get("RUIWARE_MINIO_READ_PREFIX", "publishers").strip("/"),
        secure=os.environ.get("RUIWARE_MINIO_SECURE", "false").lower() in {"1", "true", "yes"},
    )


def resolve_material_database() -> Path:
    configured = os.environ.get("RUIWARE_MATERIAL_DB")
    if configured:
        return Path(configured).expanduser().resolve()
    candidates = (
        PLATFORM_ROOT / "ruiware.db",
        PLATFORM_ROOT.parent / "debug" / "debug" / "ruiware.db",
    )
    return next((path.resolve() for path in candidates if path.is_file()), candidates[0].resolve())


MATERIAL_DATABASE = resolve_material_database()

DATA_ROOT.mkdir(parents=True, exist_ok=True)
ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
ATTACHMENT_ROOT.mkdir(parents=True, exist_ok=True)
