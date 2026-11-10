# Panduan Menjalankan Sistem VelaPal (End-to-End)

Dokumen ini memandu langkah menjalankan seluruh ekosistem VelaPal lintas layanan (Docker, Backend Express, Service AI FastAPI, dan Frontend Next.js).

---

## 1. Prasyarat Lingkungan
- Docker Desktop aktif
- Node.js v18+ & npm
- Python 3.11+
- API Key Gemini (dari Google AI Studio)

---

## 2. Persiapan Environment (.env)
Sebelum menjalankan layanan, siapkan file `.env` di tiap subfolder:
1. `apps/ai/.env` (Salin dari `.env.example` dan isi `GEMINI_API_KEY`).
2. `apps/api/.env` (Salin dari `.env.example`).
3. `apps/web/.env.local` (Salin dari `.env.integration.example`).

---

## 3. Eksekusi 4 Terminal

### Terminal 1: Database & Vector DB (Docker)
Jalankan kontainer PostgreSQL dan Qdrant dari root folder:
\`\`\`powershell
docker compose -f docker-compose.yml -f docker-compose.ai.yml up -d postgres qdrant
\`\`\`
*(Catatan: MinIO dilewati karena non-blocking untuk demo mediasi utama).*

---

### Terminal 2: AI Service FastAPI (Port 8000)
Masuk ke direktori AI, aktifkan venv, dan nyalakan FastAPI:
\`\`\`powershell
cd apps/ai
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn velapal_ai.main:app --reload --port 8000
\`\`\`

---

### Terminal 3: Backend Express API (Port 4000)
Masuk ke direktori backend API, siapkan migrasi database, dan jalankan server:
\`\`\`powershell
cd apps/api
npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
npm run dev
\`\`\`

---

### Terminal 4: Frontend Next.js (Port 3000)
Masuk ke direktori web dan jalankan antarmuka:
\`\`\`powershell
cd apps/web
npm install
npm run dev
\`\`\`

---

## 4. Akun Demo Bawaan
Password untuk seluruh akun demo: `correct-horse-battery-staple`
- **Customer:** `customer@velapal.demo`
- **Seller:** `seller@velapal.demo`
- **Admin / Supervisor:** `admin@velapal.demo`

---

## 5. Skenario Uji Demo (Kasus case_vp_0421)
1. Buka peramban di `http://localhost:3000`.
2. Login sebagai **Admin** (`admin@velapal.demo`) -> buka `/workspace/admin/case_vp_0421` -> klik **Assign myself** dan setujui tindakan mediasi (*Intervention Action*).
3. Buka tab Customer (`customer@velapal.demo`) -> buka `/workspace/cases/case_vp_0421` -> tab **Mediation & consent** -> klik **Give Consent**.
4. Buka tab Seller (`seller@velapal.demo`) -> buka `/workspace/cases/case_vp_0421` -> tab **Mediation & consent** -> klik **Approve Refund**.
5. Kasus otomatis berubah menjadi **RESOLVED** dengan partial refund USD 20.00.