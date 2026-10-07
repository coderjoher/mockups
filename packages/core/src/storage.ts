import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config';

export interface Storage {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds?: number): Promise<string>;
}

function safeKey(key: string): string {
  const norm = path.posix.normalize(key);
  if (norm.startsWith('..') || norm.startsWith('/') || norm.includes('\0')) throw new Error('invalid storage key');
  return norm;
}

export function signKey(key: string, exp: number): string {
  return createHmac('sha256', config.secret).update(`${key}:${exp}`).digest('base64url');
}

export function verifySignedKey(key: string, exp: number, sig: string, now = Date.now()): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const a = Buffer.from(signKey(key, exp));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Files on local disk, served by the API's /files route with HMAC-signed URLs. */
export class LocalStorage implements Storage {
  constructor(private root = config.storageDir, private baseUrl = config.publicApiUrl) {}
  private file(key: string) {
    return path.join(this.root, safeKey(key));
  }
  async put(key: string, body: Buffer) {
    const f = this.file(key);
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, body);
  }
  get(key: string) {
    return readFile(this.file(key));
  }
  async exists(key: string) {
    return stat(this.file(key)).then(() => true, () => false);
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async signedUrl(key: string, ttlSeconds = 3600) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.baseUrl}/files/${safeKey(key).split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${signKey(key, exp)}`;
  }
}

/** S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO). */
export class S3Storage implements Storage {
  private client = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    // MinIO and other self-hosted endpoints need path-style URLs; AWS S3 prefers virtual-hosted.
    forcePathStyle: Boolean(config.s3.endpoint),
    // Without keys the SDK's default chain applies (e.g. an EC2 instance role on AWS).
    credentials: config.s3.accessKeyId
      ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
      : undefined,
  });
  async put(key: string, body: Buffer, contentType?: string) {
    await this.client.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: safeKey(key) }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async exists(key: string) {
    return this.get(key).then(() => true, () => false);
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: safeKey(key) }));
  }
  signedUrl(key: string, ttlSeconds = 3600) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: config.s3.bucket, Key: safeKey(key) }), { expiresIn: ttlSeconds });
  }
}

let storage: Storage | undefined;
export function getStorage(): Storage {
  if (!storage) storage = config.storageDriver === 's3' ? new S3Storage() : new LocalStorage();
  return storage;
}
