import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'crypto';

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

@Injectable()
export class R2UploadService {
  private client(): S3Client {
    const endpoint = process.env.R2_ENDPOINT?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new ServiceUnavailableException(
        'Object storage is not configured (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)',
      );
    }
    return new S3Client({
      region: process.env.R2_REGION?.trim() || 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  private bucket(): string {
    const bucket = process.env.R2_BUCKET?.trim();
    if (!bucket) {
      throw new ServiceUnavailableException(
        'Object storage is not configured (R2_BUCKET)',
      );
    }
    return bucket;
  }

  isProductImageKey(s: string): boolean {
    return /^product_images\/[a-zA-Z0-9._/-]+$/.test(s);
  }

  isServiceCoverKey(s: string): boolean {
    return /^service_cover\/[a-zA-Z0-9._/-]+$/.test(s);
  }

  isServiceImageKey(s: string): boolean {
    return /^service_images\/[a-zA-Z0-9._/-]+$/.test(s);
  }

  async uploadProductImage(input: {
    sellerUserId: string;
    buffer: Buffer;
    contentType: string;
    originalName?: string;
  }): Promise<{ key: string }> {
    const ext = safeExt(input.originalName, input.contentType);
    const key = `product_images/${input.sellerUserId}/${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    await this.client().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );
    return { key };
  }

  async uploadServiceCover(input: {
    userId: string;
    buffer: Buffer;
    contentType: string;
    originalName?: string;
  }): Promise<{ key: string }> {
    const ext = safeExt(input.originalName, input.contentType);
    const key = `service_cover/${input.userId}/${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    await this.client().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );
    return { key };
  }

  async uploadServiceImage(input: {
    userId: string;
    buffer: Buffer;
    contentType: string;
    originalName?: string;
  }): Promise<{ key: string }> {
    const ext = safeExt(input.originalName, input.contentType);
    const key = `service_images/${input.userId}/${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    await this.client().send(
      new PutObjectCommand({
        Bucket: this.bucket(),
        Key: key,
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );
    return { key };
  }

  /** Deletes R2 objects under `product_images/{sellerUserId}/` only (safety). */
  async deleteKeysForSeller(
    sellerUserId: string,
    keys: Iterable<string>,
  ): Promise<void> {
    const prefix = `product_images/${sellerUserId}/`;
    const bucket = this.bucket();
    const client = this.client();
    for (const key of keys) {
      if (!this.isProductImageKey(key) || !key.startsWith(prefix)) {
        continue;
      }
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** Deletes R2 objects under service_cover/{userId}/ and service_images/{userId}/ only (safety). */
  async deleteServiceKeysForUser(userId: string, keys: Iterable<string>): Promise<void> {
    const coverPrefix = `service_cover/${userId}/`;
    const imagePrefix = `service_images/${userId}/`;
    const bucket = this.bucket();
    const client = this.client();
    for (const key of keys) {
      const okCover = this.isServiceCoverKey(key) && key.startsWith(coverPrefix);
      const okImage = this.isServiceImageKey(key) && key.startsWith(imagePrefix);
      if (!okCover && !okImage) continue;
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        // best-effort cleanup
      }
    }
  }

  async presignGetObject(key: string): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: key,
    });
    const ttl = Number(process.env.R2_GET_URL_TTL_SECONDS ?? '3600');
    return getSignedUrl(this.client(), cmd, {
      expiresIn: Number.isFinite(ttl) && ttl > 60 ? ttl : 3600,
    });
  }

  async expandImageRefsForResponse(raw: unknown): Promise<unknown> {
    if (typeof raw === 'string') {
      if (isHttpUrl(raw)) return raw;
      if (this.isProductImageKey(raw)) {
        try {
          return await this.presignGetObject(raw);
        } catch {
          return raw;
        }
      }
      if (this.isServiceCoverKey(raw) || this.isServiceImageKey(raw)) {
        try {
          return await this.presignGetObject(raw);
        } catch {
          return raw;
        }
      }
      return raw;
    }
    if (Array.isArray(raw)) {
      return Promise.all(raw.map((x) => this.expandImageRefsForResponse(x)));
    }
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        out[k] = await this.expandImageRefsForResponse(v);
      }
      return out;
    }
    return raw;
  }
}

function safeExt(filename: string | undefined, contentType: string): string {
  if (filename && /^[a-zA-Z0-9._-]{1,120}$/.test(filename)) {
    const m = filename.toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
    if (m) return m[1];
  }
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  if (contentType === 'image/heic') return '.heic';
  if (contentType === 'image/heif') return '.heif';
  if (contentType === 'image/bmp' || contentType === 'image/x-ms-bmp')
    return '.bmp';
  if (contentType === 'image/tiff' || contentType === 'image/x-tiff')
    return '.tif';
  if (contentType === 'image/avif') return '.avif';
  return '.jpg';
}
