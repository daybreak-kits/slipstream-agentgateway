"""AG backend TLS trust bundle (adapter-private).

The pinned 1.7 data plane does not use the Windows system trust store, so a
real HTTPS upstream fails with UnknownIssuer unless its config carries an
explicit root bundle. The generated config points at this stable, config-relative
path; the adapter materializes certifi's CA bundle there before apply. No process
environment variable is involved.
"""

from __future__ import annotations

import os
import tempfile

import certifi

CA_BUNDLE_RELATIVE_PATH = "ca/certifi-ca.pem"


def ensure_ca_bundle(config_dir: str) -> str | None:
    """Copy certifi's CA bundle beside the config; return the relative path."""
    if not config_dir:
        return None
    target = os.path.join(os.path.abspath(config_dir), *CA_BUNDLE_RELATIVE_PATH.split("/"))
    directory = os.path.dirname(target)
    os.makedirs(directory, exist_ok=True)
    source = certifi.where()
    with open(source, "rb") as handle:
        payload = handle.read()
    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
        os.replace(tmp_path, target)
    except BaseException:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
    return CA_BUNDLE_RELATIVE_PATH
