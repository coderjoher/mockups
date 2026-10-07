import os

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://postgres@127.0.0.1:5432/mockups")
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
QUEUE_PREFIX = os.environ.get("QUEUE_PREFIX", "mockups")
STORAGE_DRIVER = os.environ.get("STORAGE_DRIVER", "local")
STORAGE_DIR = os.environ.get("STORAGE_DIR", ".data/storage")
S3 = {
    "endpoint_url": os.environ.get("S3_ENDPOINT"),
    "region_name": os.environ.get("S3_REGION", "auto"),
    "aws_access_key_id": os.environ.get("S3_ACCESS_KEY_ID"),
    "aws_secret_access_key": os.environ.get("S3_SECRET_ACCESS_KEY"),
}
S3_BUCKET = os.environ.get("S3_BUCKET", "mockups")
