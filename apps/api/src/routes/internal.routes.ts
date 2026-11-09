import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAiCallbackAuth } from "../middleware/auth";
import { AppError, sendError, sendSuccess } from "../utils/envelope";
import { canonicalHash } from "../utils/crypto";
import { buildContext, signedContext, sourceVisible } from "../integrations/ai-context";
import { StorageAdapter } from "../integrations/storage.adapter";

export const internalRouter = Router();
internalRouter.use(requireAiCallbackAuth);

internalRouter.get("/sources/:sid/bytes", async (req, res) => {
  try {
    const s = await prisma.caseSource.findUnique({ where: { id: req.params.sid } });
    if (!s || s.audience === "REVOKED" || !["CLEAN", "SCANNING"].includes(s.scanState) || !s.readExpiresAt || s.readExpiresAt <= new Date() ||
      !req.query.token || s.readToken !== req.query.token || Number(req.query.v) !== s.sourceVersion)
      throw new AppError(403, "SOURCE_ACCESS_CHANGED", "Read handle is expired or source version changed");
    if (req.query.runId) {
      const run = await prisma.agentRun.findUnique({ where: { id: String(req.query.runId) } });
      if (!run || s.scanState !== "CLEAN" || run.caseId !== s.caseId || !sourceVisible(s, run)) throw new AppError(403, "FORBIDDEN", "Run cannot read source");
    } else {
      const job = await prisma.outboxJob.findUnique({ where: { id: String(req.query.jobId || "") } });
      if (!job || job.jobType !== "SCAN_AND_INDEX_SOURCE" || (job.payload as any).sourceId !== s.id || job.state !== "LEASED")
        throw new AppError(403, "FORBIDDEN", "Read handle has no active indexing job");
    }
    res.setHeader("Content-Type", s.mime);
    return res.send(await StorageAdapter.readObjectBytes(s.objectKey));
  } catch (err) { return sendError(res, err); }
});

internalRouter.get("/case-runs/:id/context", async (req, res) => {
  try {
    const ctx = await prisma.$transaction(async db => {
      const initial = await db.agentRun.findUnique({ where: { id: req.params.id } });
      if (!initial) throw new AppError(404, "NOT_FOUND", "AgentRun not found");
      if (initial.caseId) await db.$queryRaw`SELECT id FROM "DisputeCase" WHERE id = ${initial.caseId} FOR UPDATE`;
      await db.$queryRaw`SELECT id FROM "AgentRun" WHERE id = ${initial.id} FOR UPDATE`;
      const run = (await db.agentRun.findUnique({ where: { id: initial.id } }))!;
      const context = await signedContext(db, run);
      // Result is returned only if still current. A retry must never resurrect revoked input.
      if ((run.resultPayload as any)?.manifestHash === context.signedManifest.manifestHash && run.resultPayload) context.committedResult = run.resultPayload;
      if (req.query.decisionId) {
        const decision = await db.approvalRequest.findFirst({ where: { decisionId: String(req.query.decisionId),
          caseId: run.caseId || "", scope: "ALLOW_VOLUNTARY_MEDIATION", status: "APPROVED" } });
        if (!decision || decision.caseVersion !== context.caseVersion || decision.paramsHash !== context.signedManifest.manifestHash ||
          !decision.expiresAt || decision.expiresAt <= new Date() || context.control !== "RUNNING")
          throw new AppError(409, "REVIEW_DECISION_INVALID", "Review decision is missing, stale, or not approved");
        context.reviewDecision = { decisionId: decision.decisionId, runId: run.id, caseVersion: decision.caseVersion,
          manifestHash: decision.paramsHash, approved: true, expiresAt: decision.expiresAt.toISOString() };
      }
      return context;
    }, { timeout: 15000 });
    return res.json(ctx);
  } catch (err) { return sendError(res, err); }
});

// AI validates one indexing job against current authoritative ACL before and after Qdrant writes.
internalRouter.get("/index-jobs/:id/context", async (req, res) => {
  try {
    const job = await prisma.outboxJob.findUnique({ where: { id: req.params.id } });
    if (!job || job.jobType !== "SCAN_AND_INDEX_SOURCE" || job.state !== "LEASED") throw new AppError(409, "JOB_NOT_ACTIVE", "Index job is not active");
    const p = job.payload as any;
    const s = await prisma.caseSource.findUnique({ where: { id: p.sourceId } });
    const c = s && await prisma.disputeCase.findUnique({ where: { id: s.caseId } });
    if (!s || !c || s.audience === "REVOKED" || !["CLEAN", "SCANNING"].includes(s.scanState)) throw new AppError(409, "SOURCE_ACCESS_CHANGED", "Source not readable");
    return res.json({ jobId: job.id, tenantId: c.merchantId, caseId: c.id, sourceId: s.id,
      sourceVersion: s.sourceVersion, accessRevision: c.accessRevision, audience: s.audience,
      ownerId: s.ownerId, ownerParty: s.ownerParty, mime: s.mime, sha256: s.sha256, byteCount: s.byteCount });
  } catch (err) { return sendError(res, err); }
});

internalRouter.get("/revoke-jobs/:id/context", async (req, res) => {
  try {
    const job = await prisma.outboxJob.findUnique({ where: { id: req.params.id } });
    if (!job || job.jobType !== "REVOKE_SOURCE" || job.state !== "LEASED") throw new AppError(409, "JOB_NOT_ACTIVE", "Revocation job is not active");
    return res.json({ jobId: job.id, ...(job.payload as any) });
  } catch (err) { return sendError(res, err); }
});

internalRouter.post("/case-runs/:id/checkpoints", async (req, res) => {
  try {
    const body = req.body || {};
    const outcome = await prisma.$transaction(async db => {
      const initial = await db.agentRun.findUnique({ where: { id: req.params.id } });
      if (!initial) throw new AppError(404, "NOT_FOUND", "AgentRun not found");
      if (initial.caseId) await db.$queryRaw`SELECT id FROM "DisputeCase" WHERE id = ${initial.caseId} FOR UPDATE`;
      await db.$queryRaw`SELECT id FROM "AgentRun" WHERE id = ${initial.id} FOR UPDATE`;
      const run = (await db.agentRun.findUnique({ where: { id: initial.id } }))!;
      if (!body.hmacSignature || body.hmacSignature !== run.hmacSignature || body.manifestId !== run.manifestId ||
        body.replayId !== run.replayId || body.manifestHash !== run.manifestHash || !run.manifestExpiresAt || run.manifestExpiresAt <= new Date())
        throw new AppError(403, "MANIFEST_INVALID", "Current complete signed manifest is required");
      const { context, manifestHash } = await buildContext(db, run);
      if (body.inputVersion !== context.inputVersion || body.accessRevision !== context.accessRevision ||
        run.inputVersion !== context.inputVersion || manifestHash !== body.manifestHash) {
        await db.agentRun.update({ where: { id: run.id }, data: { status: "STALE" } });
        return { stale: true };
      }
      if (run.purpose === "SHARED_ASSESSMENT" && ["PAUSED", "MANUAL"].includes(context.control))
        throw new AppError(409, "CASE_CONTROL_BLOCKED", "Supervisor control prevents publishing a shared AI result");
      const r = body.resultPayload;
      if (!r || r.runId !== run.id || r.inputVersion !== context.inputVersion || r.manifestHash !== manifestHash ||
        r.audience !== run.audience || !["COMPLETED", "NEEDS_INFO", "ABSTAINED"].includes(r.status) ||
        !["live", "fixture"].includes(r.modelMode) || r.businessDataMode !== context.businessDataMode)
        throw new AppError(422, "RESULT_INVALID", "AI result does not match the run contract");
      // Only an approved review bound to this exact snapshot may replace a paused result.
      let reviewed = false;
      if (body.decisionId) {
        const d = await db.approvalRequest.findFirst({ where: { decisionId: body.decisionId, caseId: run.caseId || "",
          scope: "ALLOW_VOLUNTARY_MEDIATION", status: "APPROVED", paramsHash: manifestHash, caseVersion: context.caseVersion } });
        reviewed = !!(d?.expiresAt && d.expiresAt > new Date() && context.control === "RUNNING");
        if (!reviewed) throw new AppError(409, "REVIEW_DECISION_INVALID", "Review decision is invalid");
      }
      const prior = run.resultPayload as any;
      if (prior) {
        if (canonicalHash(prior) === canonicalHash(r)) return { committed: true, checkpointId: `cp_${run.id}`, duplicate: true };
        if (!reviewed || !prior.requiresHumanApproval || prior.reviewedDecisionId === body.decisionId)
          throw new AppError(409, "CHECKPOINT_CONFLICT", "A different result was already committed");
      }
      const allowed = new Set([...context.allowedSources.map((s: any) => `${s.sourceId}:${s.version}`),
        ...context.allowedMessages.map((m: any) => `${m.messageId}:${m.version}`),
        ...(context.transactionFacts ? [`${context.transactionFacts.snapshotSourceRef.sourceId}:1`] : []),
        ...(context.personalContext?.catalogItems || []).map((p: any) => `${p.id}:${p.catalogVersion}`),
        ...(context.personalContext?.recentTransactions || []).map((t: any) => `${t.id}:1`)]);
      for (const item of [...(r.verifiedFacts || []), ...(r.claims || []), ...(r.findings || [])]) {
        if (!Array.isArray(item.sourceRefs) || !item.sourceRefs.length || item.sourceRefs.some((s: any) => !allowed.has(`${s.sourceId}:${s.version}`)))
          throw new AppError(422, "REFERENCE_INVALID", "Result contains an unauthorized source reference");
      }
      await db.agentRun.update({ where: { id: run.id }, data: { status: r.status, resultPayload: r } });
      // A private run cannot alter the shared case workflow. Duplicate delivery never increments controlVersion.
      if (run.purpose === "SHARED_ASSESSMENT" && run.caseId && r.requiresHumanApproval && !reviewed && context.control === "RUNNING") {
        await db.disputeCase.update({ where: { id: run.caseId }, data: { control: "WAITING_ADMIN",
          controlVersion: { increment: 1 }, gateReason: "AI_REVIEW_REQUIRED" } });
      }
      return { committed: true, checkpointId: `cp_${run.id}`, caseVersion: context.caseVersion, accessRevision: context.accessRevision };
    }, { timeout: 15000 });
    if ("stale" in outcome) throw new AppError(409, "STALE_CONTEXT", "Evidence, privacy, or version changed; result was discarded");
    return sendSuccess(res, outcome);
  } catch (err) { return sendError(res, err); }
});
