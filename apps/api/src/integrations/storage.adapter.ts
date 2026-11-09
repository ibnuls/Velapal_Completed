import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "../utils/envelope";
const s3 = new S3Client({ region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9002", forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin", secretAccessKey: process.env.S3_SECRET_KEY || "minioadminpassword" } });
const Bucket = process.env.S3_BUCKET || "velapal-private";
export const StorageAdapter = {
  async createQuarantineUploadUrl(Key: string, ContentType: string, expiresIn = 600) {
    return getSignedUrl(s3, new PutObjectCommand({ Bucket, Key, ContentType }), { expiresIn });
  },
  async readObjectBytes(Key: string): Promise<Buffer> {
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
      if (!r.Body || (r.ContentLength || 0) > 5 * 1024 * 1024) throw new Error("Invalid evidence size");
      const chunks: Buffer[] = []; let size = 0;
      for await (const part of r.Body as any) {
        const chunk = Buffer.from(part); size += chunk.length;
        if (size > 5 * 1024 * 1024) throw new Error("Evidence too large");
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch { throw new AppError(503, "STORAGE_UNAVAILABLE", "Evidence bytes could not be read from object storage", true); }
  },
};
