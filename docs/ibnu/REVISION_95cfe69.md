# Penyesuaian ZIP terbaru — `95cfe69`

Diperiksa ulang pada 8 November 2026 (Asia/Jakarta).

## Temuan utama

ZIP baru `VelaPal-main (1).zip` memiliki metadata commit `95cfe69c0ab9ceb5a70d33cd524d95f0e9d3bfae` dan SHA256 arsip `3d866687abf55c1ddb2214e5ef518e9084ad5b71afe2c1836786fc7ae39508f9`.

Perbandingan byte-per-byte dengan ZIP sebelumnya (`80e8ab2`) menghasilkan:

| Area | Perubahan |
|---|---|
| `apps/web/README.md` | Bagian audit/coverage lama dan tautan audit yang dihapus dirapikan |
| 23 berkas di `apps/web/docs` | PDF PRD/arsitektur, arsip kontrak dan hasil ekstraksi dokumentasi lama dihapus |
| Kode frontend/backend, Prisma, kontrak bersama, lockfile | Identik; tidak ditemukan revisi source aplikasi |
| `apps/ai` di ZIP baru | Masih belum ada; tetap disediakan oleh paket Ibnu |

Artinya, revisi teman bukan perubahan API atau rancangan agen. Membuat ulang AI karena menganggap kontrak berubah justru tidak diperlukan. Kelima fungsi AI dan pembagian Ibnu/Yunggi/Deff dipertahankan.

## Penyesuaian yang dilakukan

1. Paket pemasangan dan patch memakai basis `95cfe69`; kontrak runtime tetap **6.1.2**.
2. README frontend terbaru dipertahankan persis; tidak termasuk file yang ditimpa payload.
3. Ke-23 berkas yang dihapus tidak disalin kembali. Dokumentasi Ibnu tetap berada di `docs/ibnu`.
4. Installer memeriksa README baru dan ketiadaan arsip yang dihapus. Menjalankan paket pada ekstraksi lama yang belum bersih ditolak sebelum menulis.
5. Upgrade dari keluaran paket sebelumnya diperbolehkan hanya untuk checksum yang diketahui; edit lokal lain tetap ditolak. File `.env`/`.env.local` tetap dipertahankan.
6. Petunjuk Windows, daftar tanggung jawab, sumber, dan metadata script test menunjuk basis baru. Riwayat pengujian lama tidak diberi label sebagai pengujian baru.

## Pengujian pada revisi ini

| Pemeriksaan baru | Hasil |
|---|---|
| Perbandingan seluruh file ZIP lama vs baru | 1 README berubah, 23 dokumen dihapus, source aplikasi lainnya identik |
| Tes AI pada Python 3.12.14, dependency dipasang ulang sesuai lock | **24 passed** |
| Prisma generate + TypeScript backend | **Passed** |
| Tes frontend | **30 passed** |
| Typecheck, lint, build frontend mode API | **Passed** |
| Pemasangan ke salinan ZIP baru, ulang pemasangan, penjagaan edit/.env/README/deletions | Lihat `revision-validation.json` dan `PACKAGING_CHECKS.json` pada paket |

Pemeriksaan instalasi menguji hasil penulisan file secara nyata pada salinan disposable, bukan hanya membaca kode installer. Patch Git juga dicek dan diterapkan pada salinan basis baru.

## Batas bukti

30 pemeriksaan stack dengan Express/Prisma aktual + FastAPI + Qdrant + PGlite + Moto S3 berasal dari paket awal pada `80e8ab2`; laporan aslinya tetap tersedia pada `integration-results.json`. Stack penuh itu tidak dijalankan ulang pada penyesuaian dokumentasi ini, karena kode runtime identik. Tes unit/build dan kompatibilitas pemasangan dijalankan ulang seperti tabel di atas.

Gemini live, PayPal Sandbox end-to-end dan browser dengan akun/infrastruktur tim tetap belum dibuktikan oleh penyesuaian ini. Python 3.11 dan percobaan browser yang tercatat di `TESTING.md` juga merupakan hasil paket awal. Jangan menyebut fixture sebagai request Gemini atau transaksi PayPal sungguhan.

## Langkah untuk Ibnu

Gunakan folder ekstraksi baru dari ZIP repo terbaru, pasang paket Ibnu terbaru, lalu ikuti `START_HERE.md`. Tugas berikutnya tetap: fixture lewat UI, probe Gemini memakai key lokal, review kutipan/nominal/vision, kemudian alur Sandbox bersama Yunggi dan verifikasi UI bersama Deff.

Tidak ada source remote yang dipush, dokumen teman yang dihapus secara otomatis, atau transaksi provider yang dijalankan dalam penyesuaian ini.
