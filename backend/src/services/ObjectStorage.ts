/**
 * Object storage for user-uploaded files (currently vendor invoice PDFs).
 *
 * Backs onto Backblaze B2 using its native API — no SDK, so nothing is added to the
 * deploy bundle. Uses the same three credentials as the nightly backup workflow, so a
 * single application key covers both:
 *
 *   B2_KEY_ID     application key id
 *   B2_APP_KEY    application key
 *   B2_BUCKET     bucket name (e.g. GTA-CPR-Backups)
 *
 * Entirely optional. When the variables are absent `isConfigured()` returns false and
 * every method is a no-op, so the app behaves exactly as it did before. Callers keep
 * writing to local disk; this mirrors the file offsite within seconds of upload, closing
 * the up-to-24-hour window left by the nightly backup (audit item S2).
 */
import { createHash } from 'node:crypto';
import { logger } from '../config/logger.js';

interface AuthContext {
  apiUrl: string;
  downloadUrl: string;
  authorizationToken: string;
  bucketId: string | null;
  expiresAt: number;
}

const AUTH_TTL_MS = 12 * 60 * 60 * 1000; // B2 tokens last 24h; refresh well before that
const PREFIX = 'uploads';

function credentials() {
  const keyId = process.env.B2_KEY_ID;
  const appKey = process.env.B2_APP_KEY;
  const bucket = process.env.B2_BUCKET;
  return keyId && appKey && bucket ? { keyId, appKey, bucket } : null;
}

export class ObjectStorage {
  private static auth: AuthContext | null = null;

  /** True when B2 credentials are present. Callers must tolerate false. */
  static isConfigured(): boolean {
    return credentials() !== null;
  }

  private static async authorize(): Promise<AuthContext | null> {
    const creds = credentials();
    if (!creds) return null;
    if (this.auth && this.auth.expiresAt > Date.now()) return this.auth;

    const basic = Buffer.from(`${creds.keyId}:${creds.appKey}`).toString('base64');
    const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new Error(`B2 authorize failed: HTTP ${res.status}`);
    const body = (await res.json()) as {
      apiInfo: { storageApi: { apiUrl: string; downloadUrl: string; bucketId: string | null } };
      authorizationToken: string;
    };

    this.auth = {
      apiUrl: body.apiInfo.storageApi.apiUrl,
      downloadUrl: body.apiInfo.storageApi.downloadUrl,
      authorizationToken: body.authorizationToken,
      bucketId: body.apiInfo.storageApi.bucketId ?? null,
      expiresAt: Date.now() + AUTH_TTL_MS,
    };
    return this.auth;
  }

  private static async bucketId(auth: AuthContext, bucket: string): Promise<string> {
    // A key restricted to one bucket already carries its id.
    if (auth.bucketId) return auth.bucketId;
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_list_buckets?accountId=&bucketName=${encodeURIComponent(bucket)}`, {
      headers: { Authorization: auth.authorizationToken },
    });
    if (!res.ok) throw new Error(`B2 list_buckets failed: HTTP ${res.status}`);
    const body = (await res.json()) as { buckets: Array<{ bucketId: string }> };
    const id = body.buckets?.[0]?.bucketId;
    if (!id) throw new Error(`B2 bucket not found: ${bucket}`);
    return id;
  }

  /**
   * Upload a file. `key` is a path within the bucket, e.g. "vendor-invoices/invoice-1.pdf"
   * (stored under an `uploads/` prefix). Returns true on success.
   */
  static async put(key: string, data: Buffer, contentType: string): Promise<boolean> {
    const creds = credentials();
    if (!creds) return false;
    try {
      const auth = await this.authorize();
      if (!auth) return false;
      const bucketId = await this.bucketId(auth, creds.bucket);

      const urlRes = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url?bucketId=${bucketId}`, {
        headers: { Authorization: auth.authorizationToken },
      });
      if (!urlRes.ok) throw new Error(`B2 get_upload_url failed: HTTP ${urlRes.status}`);
      const { uploadUrl, authorizationToken } = (await urlRes.json()) as {
        uploadUrl: string;
        authorizationToken: string;
      };

      const sha1 = createHash('sha1').update(data).digest('hex');
      const fileName = `${PREFIX}/${key}`.replace(/^\/+/, '');

      const upRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: authorizationToken,
          'X-Bz-File-Name': encodeURIComponent(fileName),
          'Content-Type': contentType || 'application/octet-stream',
          'Content-Length': String(data.length),
          'X-Bz-Content-Sha1': sha1,
        },
        body: new Uint8Array(data),
      });
      if (!upRes.ok) throw new Error(`B2 upload failed: HTTP ${upRes.status} ${await upRes.text()}`);

      logger.info({ key: fileName, bytes: data.length }, 'File mirrored to object storage');
      return true;
    } catch (err) {
      // Never fail the user's request because the offsite mirror is unavailable —
      // the nightly backup job is the safety net.
      logger.warn({ err, key }, 'Object storage upload failed (file remains on local disk)');
      this.auth = null; // force re-auth next time
      return false;
    }
  }

  /** Download a previously stored file, or null if missing/unavailable. */
  static async get(key: string): Promise<Buffer | null> {
    const creds = credentials();
    if (!creds) return null;
    try {
      const auth = await this.authorize();
      if (!auth) return null;
      const fileName = `${PREFIX}/${key}`.replace(/^\/+/, '');
      const res = await fetch(
        `${auth.downloadUrl}/file/${encodeURIComponent(creds.bucket)}/${fileName.split('/').map(encodeURIComponent).join('/')}`,
        { headers: { Authorization: auth.authorizationToken } }
      );
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      logger.warn({ err, key }, 'Object storage download failed');
      this.auth = null;
      return null;
    }
  }
}
