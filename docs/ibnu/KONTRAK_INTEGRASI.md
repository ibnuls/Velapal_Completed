# Kontrak integrasi 6.1.2

Basis enum/status/DTO: `packages/contracts/index.ts` dan route backend pada SHA `95cfe69`. Penambahan metadata bersifat adapter; UI lama tetap mendapat field intinya. Request yang sebelumnya diterima tanpa scope/hash sekarang ditolak bila tidak valid.

## Arah request

| Pemanggil → tujuan | Endpoint | Auth / hasil |
|---|---|---|
| Browser → Express | `POST /api/v1/agent/runs` | Session + CSRF; personal/customer/seller preparation; QUEUED + runId |
| Browser → Express | `POST /api/v1/disputes/:id/assessments` | Session, CSRF, If-Match caseVersion; SHARED_ASSESSMENT |
| Worker → AI | `POST /internal/v1/case-runs` | `X-Worker-Service-Token`; `{runId,purpose,expectedContextVersion,traceId}` |
| Worker → AI | `POST /internal/v1/case-runs/:id/resume` | Token worker; tambah `decisionId`, runId harus cocok URL |
| Worker → AI | `POST /internal/v1/evidence-index` | Token worker; job/source/version/scope/MIME/SHA/embeddingSpace/retention/readHandle |
| Worker → AI | `POST /internal/v1/evidence-revoke` | Token worker; `{jobId,tenantId,caseId,sourceId,revokedUpToVersion,accessRevision}` |
| AI → Express | `GET /internal/v1/case-runs/:id/context` | `X-AI-Callback-Token`; identitas, prompt, versi, fakta server, pesan/sumber diizinkan, manifest HMAC |
| AI → Express | `GET /internal/v1/index-jobs/:id/context` | Token callback; verifikasi scope indeks sebelum/sesudah upsert |
| AI → Express | `GET /internal/v1/revoke-jobs/:id/context` | Token callback; verifikasi scope purge dari outbox aktif |
| AI → Express | `GET /internal/v1/sources/:sid/bytes` | Token callback + handle token berumur pendek + v + runId/jobId; tidak menerima URL bebas |
| AI → Express | `POST /internal/v1/case-runs/:id/checkpoints` | Token callback + manifest lengkap + result; hasil `{data:{committed:true,...},meta:...}` |
| Browser → Express | `GET /api/v1/agent/runs/:id` | Actor yang berhak; hasil stale terhadap ACL/version disembunyikan |

## Snapshot dan checkpoint

Manifest memuat identitas run/actor/tenant/case/purpose/audience, versi, hash isi input, expiry dan HMAC. Kanonisasi mengikuti repo: **sort key tingkat atas**, urutan nested tetap, JSON compact UTF-8; jangan mengganti dengan sort rekursif di salah satu service saja.

Input bersama memakai `caseVersion`. Input persiapan privat memakai `privateContextVersion`; manifest juga mengikat caseVersion dan scope bukti bersama. `privateContextVersion=1` pada context shared berarti tidak dipakai untuk purpose bersama, sehingga pesan privat pihak lain tidak mengubah hash input shared. `accessRevision` mengikat izin saat commit. Hash juga meliputi source/version/hash/owner/audience, pesan, snapshot transaksi, prompt, dan aktor.

Backend memegang lock baris kasus lalu run. Ia memeriksa ulang snapshot saat commit, menolak manifest tidak lengkap/expired, refs di luar scope, hasil berbeda untuk checkpoint yang sudah selesai, serta shared publish ketika control PAUSED/MANUAL. Callback identik bersifat idempoten. Worker tidak menulis hasil dan control untuk kedua kalinya.

Review menggunakan `ApprovalRequest(scope=ALLOW_VOLUNTARY_MEDIATION)`, caseVersion, manifestHash, decisionId, reviewer dan expiry. Hanya reviewer yang ditugaskan dan punya permission intervensi bisa melanjutkan. Resume tidak memperbarui bukti atau menetapkan tanggung jawab.

## Bentuk hasil untuk UI

Field inti mengikuti SharedAssessmentDTO: runId, inputVersion, status, audience, modelMode, businessDataMode, category, verifiedFacts, claims, findings, missingEvidence, uncertainty, policyReferences, nextStep, requiresHumanApproval, manifestHash, model/prompt/policy version, counters.

Tambahan: `message` untuk chat, `caseVersion`, `functionsExecuted`, `groundingRejectedFindings`, dan `reviewedDecisionId` setelah resume. `verifiedFacts` hanya menceritakan record backend; bukan bukti autentisitas atau verifikasi baru dari PayPal. Klaim pihak tidak dinaikkan menjadi fakta. Findings model harus memakai locator, versi dan kutipan yang cocok; angka tambahan ditolak. Pemeriksaan kutipan/angka bukan jaminan ketepatan semantik model, sehingga evaluasi live tetap wajib.

`policyReferences` merujuk kebijakan workflow internal VelaPal, **bukan kutipan aturan PayPal**. AI tidak menentukan eligibility, tenggat sengketa, perlindungan seller, fraud atau hasil putusan.

## Binding UI

- Source metadata: `shareParamsHash` untuk consent berbagi sumber milik actor yang sudah siap. Target default CASE_SHARED; hash audience PROVIDER_SHARED berbeda.
- Case detail: `mediationBindings={assessmentRunId,inputVersion,sourceDigest,mediationParamsHash}` hanya untuk hasil current dan scope yang masih berlaku.
- Consent memerlukan assessmentRunId dan mediationParamsHash yang cocok. Proposal memerlukan sourceDigest current; nominal integer minor units, mata uang transaksi dan saldo refund backend tetap divalidasi.
- AI tidak membuat binding, menyetujui proposal, atau memanggil endpoint finansial. Partisipan menggunakan UI/Express untuk tindakan tersebut.

## Batas operasi MVP

Jalankan satu proses AI dengan satu worker. Semaphore dan lock lokal, durabilitas graph SQLite, outbox backend PostgreSQL. Untuk beberapa replika diperlukan koordinasi/distributed locking dan store checkpoint yang sesuai; konfigurasi ini belum menyediakan itu.

Maksimum bukti 5 MiB, PDF 5 halaman / 10.000 karakter per halaman, gambar 20 juta pixel, 16 chunk per file, retrieval 12 chunk, 110 detik per request AI, paling banyak 2 panggilan generatif per shared run dan 1 untuk purpose lainnya. Indeks live dapat membuat satu vision request + paling banyak 16 embedding request. Batas berlaku per usaha; job yang diulang bisa menambah biaya provider.

Retensi maksimal default 14 hari, query mengecualikan record expired; purge periodik membersihkan collection mode aktif dan registry. Revoke membersihkan source pada collection fixture/live bernama VelaPal dan checkpoint terkait kasus. SQLite lokal tetap harus disimpan sebagai data privat; logical deletion bukan jaminan penghapusan forensik dari disk/backup. Tidak ada backup data sensitif yang disertakan.

`CLEAN` pada MVP berarti validasi konten/format selesai untuk alur development, **bukan pemindaian antivirus**. Untuk publik/produksi, Yunggi perlu menambahkan scanner dan memperkuat autentikasi demo sebelum membuka upload untuk pengguna tak tepercaya.


Rebase ZIP `95cfe69` tidak mengubah kontrak runtime 6.1.2. Hanya basis pemasangan, dokumentasi dan metadata test yang disesuaikan; kode layanan AI/backend/frontend dari paket integrasi sebelumnya tetap sama. Machine-readable request schema tersedia di `ai.openapi.json`.
