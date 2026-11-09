# Dasar kode dan sumber teknis

Diperiksa 8 November 2026. Source of truth untuk kontrak aplikasi adalah kode repo pada SHA basis, bukan dugaan dari proposal lama.

| Sumber | Penggunaan |
|---|---|
| https://github.com/VelaPal/VelaPal/tree/95cfe69c0ab9ceb5a70d33cd524d95f0e9d3bfae | Basis ZIP dibandingkan byte-per-byte; route, enum, Prisma dan UI aktual |
| `apps/api/src/routes/internal.routes.ts`, `integrations/outbox.worker.ts`, `prisma/schema.prisma` pada basis | Bentuk request, checkpoint, indeks, state machine backend |
| `apps/web/features/disputes`, `services/contracts`, `packages/contracts/index.ts` pada basis | DTO dan binding yang benar-benar dikonsumsi frontend |
| https://ai.google.dev/api/generate-content | REST Gemini, image inlineData dan responseFormat JSON schema; dibaca sebagai Markdown resmi |
| https://ai.google.dev/api/embeddings | embedContent, embedContentConfig/taskType/outputDimensionality; dibaca sebagai Markdown resmi |
| https://docs.langchain.com/oss/python/langgraph/interrupts | Interrupt, thread_id, checkpoint dan Command resume |
| https://qdrant.tech/documentation/search/filtering/ | Filter payload; implementasi juga diuji terhadap Qdrant 1.11.0 yang dipakai Compose repo |
| https://github.com/qdrant/qdrant/releases/tag/v1.11.0 | Binary test resmi; arsip Linux x86_64 SHA256 `c62fd779e97e089a4920f82c176799176b2038e0570418123914df2716d194a2` |
| https://pglite.dev/docs/pglite-socket | Stack PostgreSQL-wire disposable; bukan pengganti production database dalam repo |
| https://developer.paypal.com/sandbox-testing/overview | Pembedaan lingkungan Sandbox dari fixture lokal; tidak dianggap bukti transaksi tim telah dilakukan |

Sumber eksternal mendasari pemakaian API/library. Klaim lulus/gagal pada laporan berasal dari eksekusi kode paket ini. Tidak ada sumber yang membuat inferensi model menjadi putusan resmi PayPal atau menjamin kelulusan hackathon.
