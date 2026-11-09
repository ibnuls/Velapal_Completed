# Mulai dari sini — bagian Ibnu

Basis: ZIP VelaPal-main yang cocok dengan commit `95cfe69c0ab9ceb5a70d33cd524d95f0e9d3bfae` (ZIP terbaru yang diberikan 8 November 2026). Revisi adapter: **6.1.2**; ini bukan proposal produk baru.

Kode backend dan frontend sudah ada, tetapi sebelumnya `apps/ai` belum ada. Jadi bagian Ibnu sekarang dibuat **di dalam monorepo mereka**, bukan menjalankan ZIP AI lama berdampingan. Jangan menjalankan dua AI service di port 8000.

## 1. Pasang paket ke repo

Ekstrak paket Ibnu di folder terpisah. Dari folder paket:

```powershell
python install.py --repo "C:\lokasi\VelaPal-main" --check
python install.py --repo "C:\lokasi\VelaPal-main" --apply
```

Gunakan folder hasil ekstraksi ZIP terbaru yang bersih; jangan mengekstraknya menimpa folder versi lama karena berkas yang dihapus dari ZIP bisa tetap tertinggal. Installer memeriksa README terbaru dan ketiadaan 23 arsip lama, memeriksa hash file basis sebelum mengubah apa pun, menolak edit yang tidak dikenali, dan menyimpan backup file yang diganti. Hasil paket AI sebelumnya hanya diterima bila hash-nya tepat cocok dengan keluaran yang pernah diberikan; edit pengguna tetap ditolak. Ia tidak mengubah `.env` atau `.env.local`. `patches/integration-95cfe69.patch` tersedia untuk review Yunggi/Deff. Jika repo sudah lebih baru atau berisi edit lokal, hentikan pemasangan otomatis dan merge patch di branch terpisah.

## 2. Buat environment Python (Windows)

Di folder **repo**, gunakan `python`, karena launcher `py` sebelumnya tidak tersedia di komputer Ibnu.

```powershell
cd apps\ai
python --version
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.in
.\.venv\Scripts\python.exe scripts\setup_env.py
```

Python minimum 3.11. Versi 3.11.17 dan 3.12.14 diuji pada Linux; Python 3.11.9 berada dalam rentang yang didukung, tetapi Windows 3.11.9 tidak diuji langsung di sini. Memanggil executable venv secara langsung tidak membutuhkan aktivasi PowerShell.

`requirements.txt` berisi versi yang dipatok untuk instalasi. `requirements.in` adalah daftar dependensi sumber; **tidak perlu menginstal keduanya**. `requirements-dev.in` menambahkan pytest untuk pengujian.

Script setup membuat contoh `.env` AI, `.env` backend, dan `.env.local` frontend hanya jika belum ada. Jika file sudah ada, edit nilainya sendiri dan pastikan:

- Backend dan AI memakai `WORKER_TO_AI_SECRET`, `AI_TO_EXPRESS_SECRET`, `MANIFEST_HMAC_SECRET` yang sama, sesuai arah pemakaiannya.
- Backend `AI_SERVICE_URL=http://localhost:8000` dan `API_INTERNAL_BASE_URL=http://localhost:4000`.
- AI `API_INTERNAL_BASE_URL=http://localhost:4000`, `QDRANT_URL=http://localhost:6333`, `AI_MODEL_MODE=fixture` untuk tes pertama.
- Frontend `NEXT_PUBLIC_API_MODE=api`, `NEXT_PUBLIC_API_BASE_URL=/api/v1`, `API_UPSTREAM=http://localhost:4000`.
- API `AI_BUSINESS_DATA_MODE=synthetic_fixture` untuk data seed/demo.

`api` pada frontend berarti memakai backend sungguhan. Itu **berbeda** dari model AI `live`/`fixture`.

## 3. Hidupkan infrastruktur dan backend

Terminal baru, kembali ke **root repo**:

```powershell
docker compose up -d
cd apps\api
npm ci
npm run prisma:push
npm run seed
npm run storage:init
npm run build
npm start
```

Docker Desktop harus aktif. Compose bawaan menyediakan PostgreSQL, Qdrant dan MinIO. Tidak perlu mengunduh Qdrant secara terpisah jika memakai Compose. `storage:init` membuat bucket privat sesuai `S3_BUCKET`; jangan mengubah bucket menjadi publik.

`prisma:push` adalah langkah development; cek `DATABASE_URL` terlebih dahulu dan gunakan database development, bukan database produksi. `seed` menyediakan akun demo; data seed bukan bukti transaksi PayPal Sandbox.

## 4. Hidupkan AI dan frontend

Terminal AI, di `apps\ai`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn velapal_ai.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Terminal frontend, di `apps\web`:

```powershell
npm ci
npm run dev
```

Di terminal AI tambahan:

```powershell
.\.venv\Scripts\python.exe scripts\check_stack.py
```

Buka `http://localhost:3000/login`. Isi email demo secara manual dan password `correct-horse-battery-staple`. Tombol pengisi akun demo pada patch ini mengikuti mode API atau mock; untuk backend asli, password seed-nya sesuai nilai di atas.

Akun: `customer@velapal.demo`, `seller@velapal.demo`, `admin@velapal.demo`. MFA development memakai `123456` (termasuk step-up admin). Ini mekanisme demo dari repo, bukan autentikasi produksi.

## 5. Urutan demo untuk Ibnu

1. Customer: ajukan pertanyaan katalog di Vela Assistant; hasil awal harus berlabel **Simulated AI / fixture**.
2. Buka kasus. Gunakan **text PDF** untuk demo offline; unggah invoice customer dan packing label seller. Tunggu `CLEAN`, lalu beri persetujuan berbagi ke kasus. Bukti privat tidak otomatis dibagikan.
3. Jalankan private preparation sebagai masing-masing pihak. Bukti privat pihak lawan tidak boleh muncul.
4. Jalankan shared assessment. Hanya sumber yang telah dibagikan masuk pemeriksaan bersama.
5. Jika konflik material terdeteksi, admin mengambil assignment, menerima deklarasi konflik kepentingan, lalu melakukan step-up dan `ALLOW_VOLUNTARY_MEDIATION`.
6. AI melanjutkan graph tersimpan. Review admin tidak mengubah konflik menjadi fakta atau menentukan hak refund.
7. Customer/seller dapat menulis proposal sukarela menggunakan binding dari backend. Persetujuan mediasi, persetujuan proposal, dan otorisasi uang tetap terpisah.
8. Cabut satu bukti bersama: hasil dengan ACL lama disembunyikan, indeks dibersihkan dan proposal yang belum dieksekusi dibatalkan.

AI fixture **tidak melakukan OCR gambar**. PNG/JPEG akan menghasilkan permintaan informasi tambahan tanpa mengarang teks gambar. PDF scan tanpa lapisan teks juga memerlukan bukti lebih jelas. Untuk menguji vision sungguhan, lanjutkan langkah 6.

## 6. Aktifkan Gemini setelah fixture beres

Isi `GEMINI_API_KEY` secara lokal di `apps/ai/.env`. Jangan kirim kuncinya ke chat atau commit GitHub.

```powershell
.\.venv\Scripts\python.exe scripts\provider_smoke.py --list-models
```

Pilih nama model yang tersedia untuk `generateContent`, lalu isi `GEMINI_MODEL`. Model harus mendukung gambar dan JSON schema. Jalankan:

```powershell
.\.venv\Scripts\python.exe scripts\provider_smoke.py --allow-live
```

Probe mengirim request berbayar/berkuota ke akun Gemini: JSON terstruktur, kutipan, embedding 768 dimensi, dan vision. Jika lolos, ubah `AI_MODEL_MODE=live` dan restart AI. Tidak ada fallback diam-diam ke fixture jika model/key gagal.

Embedding default `gemini-embedding-001`. Jika memilih model embedding lain, pastikan model itu tersedia, mendukung 768 dimensi, dan ubah **keduanya**: AI `GEMINI_EMBEDDING_MODEL=<model>`, backend `AI_EMBEDDING_SPACE=<model>-dim768`. Collection Qdrant dibedakan menurut model/mode agar embedding tidak bercampur.

## Yang masih perlu dibuktikan oleh tim

Gemini live, alur browser nyata pada laptop, serta alur lengkap PayPal Sandbox create/capture/refund + penanganan status tidak pasti. Tes integrasi yang disertakan **tidak memanggil PayPal**. Backend masih mempunyai fallback PayPal simulasi ketika kredensial kosong. Mode `paypal_sandbox` pada hasil AI baru digunakan secara konservatif bila konfigurasi Sandbox dan catatan capture terverifikasi backend tersedia; itu tetap bukan verifikasi provider independen oleh AI.

Baca `TUGAS_TIM.md`, `KONTRAK_INTEGRASI.md`, dan `TESTING.md` sebelum merge. Dockerfile AI dan `docker-compose.ai.yml` adalah opsi tambahan; jalur Python host di atas adalah jalur setup utama. Redis tidak dibutuhkan: antrean memakai Outbox PostgreSQL milik backend, checkpoint graph memakai SQLite lokal.


## Catatan penyesuaian ZIP terbaru

Perubahan dari basis sebelumnya hanya README frontend dan penghapusan arsip dokumentasi. Source aplikasi/kontrak/database identik; lima fungsi AI dan pembagian tugas tetap berlaku. Baca `REVISION_95cfe69.md` untuk perbandingan dan pemisahan tes baru dari hasil integrasi sebelumnya.
