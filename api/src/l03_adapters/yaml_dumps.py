"""Zero-dependency deterministic YAML emitter (stable key order, no timestamps).

Idempotence invariant (transforms-compiler.md §4.5): rendering the same IR twice
must produce byte-identical artifacts; dict insertion order + fixed scalar
formatting guarantee that. Optional header comments carry quota-window notes.
"""

from __future__ import annotations

from typing import Any

_INDENT = "  "


def _needs_quotes(value: str) -> bool:
    if value == "" or value != value.strip():
        return True
    special = ":{}[],&*#?|-<>=!%@\\" + "'`"
    if any(ch in special for ch in value):
        return True
    lowered = value.lower()
    if lowered in ("null", "true", "false", "yes", "no", "on", "off", "~"):
        return True
    try:
        float(value)
        return True
    except ValueError:
        return False


def _quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _scalar(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    return _quote(text) if _needs_quotes(text) else text


def _emit(value: Any, indent: int, lines: list[str]) -> None:
    pad = _INDENT * indent
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (dict, list)) and item:
                lines.append(f"{pad}{key}:")
                _emit(item, indent + 1, lines)
            elif isinstance(item, (dict, list)):
                # Empty containers: keep dicts and lists visually distinct.
                lines.append(f"{pad}{key}: []" if isinstance(item, list) else f"{pad}{key}: {{}}")
            else:
                lines.append(f"{pad}{key}: {_scalar(item)}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                # Emit the dict at indent 0, then shift continuation lines by the
                # width of "- " so keys align under the first key (valid YAML).
                sub: list[str] = []
                _emit(item, 0, sub)
                if sub:
                    lines.append(f"{pad}- {sub[0]}")
                    lines.extend(f"{' ' * (len(pad) + 2)}{line}" for line in sub[1:])
            elif isinstance(item, list):
                lines.append(f"{pad}-")
                _emit(item, indent + 1, lines)
            else:
                lines.append(f"{pad}- {_scalar(item)}")


def to_yaml(value: Any, *, header_comments: list[str] | None = None) -> str:
    """Emit deterministic YAML; optional comment lines are prepended verbatim."""
    lines: list[str] = []
    for comment in header_comments or []:
        lines.append(f"# {comment}")
    _emit(value, 0, lines)
    return "\n".join(lines) + "\n"
