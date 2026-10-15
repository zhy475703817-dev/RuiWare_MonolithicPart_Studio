from __future__ import annotations

import os
from pathlib import Path


PLATFORM_ROOT = Path(__file__).resolve().parents[3]
DATA_ROOT = PLATFORM_ROOT / "data"
ARTIFACT_ROOT = PLATFORM_ROOT / "artifacts"
ATTACHMENT_ROOT = DATA_ROOT / "attachments"
LOCAL_DATABASE = DATA_ROOT / "platform.db"


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
