"""Playground chat request schema and data-plane relay mapping: ONE table.

The FastAPI/Pydantic request model, the relayed data-plane body and the
per-model registered output-cap backstop all read the same PLAYGROUND_PARAMS
rows (W5 ticket 05). Adding a forwarded parameter means adding one row here —
there is no second whitelist in the router, the schema or the frontend.

The request model is built with create_model from the table; its OpenAPI
component schema is byte-identical to the previous hand-written class (pinned by
python ops/contract/gen_ts.py --check), so field names, defaults, bounds and
error shapes do not move.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, create_model
from pydantic.fields import FieldInfo

from l05_service.model_params import MAX_TOKEN_LIMIT

#: Keys the relay builds itself; the vendor passthrough box (extra_fields) can
#: never override them — the single reserved-key ruling for the playground body.
RELAY_OWNED_KEYS = frozenset({"model", "messages", "stream", "stream_options"})


class PlaygroundMessage(BaseModel):
    role: str
    content: str


class PlaygroundResponseFormat(BaseModel):
    """response_format 只透传 type；text 是上游默认形状，面板不发它。"""

    type: Literal["text", "json_object"]


def _identity(value: Any) -> Any:
    return value


def _response_format(value: PlaygroundResponseFormat | None) -> dict[str, str] | None:
    return value.model_dump() if value is not None else None


def _reasoning_effort(value: str | None) -> str | None:
    """Ticket 18: "default" means 不传 — it never reaches the data plane."""
    return None if value == "default" else value


@dataclass(frozen=True, slots=True)
class PlaygroundParam:
    """One row of the single table: request-schema field + relay serialization."""

    name: str
    annotation: Any
    field: FieldInfo
    #: True = forwarded into the relayed data-plane body when the value is set.
    relay: bool = False
    #: Relay-body serializer; returning None omits the key for this request.
    serialize: Callable[[Any], Any] = _identity
    #: The per-model registered max_output_tokens backstop applies to this field.
    registered_output_cap: bool = False


#: The single source of truth for playground request parameters (ticket 05).
#: Order is the wire/default order and keeps validation messages deterministic.
PLAYGROUND_PARAMS: tuple[PlaygroundParam, ...] = (
    PlaygroundParam("model", str, Field(min_length=1)),
    PlaygroundParam("messages", list[PlaygroundMessage], Field(min_length=1)),
    # Sampling knobs forwarded verbatim to the data plane (ticket 19 contract);
    # None values never land in the relayed body.
    PlaygroundParam(
        "temperature", float | None, Field(default=None, ge=0, le=2), relay=True
    ),
    PlaygroundParam("top_p", float | None, Field(default=None, gt=0, le=1), relay=True),
    PlaygroundParam("top_k", int | None, Field(default=None, ge=0), relay=True),
    PlaygroundParam(
        "frequency_penalty",
        float | None,
        Field(default=None, ge=-2, le=2),
        relay=True,
    ),
    PlaygroundParam(
        "presence_penalty",
        float | None,
        Field(default=None, ge=-2, le=2),
        relay=True,
    ),
    PlaygroundParam("seed", int | None, Field(default=None), relay=True),
    # Sanity bounds reuse the model registry's own cap; the per-model
    # registered max_output_tokens is enforced by the route (registered_output_cap).
    PlaygroundParam(
        "max_tokens",
        int | None,
        Field(default=None, ge=1, le=MAX_TOKEN_LIMIT),
        relay=True,
        registered_output_cap=True,
    ),
    PlaygroundParam(
        "max_completion_tokens",
        int | None,
        Field(default=None, ge=1, le=MAX_TOKEN_LIMIT),
        relay=True,
        registered_output_cap=True,
    ),
    # Ticket 19: at most 4 non-empty stop sequences (the UI sends one array;
    # the single-line input is comma separated and folded at parse time).
    PlaygroundParam(
        "stop",
        list[Annotated[str, StringConstraints(min_length=1)]] | None,
        Field(default=None, max_length=4),
        relay=True,
    ),
    PlaygroundParam("n", int | None, Field(default=None, ge=1, le=128), relay=True),
    PlaygroundParam(
        "response_format",
        PlaygroundResponseFormat | None,
        Field(default=None),
        relay=True,
        serialize=_response_format,
    ),
    PlaygroundParam("logprobs", bool | None, Field(default=None), relay=True),
    PlaygroundParam(
        "top_logprobs", int | None, Field(default=None, ge=0, le=20), relay=True
    ),
    PlaygroundParam(
        "user", str | None, Field(default=None, min_length=1, max_length=256), relay=True
    ),
    # Full reasoning level set (ticket 18); "default" means 不传 and is dropped
    # by the serializer, every other level is forwarded verbatim.
    PlaygroundParam(
        "reasoning_effort",
        str | None,
        Field(default=None, pattern="^(default|none|low|medium|high|xhigh|max)$"),
        relay=True,
        serialize=_reasoning_effort,
    ),
    # Ticket 19: vendor passthrough box (面板「额外请求字段」). Merged into the
    # relay body first, so a standard param always wins and the relay-owned
    # keys (model/messages/stream/stream_options) can never be overridden.
    PlaygroundParam("extra_fields", dict[str, Any] | None, Field(default=None)),
)

#: Fields the route compares against the selected model's registered output cap.
REGISTERED_OUTPUT_CAP_FIELDS: tuple[str, ...] = tuple(
    param.name for param in PLAYGROUND_PARAMS if param.registered_output_cap
)


def _build_request_model() -> type[BaseModel]:
    """Build the FastAPI request model from the table (one row = one field)."""
    fields: dict[str, tuple[Any, FieldInfo]] = {
        param.name: (param.annotation, param.field) for param in PLAYGROUND_PARAMS
    }
    return create_model("PlaygroundRequest", __module__=__name__, **fields)


PlaygroundRequest = _build_request_model()


def relay_body(payload: BaseModel) -> dict[str, Any]:
    """Build the data-plane chat body from the request via the same table.

    Order matters for the override ruling: relay-owned keys first, then the
    vendor passthrough box, then every table param (a standard param wins over
    the same key inside extra_fields; relay-owned keys are never overridable).
    """
    body: dict[str, Any] = {
        "model": payload.model,  # type: ignore[attr-defined]
        "stream": True,
        "messages": [message.model_dump() for message in payload.messages],  # type: ignore[attr-defined]
    }
    for key, value in (payload.extra_fields or {}).items():  # type: ignore[attr-defined]
        if key not in RELAY_OWNED_KEYS:
            body[key] = value
    for param in PLAYGROUND_PARAMS:
        if not param.relay:
            continue
        value = param.serialize(getattr(payload, param.name))
        if value is not None:
            body[param.name] = value
    return body
