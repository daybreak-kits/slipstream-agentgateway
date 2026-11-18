"""Atomic config application for agentgateway (whitelist-directory enforced).

docs/contracts/adapter-spi.md §4: write temp file -> atomic rename -> confirm.
ADR-010 E8 flow: previous file kept in memory; after os.replace the file is read
back and compared against the artifact with AG-written session fields (session
key blocks re-serialized by the gateway on load) normalized away; any mismatch
restores the previous file immediately so the data plane keeps serving the old
configuration (reload failure leaves the in-memory config intact). E2: hot
reload never breaks in-flight SSE streams, so no process restart is needed here.

Ticket 08 adds the official-binary gate: before the target file is touched the
rendered candidate is validated with the pinned `agentgateway --validate-only`
inside the same directory (provider key files resolve relative to the config
file). A rejected candidate writes neither the config nor the marker, so the
previous config keeps serving and the displayable errors travel back on
ApplyResult.
"""

from __future__ import annotations

import hashlib
import os

from l01_core.errors import AppError, ErrorCode
from l03_adapters.agentgateway.binary_validate import BinaryValidation, Validator
from l03_adapters.spi import ApplyResult, Artifact, DataPlaneStatus


class ConfigApplier:
    """Applies artifacts into exactly one whitelisted directory; nothing else is writable."""

    def __init__(
        self,
        config_dir: str,
        filename: str = "config.yaml",
        validator: Validator | None = None,
    ) -> None:
        self._config_dir = os.path.abspath(config_dir)
        self._filename = filename
        self._validator = validator
        self._current: Artifact | None = None
        self._history: dict[str, Artifact] = {}

    @property
    def config_dir(self) -> str:
        return self._config_dir

    def _ensure_whitelisted(self) -> None:
        if not self._config_dir:
            raise AppError(ErrorCode.APPLY_FAILED, "未配置数据面配置目录白名单")

    def apply(self, artifact: Artifact) -> ApplyResult:
        """Validate the candidate, then atomically write; read back to confirm."""
        self._ensure_whitelisted()
        os.makedirs(self._config_dir, exist_ok=True)
        validation_note = ""
        if self._validator is not None:
            outcome = self._validate_candidate(artifact.content)
            if not outcome.ok:
                errors = outcome.errors or (
                    outcome.note or "agentgateway --validate-only rejected the configuration",
                )
                return ApplyResult(
                    ok=False,
                    message=(
                        "配置未通过 agentgateway --validate-only 校验，未写入任何文件"
                        "（旧配置继续服务）"
                    ),
                    rolled_back=False,
                    errors=errors,
                    validation_note=outcome.note,
                )
            validation_note = outcome.note
        target_path = os.path.join(self._config_dir, self._filename)
        previous_bytes: bytes | None = None
        if os.path.exists(target_path):
            with open(target_path, "rb") as handle:
                previous_bytes = handle.read()
        fd, tmp_path = tempfile_named(self._config_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(artifact.content)
            os.replace(tmp_path, target_path)
        except OSError as exc:
            cleanup_quietly(tmp_path)
            return ApplyResult(
                ok=False,
                message=f"写入配置失败: {exc}",
                rolled_back=True,
                validation_note=validation_note,
            )
        # Read-back confirmation: compare normalized content (E8). AG may rewrite
        # its session.* state on load; those lines are stripped on both sides.
        try:
            with open(target_path, encoding="utf-8") as handle:
                read_back = handle.read()
        except OSError as exc:
            self._restore(target_path, previous_bytes)
            return ApplyResult(
                ok=False,
                message=f"读回配置失败: {exc}",
                rolled_back=True,
                validation_note=validation_note,
            )
        if strip_session_fields(read_back) != strip_session_fields(artifact.content):
            self._restore(target_path, previous_bytes)
            return ApplyResult(
                ok=False,
                message="配置读回校验失败：已回滚上一版（旧配置继续服务）",
                rolled_back=True,
                validation_note=validation_note,
            )
        file_hash = hash_normalized_text(read_back)
        if artifact.revision:
            self._history[artifact.revision] = artifact
        self._current = artifact
        # Applied-hash marker: the read-back confirmation contract for status()
        # and for the data-plane status endpoint (adapter-spi.md §4).
        marker_path = os.path.join(self._config_dir, self._filename + ".hash")
        fd2, tmp_marker = tempfile_named(self._config_dir)
        with os.fdopen(fd2, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(artifact.hash)
        os.replace(tmp_marker, marker_path)
        return ApplyResult(
            ok=True,
            applied_hash=artifact.hash,
            revision_id=artifact.revision or None,
            file_hash=file_hash,
            validation_note=validation_note,
        )

    def _validate_candidate(self, content: str) -> BinaryValidation:
        """Run the injected gate on a candidate inside the real config directory."""
        fd, candidate_path = tempfile_named(self._config_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
        except OSError as exc:
            cleanup_quietly(candidate_path)
            return BinaryValidation(
                ok=False,
                errors=(f"校验候选配置写入失败: {exc}",),
                note="agentgateway --validate-only 未执行",
            )
        try:
            assert self._validator is not None  # guarded by the caller
            return self._validator(candidate_path)
        except Exception as exc:  # a broken gate must fail closed, never skip
            return BinaryValidation(
                ok=False,
                errors=(f"agentgateway --validate-only 执行异常: {exc}",),
                note="agentgateway --validate-only 未完成",
            )
        finally:
            cleanup_quietly(candidate_path)

    def _restore(self, target_path: str, previous_bytes: bytes | None) -> None:
        """Put the previous file content back; the old config keeps serving (E8)."""
        if previous_bytes is None:
            try:
                os.remove(target_path)
            except OSError:
                pass
            return
        fd, tmp_path = tempfile_named(self._config_dir)
        with os.fdopen(fd, "wb") as handle:
            handle.write(previous_bytes)
        os.replace(tmp_path, target_path)

    def rollback(self, revision_id: str) -> ApplyResult:
        """Re-apply a stored previous revision; unknown ids are refused."""
        target = self._history.get(revision_id)
        if target is None:
            return ApplyResult(ok=False, message=f"未知回滚目标: {revision_id}", rolled_back=False)
        result = self.apply(target)
        return ApplyResult(
            ok=result.ok,
            applied_hash=result.applied_hash,
            message=result.message or "rolled back",
            rolled_back=True,
            revision_id=revision_id,
            errors=result.errors,
            file_hash=result.file_hash,
            validation_note=result.validation_note,
        )

    def status(self) -> DataPlaneStatus:
        """Hash of the config file the data plane is actually serving (S5).

        The file is the truth: we re-read it after apply, normalize AG-owned
        session fields away and hash the same way the marker was computed, then
        compare with the last recorded apply. A hand-edited or externally
        replaced file therefore reports drift instead of echoing the marker.
        The marker is only a fallback when the file has disappeared.
        """
        applied_hash = self._read_marker()
        current_hash = _sha256_normalized(os.path.join(self._config_dir, self._filename))
        if current_hash is None:
            detail = (
                "config file missing; hash from last apply marker"
                if applied_hash
                else "no config applied yet"
            )
            return DataPlaneStatus(config_hash=applied_hash, detail=detail)
        if applied_hash is None:
            return DataPlaneStatus(
                config_hash=current_hash, detail="config file present; no apply marker"
            )
        if current_hash == applied_hash:
            return DataPlaneStatus(
                config_hash=current_hash, detail="config file matches last applied hash"
            )
        return DataPlaneStatus(
            config_hash=current_hash,
            detail=f"config drift: file {current_hash[:12]} != applied {applied_hash[:12]}",
        )

    def _read_marker(self) -> str | None:
        """Hash written by the last successful apply; None when never applied."""
        marker_path = os.path.join(self._config_dir, self._filename + ".hash")
        if not os.path.exists(marker_path):
            return None
        with open(marker_path, encoding="utf-8") as handle:
            return handle.read().strip() or None


def normalized_text(text: str) -> str:
    """File text with AG session state stripped, preserving the trailing newline."""
    normalized = "\n".join(strip_session_fields(text))
    if text.endswith("\n"):
        normalized += "\n"
    return normalized


def hash_normalized_text(text: str) -> str:
    """sha256 of the normalized text; comparable with the apply marker."""
    return hashlib.sha256(normalized_text(text).encode("utf-8")).hexdigest()


def _sha256_normalized(path: str) -> str | None:
    """sha256 of the file with AG session state stripped; None when unreadable.

    The apply marker stores sha256(artifact.content) while AG may inject its own
    session.* block on load, so hashing the raw file would always look like
    drift. Normalizing both sides keeps the comparison meaningful.
    """
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return None
    return hash_normalized_text(text)


def strip_session_fields(text: str) -> list[str]:
    """Drop AG-owned session state lines so read-back comparison is stable.

    Removes any line opening a top-level 'session:' block plus its indented
    body, and any inline 'session.key' leftovers. Returns the kept lines.
    """
    kept: list[str] = []
    skipping = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("session:") and not line.startswith((" ", "\t")):
            skipping = True
            continue
        if skipping:
            if line.startswith((" ", "\t")) or stripped == "":
                continue
            skipping = False
        if "session.key" in stripped:
            continue
        kept.append(line)
    return kept


def tempfile_named(directory: str) -> tuple[int, str]:
    """Small wrapper so tests can monkeypatch determinism if ever needed."""
    import tempfile

    return tempfile.mkstemp(dir=directory, suffix=".tmp")


def cleanup_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass
