# Pembagian tugas sesuai repo saat ini

Owner mengikuti percakapan tim: Ibnu = AI Python, Yunggi = Express/Prisma/PayPal, Deff = Next.js. Role akun customer/seller/admin di aplikasi tidak sama dengan pembagian kerja developer.

| Area | Owner | Yang sudah dibuat dalam paket | Tugas berikutnya / bukti selesai |
|---|---|---|---|
| AI service | Ibnu | `apps/ai`, FastAPI, lima fungsi logis, Gemini adapter, batas request/call | Jalankan setup lokal, tes fixture, isi key Gemini lokal dan lampirkan hasil probe live tanpa secret |
| Bukti & retrieval | Ibnu | Baca PDF/gambar, hash/MIME/ukuran, Qdrant filter tenant/case/version/audience/owner, purge | Uji invoice/label demo yang benar, kemudian vision Gemini; cek kutipan/angka satu per satu |
| Workflow AI | Ibnu | Satu LangGraph dengan SQLite, interrupt/resume, grounded findings, NEEDS_INFO/ABSTAINED | Uji restart AI saat menunggu admin; jangan mengubah keputusan admin menjadi bukti autentisitas |
| Integrasi Express | Yunggi; patch disiapkan Ibnu | Directional auth, signed context, checkpoint CAS/idempotensi, retry outbox, resume job | Review file dalam patch, jalankan PostgreSQL/MinIO asli, cek failure/retry dan version conflict |
| PayPal & settlement | Yunggi | Alur keuangan repo dipertahankan; AI tidak diberi executor | Pastikan kredensial Sandbox aktif, buktikan create/capture/refund dan reconcile; bedakan fallback mock; uji webhook bila diklaim |
| Integrasi UI | Deff; patch kecil disiapkan Ibnu | Konsumsi `mediationBindings` dan `shareParamsHash` dari backend | Pakai mode `api`; uji login, unggah, berbagi, assessment, review admin, proposal di browser |
| Label hasil & demo | Ibnu + Deff | Model fixture/live dan business data terpisah, hasil stale disembunyikan | Pastikan narasi/video tidak menyebut fixture sebagai Gemini atau pembayaran sungguhan |
| Merge & penerimaan | Bertiga | Paket berbasis SHA tertentu + manifest/patch + laporan tes | Gunakan branch integrasi; review konflik jika HEAD sudah berubah; demo dari frontend sampai hasil provider yang diverifikasi |

## Urutan kerja yang disarankan

**Tahap 1 — Yunggi + Ibnu:** pasang overlay di branch integrasi, samakan environment dan jalankan fixture. Selesai ketika job AI tidak lagi berhenti di QUEUED/RUNNING, output tersimpan melalui checkpoint, dan bukti lawan yang privat tidak terlihat.

**Tahap 2 — Ibnu:** jalankan model discovery dan probe Gemini; evaluasi nomor, locator, kutipan, dan respons ketika bukti tidak terbaca. Simpan hasil probe/evaluasi tanpa key. Jangan memilih model hanya dari nama di tutorial lama.

**Tahap 3 — Deff + Ibnu:** uji UI mode API, terutama sharing consent, status review, refresh setelah admin resume, dan proposal binding. Script browser disertakan tetapi browser belum berhasil dijalankan pada lingkungan pembuatan paket karena larangan IPC OS.

**Tahap 4 — Yunggi + Ibnu:** hubungkan kasus dengan transaksi Sandbox nyata, lakukan penawaran/refund hanya melalui persetujuan manusia yang dipersyaratkan backend, lalu periksa provider outcome. Tidak cukup melihat status sukses dari fixture atau fallback adapter.

**Tahap 5 — Bertiga:** jalankan ulang skenario gagal, rapikan README/demo dan pastikan cara reviewer mengakses build sesuai aturan event yang berlaku.

## Batas kepemilikan

Ibnu tidak perlu membuat ulang halaman Deff atau seluruh backend Yunggi. Patch pada backend/frontend dalam paket ini diperlukan karena modul AI tidak dapat memperbaiki ACL, worker, atau tombol UI dari dalam Python saja. Yunggi dan Deff tetap mereview perubahan pada area mereka sebelum merge.

Tidak ada push, PR, deploy, atau pesan ke rekan tim yang dilakukan oleh paket ini. Semua perubahan masih berupa file yang dapat ditinjau.


## ZIP terbaru `95cfe69`

Tidak ada perubahan kode aplikasi dari basis sebelumnya; revisi teman hanya dokumentasi. Karena itu owner dan urutan tugas di atas tetap berlaku. Yunggi/Deff tetap mereview patch integrasi yang diperlukan AI. Paket ini tidak memulihkan PDF/arsip yang dihapus teman. Rincian verifikasi terbaru ada di `REVISION_95cfe69.md`.
