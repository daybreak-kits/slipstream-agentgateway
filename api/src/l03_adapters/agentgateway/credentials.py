"""agentgateway credential-file materialization (W6 ticket 01 port).

The system layer owns credential *metadata* only. This adapter-private module
owns the on-disk format, atomic writes and the managed ``keys/`` whitelist; the
service layer hands over credential intents through ``materialize_credentials``
(ticket 03) and never learns a key file path or how to prune one.
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Sequence

from l03_adapters.spi import CredentialFile, MaterializationResult


def _managed_dir(config_dir: str) -> str:
    return os.path.join(os.path.abspath(config_dir), "keys") if config_dir else ""


def _identity(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _file_path(config_dir: str, file: CredentialFile) -> str:
    if file.path:
        return file.path
    managed = _managed_dir(config_dir)
    if not managed:
        return ""
    safe_ref = file.ref.replace("/", "_").replace("\\", "_")
    return os.path.join(managed, safe_ref + ".key")


def _stale_files(managed: str, whitelist: set[str]) -> list[str]:
    if not managed or not os.path.isdir(managed):
        return []
    stale: list[str] = []
    for entry in sorted(os.scandir(managed), key=lambda item: item.name):
        if entry.is_symlink() or not entry.is_file() or not entry.name.endswith(".key"):
            continue
        if _identity(entry.path) in whitelist:
            continue
        stale.append(entry.path)
    return stale


def materialize(
    config_dir: str,
    files: Sequence[CredentialFile],
    *,
    dry_run: bool = False,
    prune: bool = True,
    prune_only: bool = False,
) -> MaterializationResult:
    """Write credential files, then prune managed *.key files outside the whitelist.

    A missing destination path is a no-op for that row (the system may still be
    building a metadata-only plan). Pruning never leaves the managed ``keys/``
    directory, never touches non-.key files or symlinks, and per-file failures
    are reported instead of raised so an apply can log and continue.
    ``prune=False`` writes only and leaves the whitelist cleanup for the
    follow-up pass (the rollout materializes before its apply gate);
    ``prune_only=True`` runs that cleanup pass WITHOUT rewriting the whitelist
    files -- their bytes are already on disk from the write phase (W6 review
    P2-1).
    """
    targets: list[tuple[str, str]] = []
    for file in files:
        path = _file_path(config_dir, file)
        if path:
            targets.append((path, file.plaintext))
    whitelist = {_identity(path) for path, _ in targets}
    managed = _managed_dir(config_dir)
    stale = _stale_files(managed, whitelist) if (prune or prune_only) else []
    if dry_run:
        return MaterializationResult(dry_run=True, stale=tuple(stale))

    written: list[str] = []
    failed: list[str] = []
    if not prune_only:  # cleanup-only pass: the whitelist bytes stay untouched
        for path, plaintext in targets:
            try:
                directory = os.path.dirname(path)
                if directory:
                    os.makedirs(directory, exist_ok=True)
                fd, tmp_path = tempfile.mkstemp(dir=directory or ".", suffix=".tmp")
                try:
                    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                        handle.write(plaintext)
                    os.replace(tmp_path, path)
                except BaseException:
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
                    raise
            except OSError:
                failed.append(path)
            else:
                written.append(path)

    deleted: list[str] = []
    for path in stale:
        try:
            os.remove(path)
        except OSError:
            failed.append(path)
        else:
            deleted.append(path)
    return MaterializationResult(
        written=tuple(written),
        stale=tuple(stale),
        deleted=tuple(deleted),
        failed=tuple(failed),
    )


__all__ = ["materialize"]
