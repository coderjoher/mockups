"""Same storage layout as the Node side: local directory or S3-compatible bucket."""
import os
import posixpath

from . import config


def _safe(key: str) -> str:
    norm = posixpath.normpath(key)
    if norm.startswith("..") or norm.startswith("/") or "\0" in norm:
        raise ValueError("invalid storage key")
    return norm


class LocalStorage:
    def __init__(self, root: str | None = None):
        self.root = root or config.STORAGE_DIR

    def _path(self, key: str) -> str:
        return os.path.join(self.root, _safe(key))

    def get(self, key: str) -> bytes:
        with open(self._path(key), "rb") as f:
            return f.read()

    def put(self, key: str, body: bytes, content_type: str | None = None) -> None:
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)

    def delete(self, key: str) -> None:
        try:
            os.remove(self._path(key))
        except FileNotFoundError:
            pass


class S3Storage:
    def __init__(self):
        import boto3

        self.client = boto3.client("s3", **{k: v for k, v in config.S3.items() if v})

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=config.S3_BUCKET, Key=_safe(key))["Body"].read()

    def put(self, key: str, body: bytes, content_type: str | None = None) -> None:
        extra = {"ContentType": content_type} if content_type else {}
        self.client.put_object(Bucket=config.S3_BUCKET, Key=_safe(key), Body=body, **extra)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=config.S3_BUCKET, Key=_safe(key))


_storage = None


def get_storage():
    global _storage
    if _storage is None:
        _storage = S3Storage() if config.STORAGE_DRIVER == "s3" else LocalStorage()
    return _storage
