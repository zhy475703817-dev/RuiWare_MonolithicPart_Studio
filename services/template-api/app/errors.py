"""统一 API 错误码、错误响应结构和 FastAPI 异常处理。

后端所有显式业务错误和请求校验错误都通过这里包装成稳定格式，
方便前端统一展示“错误码、说明、建议动作、字段错误和追踪号”。
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


class ApiErrorPayload(BaseModel):
    code: str
    message: str
    action: str | None = None
    fields: list[dict[str, Any]] = Field(default_factory=list)
    traceId: str
    retryable: bool = False
    context: dict[str, Any] = Field(default_factory=dict)


ERROR_MESSAGES: dict[str, tuple[str, str | None]] = {
    "DRAFT_NOT_FOUND": ("模板草稿不存在。", "请刷新草稿列表，确认该模板是否已被归档或删除。"),
    "DRAFT_ARCHIVED_NOT_FOUND": ("归档草稿不存在。", "请确认草稿处于归档状态后再恢复。"),
    "DRAFT_REVISION_NOT_FOUND": ("草稿或修订不存在。", "请刷新修订列表后重试。"),
    "DRAFT_REVISION_CONFLICT": ("草稿已被其他操作更新。", "请刷新当前草稿，再重新提交你的修改。"),
    "DRAFT_CODE_DUPLICATE": ("模板编码已存在。", "请更换一个唯一的模板编码。"),
    "DRAFT_ID_MISMATCH": ("路径 ID 与草稿 ID 不一致。", "请刷新页面后重试。"),
    "DRAFT_ID_DUPLICATE": ("草稿 ID 已存在。", "请重新创建草稿。"),
    "MATERIAL_NOT_FOUND": ("材料记录不存在。", "请重新搜索材料库并选择有效材料。"),
    "MATERIAL_BINDING_NOT_FOUND": ("材料绑定不存在。", "请重新绑定材料验证样例。"),
    "MATERIAL_LIBRARY_UNAVAILABLE": ("材料库暂时不可用。", "请检查材料数据库路径和文件访问权限。"),
    "STAGE_PREREQUISITE_INCOMPLETE": ("前置阶段尚未完成。", "请按顺序完成前置阶段后再继续。"),
    "ATTACHMENT_UNSUPPORTED_TYPE": ("不支持该附件格式。", "请上传 PNG、JPEG、PDF 或通用规格文件。"),
    "ATTACHMENT_EMPTY": ("附件不能为空。", "请选择非空文件后重新上传。"),
    "ATTACHMENT_TOO_LARGE": ("单个附件不能超过 20 MB。", "请压缩文件或拆分附件后上传。"),
    "ATTACHMENT_NOT_FOUND": ("附件不存在。", "请刷新页面后确认附件是否仍然存在。"),
    "COMPILE_MISSING_MATERIAL": ("尚未配置可解析的标称材料验证样例。", "请先在材料阶段绑定并复核标称样例。"),
    "COMPILE_RECORD_MISSING": ("缺少 CAD 编译记录。", "请先在验证阶段运行 B-Rep 编译。"),
    "PROPOSAL_INVALID": ("提案命令不符合模板元模型。", "请检查提案内容后重新预览。"),
    "PROPOSAL_EMPTY": ("未选择任何提案命令。", "请选择至少一条命令后再应用。"),
    "PROPOSAL_PREVIEW_FAILED": ("提案预览未通过。", "请先解决预览诊断，再应用提案。"),
    "PUBLISH_ALREADY_PUBLISHED": ("当前修订已发布。", "请先修改模板并重新完成受影响阶段。"),
    "PUBLISH_VALIDATION_FAILED": ("发布准入校验未通过。", "请处理校验项后重新发布。"),
    "REQUEST_INVALID": ("请求数据格式不正确。", "请检查输入字段后重试。"),
    "UNEXPECTED_ERROR": ("服务处理请求时发生未知错误。", "请记录错误码和追踪号后联系维护人员。"),
}

RETRYABLE_ERROR_CODES = {
    "DRAFT_REVISION_CONFLICT",
    "MATERIAL_LIBRARY_UNAVAILABLE",
    "COMPILE_RECORD_MISSING",
    "UNEXPECTED_ERROR",
}


class ApiError(HTTPException):
    def __init__(
        self,
        code: str,
        *,
        status_code: int = 400,
        message: str | None = None,
        action: str | None = None,
        fields: list[dict[str, Any]] | None = None,
        context: dict[str, Any] | None = None,
        retryable: bool | None = None,
    ) -> None:
        default_message, default_action = ERROR_MESSAGES.get(code, (message or code, None))
        detail = {
            "code": code,
            "message": message or default_message,
            "action": action if action is not None else default_action,
            "fields": fields or [],
            "context": context or {},
            "retryable": retryable if retryable is not None else code in RETRYABLE_ERROR_CODES,
        }
        super().__init__(status_code=status_code, detail=detail)


# 创建一个带稳定错误码的业务异常，供路由函数直接抛出。
def api_error(
    code: str,
    *,
    status_code: int = 400,
    message: str | None = None,
    action: str | None = None,
    fields: list[dict[str, Any]] | None = None,
    context: dict[str, Any] | None = None,
    retryable: bool | None = None,
) -> ApiError:
    return ApiError(
        code,
        status_code=status_code,
        message=message,
        action=action,
        fields=fields,
        context=context,
        retryable=retryable,
    )


# 生成短追踪号，便于用户截图后定位一次具体失败。
def _trace_id() -> str:
    return uuid.uuid4().hex[:12]


# 兼容新旧错误格式，把 HTTPException.detail 统一整理成 ApiErrorPayload。
def _payload_from_detail(detail: Any) -> tuple[ApiErrorPayload, dict[str, Any]]:
    trace_id = _trace_id()
    if isinstance(detail, dict) and "code" in detail:
        code = str(detail["code"])
        default_message, default_action = ERROR_MESSAGES.get(code, (code, None))
        return (
            ApiErrorPayload(
                code=code,
                message=str(detail.get("message") or default_message),
                action=detail.get("action") if detail.get("action") is not None else default_action,
                fields=list(detail.get("fields") or []),
                traceId=trace_id,
                retryable=bool(detail.get("retryable", code in RETRYABLE_ERROR_CODES)),
                context=dict(detail.get("context") or {}),
            ),
            dict(detail.get("context") or {}),
        )
    message = detail if isinstance(detail, str) else "请求处理失败。"
    return (
        ApiErrorPayload(
            code="UNEXPECTED_ERROR",
            message=str(message),
            action=ERROR_MESSAGES["UNEXPECTED_ERROR"][1],
            traceId=trace_id,
            retryable=True,
            context={"detail": detail},
        ),
        {"detail": detail},
    )


# FastAPI 的 HTTPException 统一出口，保证所有 API 错误都有同一响应结构。
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    payload, context = _payload_from_detail(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": payload.model_dump(),
            "detail": payload.model_dump(),
            "context": context,
        },
        headers=getattr(exc, "headers", None),
    )


# 请求体或查询参数不合法时，把 Pydantic 校验错误整理成字段级提示。
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [
        {
            "path": ".".join(str(part) for part in error.get("loc", []) if part != "body"),
            "message": error.get("msg", "字段不合法"),
            "type": error.get("type", "validation_error"),
        }
        for error in exc.errors()
    ]
    payload = ApiErrorPayload(
        code="REQUEST_INVALID",
        message=ERROR_MESSAGES["REQUEST_INVALID"][0],
        action=ERROR_MESSAGES["REQUEST_INVALID"][1],
        fields=fields,
        traceId=_trace_id(),
        retryable=False,
        context={},
    )
    return JSONResponse(
        status_code=422,
        content={"error": payload.model_dump(), "detail": payload.model_dump()},
    )
