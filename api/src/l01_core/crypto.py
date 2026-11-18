"""At-rest cryptography: upstream keys (Fernet) and client keys (AES-GCM, ADR-008)."""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from l01_core.errors import AppError, ErrorCode


class SecretBox:
    """Fernet box for upstream keys; recoverable for key-file materialization."""

    def __init__(self, master_key: str) -> None:
        digest = hashlib.sha256(master_key.encode("utf-8")).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except InvalidToken:
            raise AppError(
                ErrorCode.CRYPTO_FAILED, "upstream key decryption failed"
            ) from None


class AesGcmBox:
    """AES-256-GCM box for client key plaintext (ADR-008: recoverable, audited reveal)."""

    _NONCE_BYTES = 12

    def __init__(self, master_key: str) -> None:
        self._key = hashlib.sha256(master_key.encode("utf-8")).digest()

    def encrypt(self, plaintext: str) -> str:
        nonce = os.urandom(self._NONCE_BYTES)
        ciphertext = AESGCM(self._key).encrypt(nonce, plaintext.encode("utf-8"), None)
        return base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")

    def decrypt(self, token: str) -> str:
        try:
            raw = base64.urlsafe_b64decode(token.encode("ascii"))
            nonce, ciphertext = raw[: self._NONCE_BYTES], raw[self._NONCE_BYTES :]
            plaintext = AESGCM(self._key).decrypt(nonce, ciphertext, None)
            return plaintext.decode("utf-8")
        except Exception:
            raise AppError(ErrorCode.CRYPTO_FAILED, "client key decryption failed") from None


def fingerprint(text: str) -> str:
    """Short stable fingerprint for logs/diffs; never used as a key hash."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def sha256_hex(text: str) -> str:
    """Plain sha256 hex form; exactly what AG keyHash expects (ADR-008 item 4)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
