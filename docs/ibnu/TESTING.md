# Bukti uji paket awal — 8 November 2026

**Riwayat:** 30 tes stack di dokumen ini dijalankan pada basis `80e8ab2` saat paket awal dibuat. Ini bukan klaim bahwa stack itu dijalankan ulang pada `95cfe69`. Source runtime tidak berubah setelah rebase. Hasil pemeriksaan baru, termasuk tes AI/frontend, build, pemasangan dan penjagaan file yang dihapus, dicatat terpisah dalam `REVISION_95cfe69.md` dan `revision-validation.json`.

## Bukti yang sudah lulus

| Pemeriksaan | Hasil | Yang dibuktikan |
|---|---|---|
| Pytest AI, Python 3.12.14 | 24 passed | Kutipan/angka, HMAC/tampering/expiry, URL scope, envelope, filter ulang retrieval, kelima fungsi, checkpoint/resume/purge |
| Pytest AI, Python 3.11.17, venv bersih | 24 passed | Dependency terkunci dapat diinstal dan perilaku inti sama pada Python 3.11 |
| Integrasi stack disposable | 30 passed | Express/Prisma aktual → outbox → FastAPI → checkpoint, objek PDF asli, Qdrant, privasi, admin resume setelah restart, consent binding/proposal dan revoke |
| API TypeScript | Build passed | Kode backend yang digunakan tes dikompilasi, bukan endpoint mock pengganti |
| Frontend | 30 tests passed; typecheck/build/lint | Tes bawaan repo + tipe metadata binding; build mode API |

Rincian integrasi tersedia pada `integration-results.json`. Lingkungan integrasi: Qdrant binary resmi **1.11.0**, PGlite dengan protokol PostgreSQL, Moto sebagai simulator S3, Express/Prisma asli, model AI fixture, dan SQLite untuk LangGraph. Ini tidak sama dengan pengujian container PostgreSQL 16 dan server MinIO asli. Test database dibuat disposable oleh script; tidak memakai database pengguna.

30 pemeriksaan mencakup: autentikasi dua arah, personal assistant, provenance fixture, retry saat AI mati dan recovery, role salah ditolak, PDF ingestion, customer/seller private canary terisolasi, reindex setelah share, shared evidence/mediation, review gate, tidak ada private canary di output bersama, manifest wajib, callback duplikat idempoten, controlVersion tidak berganda, resume setelah restart, ketidakpastian tetap ada setelah review, binding authoritative, hash palsu ditolak, draft proposal manusia, tidak ada financial operation otomatis, redaksi setelah revoke, purge Qdrant dan invalidasi proposal, serta penolakan checkpoint stale.

## Belum dibuktikan

- **Gemini live:** tidak ada kredensial di sesi ini. `provider_smoke.py --allow-live` tersedia dan sengaja harus dijalankan dengan akun tim. Vision pada fixture tidak disimulasikan sebagai OCR berhasil.
- **PayPal:** tidak dipanggil oleh tes ini. README repo menyebut tes Sandbox sebelumnya; klaim itu tidak dianggap sebagai hasil tes baru paket ini. Tim perlu membuktikan alur transaksi kasus ini sendiri.
- **Browser:** Playwright dicoba. Browser bawaan unduhan gagal, lalu Chrome for Testing resmi dapat diunduh tetapi prosesnya berhenti pada `process_singleton_posix.cc: socket() failed: Operation not permitted`. Tidak ada klaim klik alur UI lulus. Ini batas lingkungan browser, bukan hasil penolakan API aplikasi.
- **Native infra / Windows / Docker:** instruksi disediakan; pengujian saat ini berlangsung di Linux dengan infrastruktur disposable di atas. Docker tidak tersedia di lingkungan pembuatan paket.
- **Kualitas semantik live:** kecocokan quote dan angka mengurangi beberapa kesalahan, tetapi tidak membuktikan inferensi model benar. Gunakan bukti demo dan pemeriksaan manusia sebelum presentasi.

## Cara menjalankan tes AI

Dari `apps/ai`, setelah memasang requirements:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts\check_stack.py
```

Dari `apps/api`: `npm run build`. Dari `apps/web`: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`. Build frontend memakai environment API jika demo akan terhubung Express.

## Reproduksi integrasi disposable (opsional, development Linux)

Pasang `scripts/ibnu/requirements-e2e.txt` ke venv test. Pasang paket Node `@electric-sql/pglite-socket` dan `@electric-sql/pglite` di folder terpisah; versi yang dipakai saat validasi adalah 0.2.18 / 0.5.15. Sediakan Qdrant binary resmi 1.11.0. Jangan memasukkan dependensi test ini ke runtime produksi.

Dari root repo, sesuaikan tiga path:

```bash
/path/to/test-venv/bin/python scripts/ibnu/integration_test.py \
  --pglite-cli /path/to/pglite-socket/dist/scripts/server.js \
  --qdrant-binary /path/to/qdrant \
  --report /path/to/integration-results.json
```

Script memakai database PGlite baru, port localhost acak, bucket S3 simulator baru, dan data AI sementara. Ia memanggil Prisma push/seed hanya ke database disposable yang dibuatnya. Semua proses dihentikan setelah tes; log/data test sementara dapat dihapus setelah diperiksa. `--max-connections=10`, cache statement Prisma dimatikan, dan statement seed dibersihkan untuk menyesuaikan multiplexer PGlite; itu konfigurasi test, bukan anjuran untuk PostgreSQL normal.

Tambahkan `--browser` jika Playwright/Chromium tersedia. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` opsional menunjuk browser terpasang. Script membuka frontend mode API, login, dan memeriksa kontrol mediasi/proposal terikat backend tanpa mengeksekusi pembayaran. Script browser ini disertakan untuk tim; belum berhasil dieksekusi pada lingkungan pembuatan paket.

## Checklist penerimaan lokal tim

1. Jalankan Compose asli; buat bucket privat; periksa hash bukti cocok dari upload sampai indeks.
2. Jalankan fixture melalui UI customer/seller/admin; periksa PRIVATE, CASE_SHARED, NEEDS_INFO, WAITING_ADMIN, dan invalidasi bukti.
3. Jalankan probe Gemini, kemudian uji kasus yang sama dalam `live`; review kutipan, nominal, dan label model/data bisnis.
4. Hubungkan kasus ke transaksi Sandbox yang benar; uji consent dan provider outcome bersama Yunggi. Jangan menganggap status fallback sebagai respons PayPal.
5. Ulangi satu skenario AI offline, satu stale context, dan satu revoke melalui browser sebelum merekam demo.
