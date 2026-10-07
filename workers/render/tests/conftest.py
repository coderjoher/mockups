import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("DATABASE_URL", "postgres://postgres@127.0.0.1:5432/mockups_test")
os.environ["QUEUE_PREFIX"] = "mockups-pytest"
