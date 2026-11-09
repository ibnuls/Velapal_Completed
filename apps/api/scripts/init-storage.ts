import "dotenv/config";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
const client = new S3Client({ endpoint: process.env.S3_ENDPOINT || "http://localhost:9002", region: process.env.S3_REGION || "us-east-1",
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin", secretAccessKey: process.env.S3_SECRET_KEY || "minioadminpassword" } });
async function main() {
  const Bucket = process.env.S3_BUCKET || "velapal-private";
  try { await client.send(new HeadBucketCommand({ Bucket })); }
  catch (e: any) {
    if (e?.$metadata?.httpStatusCode !== 404) throw e;
    await client.send(new CreateBucketCommand({ Bucket }));
  }
  console.log("Private evidence bucket ready (no public-read policy added).");
}
main().catch(() => { console.error("Object storage initialization failed. Check S3 configuration."); process.exitCode = 1; });
