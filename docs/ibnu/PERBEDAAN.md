# Penyesuaian ZIP terbaru `95cfe69`

Dibandingkan ZIP basis `80e8ab2`, hanya `apps/web/README.md` yang diubah dan 23 berkas di `apps/web/docs` yang dihapus. Seluruh file aplikasi yang sama-sama ada masih identik, termasuk backend, frontend, Prisma, kontrak dan lockfile.

Paket sekarang memeriksa basis baru, mempertahankan README Deff, tidak menyalin kembali 23 berkas lama, dan menyesuaikan petunjuk pemasangan/metadata test. Tidak ada perubahan fungsional pada lima fungsi AI atau pembagian tugas. Kontrak runtime tetap 6.1.2.

Perbandingan di bawah menjelaskan implementasi AI yang tetap dipertahankan dari paket sebelumnya.

# Perbedaan dari ZIP AI lama dan repo basis

| Bagian | Sebelumnya | Paket integrasi ini |
|---|---|---|
| Letak AI | ZIP `velapal-ibnu-ai` terpisah; repo belum punya `apps/ai` | `apps/ai` di monorepo yang diberikan |
| Purpose pribadi | Adapter lama memakai `PERSONAL` | `PERSONAL_ASSISTANT`, persis enum repo |
| Fungsi agen | Lima peran di rancangan lama | Tetap personal, customer preparation, seller preparation, evidence, mediation; dipanggil sesuai purpose, bukan semua peran untuk tiap request |
| Endpoint backend | Adapter lama mengasumsikan tools/routes yang berbeda | Context/checkpoint aktual `/internal/v1/case-runs/:id/...` plus konteks job index/revoke |
| Status review | Kontrak lama memakai `WAITING_REVIEW` | `NEEDS_INFO` + `requiresHumanApproval`, control backend `WAITING_ADMIN`; selaras enum UI/Prisma |
| Hasil checkpoint | Bentuk adapter lama berbeda | Mengurai envelope `{data:{committed:true},meta:...}` dari Express |
| Bukti privat | Endpoint internal repo dapat memasukkan PRIVATE pihak lawan | Filter private memakai owner actor; shared assessment hanya sumber bersama yang diizinkan |
| Outbox | Error AI bisa diabaikan tetapi job tetap COMPLETED | HTTP error ditangani, timeout/lease dibatasi, retry/backoff dan FAILED; hanya callback yang menulis hasil |
| Review admin | Mengubah control, tetapi belum membuat resume job | Keputusan tersimpan dan terikat manifest, outbox resume memulihkan graph tersimpan |
| Source share | Version berubah tetapi belum ada reindex | Share mengantrekan indeks versi baru; revoke menghapus versi terkait dan checkpoint kasus |
| Binding UI | Aksi terkait hanya memakai binding mock; mode API tidak mendapat binding | Backend menerbitkan hash sharing/mediasi/manifest, frontend memakai data itu |
| Data contoh | Berisiko tercampur dengan label provider | `fixture/live` berbeda dari `synthetic_fixture/paypal_sandbox`; tidak ada fake OCR dan fallback Gemini |
| Infrastruktur AI | Paket lama punya beberapa adapter/store | Qdrant + SQLite graph; antrean domain tetap Outbox PostgreSQL. Tidak ada Redis baru yang wajib |
| Verifikasi | Tes lama menguji kontrak berbeda | Tes baru menguji kontrak saat ini, Express/Prisma aktual, Qdrant 1.11 dan S3 simulator |

Perubahan ini menyambungkan rancangan dengan implementasi tim, bukan memangkas agen dispute. AI tetap tidak menetapkan putusan PayPal atau mengotorisasi pemindahan uang. Hasil inferensi dan saran dipisahkan dari tindakan finansial yang diotorisasi backend.
