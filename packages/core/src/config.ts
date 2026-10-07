// Central place for environment configuration shared by the API and workers.
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/mockups',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  storageDir: process.env.STORAGE_DIR ?? '.data/storage',
  publicApiUrl: process.env.PUBLIC_API_URL ?? 'http://127.0.0.1:4000',
  secret: process.env.APP_SECRET ?? 'dev-secret-change-me',
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    bucket: process.env.S3_BUCKET ?? 'mockups',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
  queuePrefix: process.env.QUEUE_PREFIX ?? 'mockups',
};
