// Test processes always talk to the test database, a separate Redis prefix and a temp storage dir.
process.env.DATABASE_URL ??= 'postgres://postgres@127.0.0.1:5432/mockups_test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL.replace(/\/mockups$/, '/mockups_test');
process.env.QUEUE_PREFIX = 'mockups-test';
process.env.STORAGE_DIR ??= '.data/test-storage';
process.env.JOB_BACKOFF_MS ??= '100';
process.env.APP_SECRET ??= 'test-secret';
