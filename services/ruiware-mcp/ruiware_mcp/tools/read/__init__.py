"""只读类 MCP 工具。"""

from .attachments import execute as get_attachment
from .draft_context import execute as get_draft_context
from .validation import execute as get_validation_result

__all__ = ["get_attachment", "get_draft_context", "get_validation_result"]
