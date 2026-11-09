import crypto from "crypto";
import { AppError } from "../utils/envelope";
import { PayPalAdapter } from "./paypal.adapter";
import { canonicalHash, signManifestHmac } from "../utils/crypto";

export function contextVersion(run: any, c: any): number {
  return run.purpose === "SHARED_ASSESSMENT" ? c.caseVersion : c.privateContextVersion;
}
export function sourceVisible(source: any, run: any) {
  return source.audience !== "REVOKED" && (source.audience === "CASE_SHARED" ||
    source.audience === "PROVIDER_SHARED" || (run.audience === "PRIVATE" && source.ownerId === run.actorId));
}
export function shareParamsHash(c: any, s: any, audience = "CASE_SHARED") {
  return canonicalHash({ intent: "SHARE_SOURCE", caseId: c.id, sourceId: s.id,
    sourceVersion: s.sourceVersion, sha256: s.sha256, audience });
}
export function mediationBindings(c: any, run: any) {
  const r = run?.resultPayload;
  if (!r || run.purpose !== "SHARED_ASSESSMENT" || !["COMPLETED", "NEEDS_INFO"].includes(run.status) ||
    run.inputVersion !== c.caseVersion || run.accessRevision !== c.accessRevision ||
    !run.manifestHash || r.manifestHash !== run.manifestHash) return null;
  return { assessmentRunId: run.id, inputVersion: c.caseVersion, sourceDigest: run.manifestHash,
    mediationParamsHash: canonicalHash({ intent: "CONTINUE_MEDIATION", caseId: c.id,
      caseVersion: c.caseVersion, accessRevision: c.accessRevision, assessmentRunId: run.id, sourceDigest: run.manifestHash }) };
}

// Called while holding the case row lock. The manifest binds every input, including private ownership.
export async function buildContext(db: any, run: any) {
  const actor = await db.user.findUnique({ where: { id: run.actorId } });
  if (!actor || actor.status !== "ACTIVE") throw new AppError(403, "FORBIDDEN", "Run actor is inactive");
  let context: any = { contractVersion: "6.1.2", runId: run.id, actorId: run.actorId,
    purpose: run.purpose, audience: run.audience, prompt: run.prompt || "", policyVersion: "velapal-assistance-1",
    businessDataMode: "synthetic_fixture",
    inputVersion: 1, caseVersion: 1, privateContextVersion: 1, accessRevision: 1,
    caseId: null, tenantId: run.actorId, category: null, allowedSources: [], allowedMessages: [], control: "RUNNING" };
  if (!run.caseId) {
    if (run.purpose !== "PERSONAL_ASSISTANT") throw new AppError(422, "VALIDATION_ERROR", "Case purpose requires a case");
    const membership = await db.membership.findFirst({ where: { userId: run.actorId, status: "ACTIVE", workspace: { type: "CUSTOMER" } } });
    if (!membership) throw new AppError(403, "FORBIDDEN", "Personal assistant requires customer membership");
    context.personalContext = {
      catalogItems: await db.product.findMany({ take: 30, orderBy: { id: "asc" } }),
      recentTransactions: await db.transaction.findMany({ where: { customerId: run.actorId }, take: 10, orderBy: { createdAt: "desc" } }),
      // No invented subscription list or spending limit. Only server records are passed.
    };
  } else {
    const c = await db.disputeCase.findUnique({ where: { id: run.caseId } });
    if (!c) throw new AppError(404, "NOT_FOUND", "Case not found");
    const seller = await db.membership.findFirst({ where: { userId: run.actorId, status: "ACTIVE", workspace: { type: "SELLER", merchantId: c.merchantId } } });
    const party = run.actorId === c.customerId ? "CUSTOMER" : seller ? "SELLER" : null;
    if (!party || (run.purpose === "CUSTOMER_PREPARATION" && party !== "CUSTOMER") ||
      (run.purpose === "SELLER_PREPARATION" && party !== "SELLER")) throw new AppError(403, "FORBIDDEN", "Run actor is not an authorized case party");
    const sources = await db.caseSource.findMany({ where: { caseId: c.id, scanState: "CLEAN", audience: { not: "REVOKED" } }, orderBy: { id: "asc" } });
    const messages = await db.caseMessage.findMany({ where: { caseId: c.id, OR: [
      { audience: "CASE_SHARED" }, ...(run.audience === "PRIVATE" ? [{ authorId: run.actorId, audience: "PRIVATE" }] : [])
    ] }, orderBy: { id: "asc" }, take: 80 });
    const tx = c.transactionId ? await db.transaction.findUnique({ where: { id: c.transactionId } }) : null;
    const snapshot = tx ? await db.purchaseSnapshot.findUnique({ where: { id: tx.snapshotId } }) : null;
    // Seeded IDs and a global environment label alone never establish sandbox provenance.
    const providerRecord = tx?.paypalCaptureId && tx.verifiedAt && PayPalAdapter.isConfigured() &&
      process.env.AI_BUSINESS_DATA_MODE === "paypal_sandbox" &&
      (process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com") === "https://api-m.sandbox.paypal.com"
      ? await db.providerOperation.findFirst({ where: { type: "ORDER_CAPTURE", status: "SUCCEEDED",
          checkoutOrderId: tx.orderId, paypalCaptureId: tx.paypalCaptureId, verifiedAt: { not: null } } }) : null;
    context.businessDataMode = providerRecord ? "paypal_sandbox" : "synthetic_fixture";
    Object.assign(context, { caseId: c.id, tenantId: c.merchantId, actorParty: party, category: c.category,
      inputVersion: contextVersion(run, c), caseVersion: c.caseVersion, privateContextVersion: run.purpose === "SHARED_ASSESSMENT" ? 1 : c.privateContextVersion,
      accessRevision: c.accessRevision, control: c.control,
      transactionFacts: tx ? { transactionId: tx.id, orderId: tx.orderId, sku: snapshot?.sku || null,
        variantId: snapshot?.variantId || null, amountMinor: tx.amountMinor, currency: tx.currency,
        refundableRemainingMinor: tx.refundableRemainingMinor, paymentStatus: tx.paymentStatus,
        snapshotSourceRef: { sourceId: tx.snapshotId, version: 1, locator: "record:1" } } : null,
      allowedSources: sources.filter((s: any) => sourceVisible(s, run)).map((s: any) => ({ sourceId: s.id,
        version: s.sourceVersion, ownerId: s.ownerId, ownerParty: s.ownerParty, audience: s.audience,
        mime: s.mime, byteCount: s.byteCount, sha256: s.sha256, scanState: s.scanState })),
      allowedMessages: messages.map((m: any) => ({ messageId: m.id, party: m.authorParty,
        audience: m.audience, version: m.version, locator: `message:${m.id}`, text: m.text })) });
    // Seeded legacy statements have no CaseMessage; expose them as claims with explicit locators.
    for (const [p, text] of [["CUSTOMER", c.customerStatement], ["SELLER", c.sellerStatement]]) {
      if (text && !context.allowedMessages.some((m: any) => m.party === p && m.audience === "CASE_SHARED" && m.text === text))
        context.allowedMessages.push({ messageId: `statement:${c.id}:${p}`, party: p, audience: "CASE_SHARED",
          version: c.caseVersion, locator: `statement:${String(p).toLowerCase()}`, text });
    }
  }
  // Identity and input content are hashed; control is deliberately separate from evidence versioning.
  const { control, ...hashed } = context;
  const manifestHash = canonicalHash(hashed);
  return { context, manifestHash };
}

export async function signedContext(db: any, run: any) {
  const { context, manifestHash } = await buildContext(db, run);
  const reuse = run.manifestHash === manifestHash && run.manifestExpiresAt && run.manifestExpiresAt > new Date();
  const expiresAt = reuse ? run.manifestExpiresAt.toISOString() : new Date(Date.now() + 15 * 60_000).toISOString();
  const fields = { manifestId: reuse ? run.manifestId : `mf_${crypto.randomBytes(12).toString("hex")}`,
    replayId: reuse ? run.replayId : `rpl_${crypto.randomBytes(12).toString("hex")}`,
    runId: run.id, actorId: run.actorId, tenantId: context.tenantId, caseId: context.caseId,
    purpose: run.purpose, audience: run.audience, inputVersion: context.inputVersion,
    caseVersion: context.caseVersion, privateContextVersion: context.privateContextVersion,
    accessRevision: context.accessRevision, manifestHash, expiresAt };
  const hmacSignature = signManifestHmac(fields);
  await db.agentRun.update({ where: { id: run.id }, data: { manifestId: fields.manifestId,
    replayId: fields.replayId, manifestHash, hmacSignature, manifestExpiresAt: new Date(expiresAt) } });
  return { ...context, signedManifest: { ...fields, hmacSignature } };
}

// All touched domain mutations lock the same row before changing a versioned snapshot.
export async function lockCaseSnapshot(db: any, expected: any) {
  await db.$queryRaw`SELECT id FROM "DisputeCase" WHERE id = ${expected.id} FOR UPDATE`;
  const current = await db.disputeCase.findUnique({ where: { id: expected.id } });
  if (!current || current.caseVersion !== expected.caseVersion || current.accessRevision !== expected.accessRevision ||
    current.privateContextVersion !== expected.privateContextVersion || current.controlVersion !== expected.controlVersion)
    throw new AppError(409, "VERSION_CONFLICT", "Case changed during this action. Refresh and review the current version.");
}
