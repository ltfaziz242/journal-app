# Jurnal Trading XAUUSD (web app, mobile-first)

Jurnal trading manual untuk XAUUSD. Semua data tersimpan **hanya di HP/laptop kamu**
(localStorage). Tidak ada server, tidak ada akun, tidak ada koneksi ke luar.

Status jujur: ini **alat pencatat + penjaga aturan risiko**, bukan pemberi sinyal dan
bukan auto-trade. Strategi EA masih terpisah di folder `ea/`. Tidak ada jaminan profit.

---

## 1. Isi folder

| File | Fungsi |
|---|---|
| `index.html` | Halaman aplikasi (meta CSP ketat, tanpa inline JS) |
| `style.css` | Tema gelap, mobile-first, tombol besar |
| `calc.js` | Semua hitungan (SL, RR, risiko, R, PF, expectancy, DD, aturan stop) |
| `app.js` | UI, penyimpanan, export/import, data contoh |
| `tests.js` + `tests.html` | Unit test hitungan (tanpa dependency) |
| `manifest.webmanifest` | Supaya bisa di-install sebagai PWA |
| `sw.js` | Cache offline (butuh HTTPS atau localhost) |
| `icons/` | Ikon SVG |

Tidak ada build step, tidak ada npm, tidak ada framework. Tinggal buka `index.html`.

---

## 2. Cara pakai di HP

### Cara A — lewat WiFi dari laptop (paling cepat, sebagai halaman web)

Cocok untuk mencoba. Tidak bisa di-install jadi PWA (lihat catatan di bawah).

1. Di laptop, buka terminal di folder `journal-app`.
2. Jalankan server statis:

   ```
   python -m http.server 8000 --bind 0.0.0.0
   ```

   (Kalau `python` tidak dikenali, coba `py -m http.server 8000 --bind 0.0.0.0`.)
3. Cari alamat IP laptop di jaringan WiFi:

   ```
   ipconfig
   ```

   Lihat baris **IPv4 Address** pada adapter WiFi, misalnya `192.168.1.7`.
4. Di HP, pastikan tersambung ke **WiFi yang sama**, lalu buka:

   ```
   http://192.168.1.7:8000/
   ```
5. Laptop harus tetap menyala dan server tetap jalan selama dipakai.

Catatan penting: alamat `http://` biasa **bukan** "secure context", jadi di HP
**service worker tidak aktif** — aplikasi tetap jalan sebagai halaman web, tapi
tanpa cache offline dan tanpa install PWA. Kalau mau install PWA, pakai Cara B.

### Cara B — hosting statis HTTPS (bisa di-install sebagai PWA)

Cocok untuk pemakaian sehari-hari. Yang dipublish **hanya kode**; data trading
tetap di HP masing-masing dan tidak pernah terkirim ke mana pun.

GitHub Pages:

1. Buat repository baru (boleh publik). **Jangan** taruh nomor akun, password,
   atau file backup jurnal di repo.
2. Upload **isi** folder `journal-app/` ke root repo (atau ke folder `docs/`).
   Pastikan `index.html` ada di root (atau di `docs/`).
3. Repo → **Settings** → **Pages** → Source: **Deploy from a branch** →
   Branch `main`, folder `/ (root)` atau `/docs` → **Save**.
4. Tunggu 1–2 menit, buka `https://<username>.github.io/<repo>/`.
5. Karena HTTPS, service worker aktif → aplikasi bisa dipakai offline setelah
   dibuka sekali, dan bisa di-Add to Home Screen.

Hosting statis lain (Netlify Drop, Cloudflare Pages, Vercel, dsb.) juga jalan —
syaratnya sama: HTTPS dan file statis apa adanya.

Catatan: siapa pun yang punya URL-nya bisa membuka **tampilan** aplikasi (kode itu
tidak rahasia), tapi **data jurnalmu tidak ada di server** — hanya di localStorage
perangkatmu.

### Syarat service worker (offline / install PWA)

Service worker hanya aktif di:

- `https://…` (Cara B), atau
- `http://localhost` / `http://127.0.0.1` (di laptop itu sendiri).

Service worker **tidak** aktif kalau:

- dibuka lewat `file://` (klik dua kali `index.html`), atau
- dibuka lewat `http://192.168.x.x` dari HP (Cara A).

Aplikasi tetap berfungsi tanpa service worker; yang hilang hanya cache offline
dan kemampuan install.

---

## 3. Add to Home Screen

### Android (Chrome / Edge)

1. Buka aplikasinya lewat HTTPS (Cara B), tunggu termuat penuh sekali.
2. Menu **⋮** kanan atas → **Add to Home screen** atau **Install app**.
3. Beri nama → **Add**. Ikon muncul di launcher, terbuka tanpa address bar.

### iPhone (Safari — wajib Safari, bukan Chrome)

1. Buka lewat HTTPS di **Safari**.
2. Tombol **Share** (kotak dengan panah ke atas) → scroll → **Add to Home Screen**.
3. **Add**. Ikon muncul di home screen.

Di iPhone, kalau dibuka dari Chrome/Firefox, opsi Add to Home Screen tidak tersedia.

---

## 4. Data, backup, dan pindah HP

- Data disimpan di **localStorage** perangkat, per browser, per alamat (origin).
  Beda browser = beda data. Ganti alamat (IP/host) = data lama tidak terlihat.
- Menghapus data browser / "Clear site data" / mode privat = **data hilang**.
- Karena itu: **Backup** tab → **Export JSON** tiap 7 hari (app mengingatkan sendiri).
  Simpan file JSON di tempat aman (bukan di folder repo yang dipublish).
- Pindah HP: Export JSON di HP lama → kirim file ke HP baru → tab **Backup** →
  **Import JSON** (import **mengganti** semua data di perangkat itu).
- **Export CSV** untuk dibuka di spreadsheet. Kolomnya:
  `tanggal, pair, arah, entry, SL, TP, alasan, hasil_cent, hasil_R, taat_aturan, tag, tipe_akun`
  — sama dengan format `journal/YYYY-MM.csv` di `AGENTS.md`, jadi bisa digabung
  ke jurnal manual.
- Yang **tidak** disimpan: nomor akun, nama server, password, nama pemilik, email.
  Jangan pernah mengetik data itu di kolom catatan.

---

## 5. Aturan yang ditanam (tidak bisa dilonggarkan)

Nilai ini tetap di kode (`RULES_FIXED`) dan selalu dipakai ulang saat aplikasi
dibuka maupun saat import JSON:

- Risiko per trade **0,5%**
- RR minimum **1,5**
- Maks **2 trade** per hari
- Stop harian **3%**, stop mingguan **6%**
- Stop setelah **2 loss beruntun**

Tidak ada tombol "longgarkan aturan". Kalau aturan dilanggar, trade **tetap boleh
disimpan** (jurnal harus jujur) tapi ditandai **melanggar aturan** dan dihitung di
statistik pelanggaran.

Hitungan risiko butuh satu angka dari MT5:
**Ctrl+U** → klik kanan simbol → **Specification** → lihat *Contract size* / *Tick value*.
Isi di **Atur** → "Cent rugi per 1,00 USD gerak harga untuk 1 lot".
Contoh XAUUSD kontrak 100 oz: 1,00 USD × 1 lot = 100 USD = **10.000 cent**.
Angka harus dari broker kamu sendiri — app tidak menebak.

Waktu memakai **WIB (UTC+7)** eksplisit, bukan zona waktu perangkat.

---

## 6. Menjalankan tes

Tanpa dependency apa pun:

```
cd journal-app
node tests.js
```

Keluaran: daftar `LULUS`/`GAGAL` per kasus + ringkasan. Exit code `0` = semua lulus,
`1` = ada yang gagal. Versi terakhir: **50 tes, 50 lulus**.

Di HP/laptop lewat browser: buka `tests.html`. Hasil tampil per baris.

Yang diuji: parsing angka, jarak SL, RR, risiko cent & %, hasil R, profit factor,
expectancy, win rate, equity series, max drawdown, loss beruntun, aturan stop
(harian/mingguan/jumlah trade/streak), dan pemeriksaan form entry (`entryFailures`).

Catatan: tes lolos = **hitungannya konsisten**, bukan bukti strategi menguntungkan.

---

## 7. Data contoh

Tab **Atur** → **Isi data contoh** (berlabel jelas, ada peringatan bahwa datanya
palsu) dan **Hapus data contoh**. Trade contoh ditandai `sample: true`, jadi
menghapusnya tidak menyentuh trade asli. Jangan pakai data contoh untuk
keputusan trading.

---

## 8. Keamanan (apa yang sengaja tidak ada)

- Tanpa CDN, tanpa font eksternal, tanpa analytics, tanpa iframe.
- Tanpa `fetch`/`XHR`/`WebSocket` ke domain mana pun. Satu-satunya `fetch` ada di
  `sw.js` untuk mengambil file **dari domain sendiri** (ada guard
  `url.origin !== self.location.origin` → langsung keluar).
- Meta CSP: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`
  → tidak ada inline JS, semua event lewat `addEventListener`.
- Tanpa `innerHTML` / `eval` / `new Function`; teks dimasukkan lewat `textContent`.
- Import file dibaca lokal dengan `FileReader`, tidak diunggah ke mana pun.
- CSV di-escape supaya tidak jadi formula injection saat dibuka di spreadsheet.

---

## 9. Batasan

- Ini pencatat manual. Sinyal tetap harus lolos backtest + uji ketahanan di
  `AGENTS.md` bagian 4/4A; app ini tidak mengubah keputusan itu.
- Statistik (win rate, PF, expectancy, DD) hanya seakurat data yang kamu isi.
  Sampel < 100 trade = belum meyakinkan.
- Bukan nasihat keuangan. Trading emas/CFD berisiko tinggi; mayoritas trader
  retail merugi. Jangan pakai uang kebutuhan sehari-hari atau uang pinjaman.
