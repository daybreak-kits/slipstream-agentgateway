"""agentgateway --validate-only gate (ticket 08).

The pinned 1.7 binary is the only authority on whether a rendered config is
acceptable: ADR-010 E8 says the control plane must not rely on business rules
alone, and the spec requires a rejected config to never reach the data plane.
So every apply validates a *candidate* file with `--validate-only` before the
atomic replace; a failed validation leaves the previous config serving.

The binary is resolved in this order: explicit argument -> AG_BINARY env ->
PATH lookup. When none exists the gate is skipped
and the skip is recorded on the ApplyResult; nothing is silently assumed valid.
AG reads provider key files (relative to the config file) during validation, so
the candidate must live in the real config directory.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from collections.abc import Callable
from dataclasses import dataclass

ENV_BINARY = "AG_BINARY"
DEFAULT_TIMEOUT_SECONDS = 30.0
MAX_ERRORS = 10
MAX_ERROR_CHARS = 800


@dataclass(frozen=True, slots=True)
class BinaryValidation:
    """Outcome of one `--validate-only` run: displayable errors or a skip note."""

    ok: bool
    skipped: bool = False
    errors: tuple[str, ...] = ()
    note: str = ""


Validator = Callable[[str], BinaryValidation]


def find_binary(explicit: str | None = None) -> str | None:
    """Locate the pinned gateway binary; None means "not installed here"."""
    if explicit:
        return explicit if os.path.exists(explicit) else None
    env_value = os.environ.get(ENV_BINARY, "").strip()
    if env_value and os.path.exists(env_value):
        return env_value
    return shutil.which("agentgateway")


def build_validator(binary: str | None = None) -> Validator:
    """Return the candidate-file validator used by the applier.

    `None` auto-detects, `""` disables the gate explicitly, a non-empty string
    pins one binary. Both skip paths return `ok=True, skipped=True` with a note
    so the apply result can record why no binary check happened.
    """
    if binary == "":
        return lambda _path: BinaryValidation(
            ok=True,
            skipped=True,
            note="agentgateway --validate-only disabled (SLIPSTREAM_AG_BINARY='')",
        )
    resolved = find_binary(binary)
    if resolved is None:
        return lambda _path: BinaryValidation(
            ok=True,
            skipped=True,
            note="agentgateway binary not found; --validate-only skipped",
        )

    def validate(candidate_path: str) -> BinaryValidation:
        return run_validate(candidate_path, binary=resolved)

    return validate


def run_validate(
    config_path: str, *, binary: str, timeout: float = DEFAULT_TIMEOUT_SECONDS
) -> BinaryValidation:
    """Run `<binary> --validate-only -f <name>` next to the candidate file."""
    directory = os.path.dirname(os.path.abspath(config_path))
    name = os.path.basename(config_path)
    try:
        completed = subprocess.run(
            [binary, "--validate-only", "-f", name],
            cwd=directory,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        return BinaryValidation(
            ok=False,
            errors=(f"agentgateway 二进制不存在: {binary}",),
            note="agentgateway --validate-only could not start",
        )
    except subprocess.TimeoutExpired:
        return BinaryValidation(
            ok=False,
            errors=(f"agentgateway --validate-only 超过 {timeout:g}s 未返回",),
            note="agentgateway --validate-only timed out",
        )
    except OSError as exc:
        return BinaryValidation(
            ok=False,
            errors=(f"无法执行 agentgateway --validate-only: {exc}",),
            note="agentgateway --validate-only could not start",
        )
    stdout = _text(completed.stdout)
    stderr = _text(completed.stderr)
    if completed.returncode == 0:
        note = stdout.strip() or "agentgateway --validate-only: configuration is valid"
        return BinaryValidation(ok=True, note=note[:MAX_ERROR_CHARS])
    errors = _error_lines(stdout=stdout, stderr=stderr)
    if not errors:
        errors = (f"agentgateway --validate-only 退出码 {completed.returncode}",)
    return BinaryValidation(
        ok=False,
        errors=errors,
        note="agentgateway --validate-only rejected the configuration",
    )


def _text(payload: bytes | str | None) -> str:
    if payload is None:
        return ""
    if isinstance(payload, bytes):
        # The pinned Windows binary prints UTF-8; the console code page may not
        # be, so decode explicitly and never let one bad byte hide the error.
        return payload.decode("utf-8", "replace")
    return payload


def _error_lines(*, stdout: str, stderr: str) -> tuple[str, ...]:
    """Displayable error lines (stderr first), trimmed and capped."""
    lines: list[str] = []
    for line in (stderr + "\n" + stdout).splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("Error: "):
            stripped = stripped[len("Error: ") :]
        lines.append(stripped[:MAX_ERROR_CHARS])
        if len(lines) >= MAX_ERRORS:
            break
    return tuple(lines)
