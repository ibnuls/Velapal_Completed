import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { StorageAdapter } from "./storage.adapter";
import { sha256 } from "../utils/crypto";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8000";
const API_BASE = process.env.API_INTERNAL_BASE_URL || "http://localhost:4000";
const TOKEN = process.env.WORKER_TO_AI_SECRET || "velapal-worker-to-ai-secret-v61";
class WorkerFailure extends Error {
  constructor(public code: string, public retryable = true) { super(code); }
}
async function aiPost(path: string, body: any) {
  let response: Response;
  try { response = await fetch(`${AI_BASE}${path}`, { method: "POST", signal: AbortSignal.timeout(130_000),
    headers: { "Content-Type": "application/json", "X-Worker-Service-Token": TOKEN }, body: JSON.stringify(body) }); }
  catch { throw new WorkerFailure("AI_UNAVAILABLE"); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new WorkerFailure(error.error?.code || `AI_HTTP_${response.status}`, error.error?.retryable ?? (response.status >= 500 || response.status === 429));
  }
  return response.json();
}
let polling = false;
export async function processOutboxOnce() {
  if (polling) return;
  polling = true;
  let job: any;
  try {
    const now = new Date();
    job = await prisma.outboxJob.findFirst({ where: { state: { in: ["PENDING", "LEASED"] }, nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: { createdAt: "asc" } });
    if (!job) return;
    const claimed = await prisma.outboxJob.updateMany({ where: { id: job.id, retryCount: job.retryCount,
      state: { in: ["PENDING", "LEASED"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { state: "LEASED", leaseUntil: new Date(Date.now() + 180_000), retryCount: { increment: 1 } } });
    if (!claimed.count) { job = undefined; return; }
    const p = job.payload;
    if (job.jobType === "SCAN_AND_INDEX_SOURCE") {
      const s = await prisma.caseSource.findUnique({ where: { id: p.sourceId } });
      if (s && s.audience !== "REVOKED") {
        const c = (await prisma.disputeCase.findUnique({ where: { id: s.caseId } }))!;
        const bytes = await StorageAdapter.readObjectBytes(s.objectKey);
        const signatureOK = s.mime === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" :
          s.mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
          s.mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216;
        if (!signatureOK || bytes.length !== s.byteCount || bytes.length > 5 * 1024 * 1024)
          throw new WorkerFailure("EVIDENCE_BYTES_INVALID", false);
        const readToken = `hdl_${crypto.randomBytes(24).toString("hex")}`;
        const expiresAt = new Date(Date.now() + 15 * 60_000);
        // Dev content validation only. No claim that this replaces a malware scanner.
        const changed = await prisma.caseSource.updateMany({ where: { id: s.id, sourceVersion: s.sourceVersion,
          audience: { not: "REVOKED" } }, data: { sha256: sha256(bytes), readToken, readExpiresAt: expiresAt } });
        if (!changed.count) throw new WorkerFailure("SOURCE_ACCESS_CHANGED", true);
        await aiPost("/internal/v1/evidence-index", { jobId: job.id, tenantId: c.merchantId, caseId: c.id,
          sourceId: s.id, sourceVersion: s.sourceVersion, accessRevision: c.accessRevision, audience: s.audience,
          mime: s.mime, sha256: sha256(bytes), embeddingSpace: process.env.AI_EMBEDDING_SPACE || "gemini-embedding-001-dim768",
          retentionUntil: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(), readHandle: {
            url: `${API_BASE}/internal/v1/sources/${s.id}/bytes?v=${s.sourceVersion}&jobId=${job.id}&token=${readToken}`,
            expiresAt: expiresAt.toISOString() } });
        const ready = await prisma.caseSource.updateMany({ where: { id: s.id, sourceVersion: s.sourceVersion,
          audience: { not: "REVOKED" } }, data: { scanState: "CLEAN" } });
        if (!ready.count) throw new WorkerFailure("SOURCE_ACCESS_CHANGED", true);
      }
    } else if (job.jobType === "REVOKE_SOURCE") {
      await aiPost("/internal/v1/evidence-revoke", { jobId: job.id, tenantId: p.tenantId, caseId: p.caseId,
        sourceId: p.sourceId, revokedUpToVersion: p.revokedUpToVersion, accessRevision: p.accessRevision });
    } else if (["RUN_AI_ASSESSMENT", "RESUME_AI_ASSESSMENT"].includes(job.jobType)) {
      await prisma.agentRun.updateMany({ where: { id: p.runId, status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "RUNNING" } });
      const path = job.jobType === "RESUME_AI_ASSESSMENT" ? `/internal/v1/case-runs/${p.runId}/resume` : "/internal/v1/case-runs";
      await aiPost(path, { runId: p.runId, purpose: p.purpose || "SHARED_ASSESSMENT",
        expectedContextVersion: p.expectedContextVersion, traceId: job.traceId, ...(p.decisionId ? { decisionId: p.decisionId } : {}) });
      // Express checkpoint endpoint is the sole owner of AgentRun and case control updates.
      const run = await prisma.agentRun.findUnique({ where: { id: p.runId } });
      if (!run || ["QUEUED", "RUNNING"].includes(run.status)) throw new WorkerFailure("CHECKPOINT_MISSING");
    } else throw new WorkerFailure("UNKNOWN_JOB_TYPE", false);
    await prisma.outboxJob.update({ where: { id: job.id }, data: { state: "COMPLETED", leaseUntil: null } });
  } catch (error) {
    if (!job) { console.error("[OutboxWorker] poll failed"); return; }
    const e = error instanceof WorkerFailure ? error : new WorkerFailure("DEPENDENCY_UNAVAILABLE");
    // CAS rejection is a handled stale run, not a completed AI result.
    if (["STALE_CONTEXT", "SOURCE_ACCESS_CHANGED"].includes(e.code) && job.payload.runId) {
      await prisma.agentRun.update({ where: { id: job.payload.runId }, data: { status: "STALE" } });
      await prisma.outboxJob.update({ where: { id: job.id }, data: { state: "COMPLETED", leaseUntil: null } });
      return;
    }
    const terminal = !e.retryable || job.retryCount + 1 >= 5;
    await prisma.outboxJob.update({ where: { id: job.id }, data: { state: terminal ? "FAILED" : "PENDING", leaseUntil: null,
      nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2000 * 2 ** job.retryCount)) } });
    if (terminal && job.payload.runId) await prisma.agentRun.updateMany({ where: { id: job.payload.runId,
      status: { in: ["QUEUED", "RUNNING"] } }, data: { status: "FAILED" } });
    if (terminal && job.jobType === "SCAN_AND_INDEX_SOURCE") await prisma.caseSource.updateMany({ where: {
      id: job.payload.sourceId, scanState: "SCANNING" }, data: { scanState: "REJECTED" } });
    console.error(`[OutboxWorker] ${job.id}: ${e.code}; ${terminal ? "FAILED" : "retry queued"}`);
  } finally { polling = false; }
}
export function startDurableOutboxWorker(pollIntervalMs = Number(process.env.OUTBOX_POLL_MS || 2500)) {
  const timer = setInterval(() => { void processOutboxOnce(); }, pollIntervalMs);
  return () => clearInterval(timer);
}
