# Roadmap: Menuju KATAI 2D yang "mirip PLAXIS" (versi 0.10.0-dev)

> **Untuk pekerja agentik:** baca `docs/superpowers/plans/2026-11-05-plaxis-parity.md` (539 baris) DULU.
> Plan itu memuat Phase 0–12 untuk **parity tutorial**: 19 lesson PLAXIS 2D Tutorial Manual + benchmark
> Schweiger (2002). Plan ini **tidak menggantinya** — plan itu tetap acuan parity. Plan ini menutup
> **sumbu yang tidak ada di sana**: fondasi yang hijau, kerangka numerik, output & UX PLAXIS,
> dan produk yang bisa dipasang pengguna. Urutan kerja dicatat di
> `.superpowers/sdd/2026-11-06-plaxis-completeness/progress.md`.

**Goal:** KATAI 2D diperlakukan pengguna sebagai "PLAXIS 2D yang gratis dan bisa diaudit":
alur kerja, nama menu, dan kedalaman output setara, sementara catatan verifikasinya
(`docs/validation/verification-matrix.md`) tetap jadi bukti kebenaran yang tidak dimiliki program mana pun.

**Architecture:** tidak berubah. Kernel C++ tetap satu-satunya sumber hitungan; FastAPI tetap job
runner; React tetap client. Yang berubah adalah **urutan kerja**, **keputusan arsitektur yang
tertunda** (mesh kanonik, budget solve, pemisahan jenis oracle), dan **cakupan produk**.

**Tech Stack:** C++20/Eigen (+MKL PARDISO opsional), FastAPI + Python 3.12, React 18 + TypeScript +
Vite 6 + Playwright, CTest + pytest.

**Sumber referensi:** `../plaxis2DSources/` (di luar repo, tidak di-commit): TM (19 lesson),
RM, MMM, SM, BM (Schweiger 2002, hanya Part I).

---

## 0. Yang sudah dimiliki vs yang kurang

| Sumbu | Sudah ada (terbukti) | Kurang |
|---|---|---|
| **Fisika inti** | 10 model konstitutif (LE, MC, HS, HSsmall, SS, SSC, MCC, Hoek-Brown, NGI-ADP, Jointed Rock), 6 strategi fase, staged construction dengan pewarisan aktivasi, safety φ–c dengan arc-length, konsolidasi Biot, aliran steady/transient, fully coupled, dinamika Newmark + free-field + response spectrum, liquefaction TBDY 2018, EC7 DA1–3, axisimetri, struktur (plate/anchor/geogrid/interface/embedded beam) | THM/thermal, UDCAM-S/siklik, deconfinement, updated mesh, flow-only phase, Kopling flow-mekanika yang bisa diekspresikan di `.k2d`, `dk` interface, Hoek-Brown strength-factorised |
| **Numerik** | Solver Newton inkremental dengan consistent tangent (Pérez-Foguet dkk.), hybrid continuum→consistent, line search backtracking + Grippo-Lampariello-Lucidi, kriteria konvergensi lokal & global, residual diverifikasi ≤1e-6, 12 thread | Performa pada HS/SS undrained near-failure; osilasi active set; budget solve belum dipisah interaktif/verifikasi |
| **Verifikasi** | 136 kasus KV (94 closed-form, 31 independent-path, 11 published benchmark) dengan deklarasi orakel **dipaksa mesin**; 26 `.k2d` korpus; matriks di-generate; 79 kode diagnostik `K2D-*` | 24 dari 30 kasus korpus PLAXIS masih BLOCKED; hanya 6 dari 26 file korpus punya band konvergensi terukur |
| **UI/Output** | Shell Input/Output, 5 mode tab, editor material 10 model, Staged Construction explorer dengan ikon status, Cross-section + CSV, live monitor, validasi terstruktur + klik-ke-field, Active-tasks dengan Stop | Curves manager, tabel kaya, laporan RTF/PDF/HTML, animasi, dialog legend, Project properties, authoring borehole, library validasi |
| **Produk** | `katai.exe` self-contained, wheel abi3, CLI 5 subcommand, Python DSL, E2E Playwright, Caddy+systemd deploy | PyPI, code signing, rilis Linux/macOS, multi-user, CI ber-matrix, referensi arsitektur |

---

## 1. Empat sumbu kerja

| Sumbu | Kode | Isi | Sifat |
|---|---|---|---|
| **Fondasi** | F | Suite hijau, dokumentasi benar, paket tidak rusak | murah,阻 blocking |
| **Engine** | E | Performa, mesh kanonik, pemisahan orakel, gap backend | mahal, sebagian riset |
| **UX & Output** | U | Output PLAXIS, authoring borehole, modularisasi | sedang–besar |
| **Produk** | P | Rilis, PyPI, signing, OS lain, multi-user, CI | sedang |

**Kritikal path berbeda untuk dua tujuan yang berbeda** — ini keputusan paling penting (D10):

* **Tujuan A — "parity terverifikasi"** (bukti bahwa mesinya sepadan dengan PLAXIS):
  `F → E(performa) → E(gap backend, Phase 7–8) → E(Phase 9) → Berlin (Phase 10)`.
  Kronologi: F (1–2 hari) → performa (minggu, tidak pasti) → 7/8 (bulan) → 9 (bulan).
* **Tujuan B — "produk yang terasa seperti PLAXIS"** (pengguna bisa memakainya):
  `F → U(shell + output) → P(rilis)`. Tidak bergantung pada performa atau Phase 9 sama sekali.

Keduanya bisa berjalan paralel (beda orang/agen), tapi **F tidak bisa ditunda di keduanya**:
seluruh Phase 3–12 berjalan di atas suite yang sekarang merah.

---

## 2. Ringkasan phase

| Phase | Isi | Bergantung pada | Ukuran | Sumber |
|---|---|---|---|---|
| **F** | Fondasi: suite hijau, docs benar, paket utuh | – | S | **BARU** |
| **E1** | Kerangka numerik: budget, osilasi active set, mode tangent | F | L | **BARU** (melengkapi Phase 11) |
| **E2** | Mesh kanonik: satu mesher untuk semua jalur | F, E1 | M | **BARU** |
| **E3** | Pemisahan jenis orakel di registry PLAXIS | F | S | **BARU** |
| 1–5 | UI Input/Output (sudah ada di plan aktif) | F | XL | plan aktif |
| 6 | Verifikasi gelombang A | E3 | L | plan aktif |
| **U1** | Aturan modularisasi `App.tsx` + Curves/Tabel/Laporan/Animasi | F | XL | **BARU** (lengkap) |
| **U2** | Authoring borehole & stratigrafi | F, E2 | M | **BARU** |
| **U3** | Library validasi (26 korpus + 9 studi, read-only) | F | S | **BARU** |
| 7 | Gap backend gelombang B | E1, E2 | XL | plan aktif |
| 8 | Gap backend gelombang C | E1 | L | plan aktif |
| **P1** | Rilis 0.10.0 + CI ber-matrix | F | M | **BARU** |
| **P2** | PyPI, signing, Linux/macOS | P1 | M | **BARU** |
| 9 | Thermal/THM + UDCAM-S | 7, 8, D6 | XXL | plan aktif |
| 10 | Benchmark Berlin sand | E3, D5 | M | plan aktif |
| 11 | Protokol performa | E1 | berkelanjutan | plan aktif |
| 12 | Penutupan parity | semua | S | plan aktif |

---

## 3. Phase F — Fondasi (BARU, wajib pertama)

> **AlasanBeing first:** plan aktif menulis Global Constraint "Semua test yang lulus sekarang tetap lulus:
> CTest (termasuk 136 ID), pytest, `npm run build`". Tapi `check_k2d_spec` **sekarang gagal dengan 21
> masalah** (`docs/validation/baseline-2026-11-05.md:75-90`), dan itu **entri ctest** (label `io`) →
> **CI di `main` kemungkinan merah**. Semua phase lain berdiri di atas suite merah.

### Task F.1: Tutup `check_k2d_spec` (21 masalah)

- [ ] Tambah 6 field `explicit_mesh` ke `docs/k2d-format.md`: `node_count`, `element_count`,
      `nodes_per_element`, `connectivity`, `element_material`, `boundary_nodes`.
- [ ] Tambah key yang sama ke `docs/k2d.schema.json` (`$defs.mesh` sudah ada — lengkapi).
- [ ] Samakan versi `.res` di doc (11) dengan `kResultsFileVersion` (12) di
      `kernel/io/include/katai/io/results_io.hpp:81`.
- [ ] Pastikan writer dan reader konsisten: `explicit_mesh` harus **dibaca balik** (saat ini tidak
      pernah dibaca — lihat Phase E2, ini berlumpeng dengan keputusan mesh kanonik).
- [ ] `python scripts/check_k2d_spec.py` → 0 masalah. `ctest -R check_k2d_spec` hijau.

**Exit:** `ctest` penuh hijau di tree Eigen (portable), kecuali test yang didokumentasikan lambat.

### Task F.2: Dokumentasi yang benar (README & turunan)

- [ ] README: "124 declared verification cases" → **136**; "276 automated tests" → **±289**
      (baseline mencatat 286; `--gate` PARDISO menambah 2).
- [ ] README: tabel material 7 → **10** (`modified_cam_clay`, `ngi_adp`, `jointed_rock`).
- [ ] README: bagian CLI 3 subcommand → **5** (`mesh`, `results` juga).
- [ ] README: "v0.9.0 (.k2d v18)" → tree adalah **0.10.0-dev / v29**.
- [ ] README: "a graphical interface (a separate, in-development track)" → web UI sudahsubstantial.
- [ ] `scripts/build.ps1:103` komentar "119 tests" → hapus (usang, lebih lama dari README).
- [ ] Header matriks yang basi (`check_references.py:299,311`): kalimat "The `Input file` column stays
      empty until the input corpus lands" → perbarui; kolom diisi dari registry korpus.
- [ ] `kernel/mesh/include/katai/mesh/mesh.hpp:6` "full Delaunay deferred" → hapus (sudah ada).
- [ ] `kernel/mesh/CMakeLists.txt` "P0.5 rectangle → structured tri6" → perbarui.

### Task F.3: `ARCHITECTURE.md` (8 rujukan menggantung)

- [ ] Tulis `katai2d/ARCHITECTURE.md`. Isi minimal: (1) alasan FDA (`element_traits`, tanpa vtable)
      dengan rujukan Pérez-Foguet dkk.; (2) keputusan rename `katai::app` → `katai::core` yang ditunda
      + alasannya + syarat pencabutan; (3) peta layer `core → app → api → front end`;
      (4) aturan "material diselesaikan by NAME, penolakan-bukan-substitusi".
- [ ] Rujukan saat ini: `jobs/job.hpp:28`, `jobs/driver.hpp:10`, `api/katai.hpp:26`,
      `io/results_io.hpp:32`, `io/issue.hpp:12`, `materials/material_model.hpp:4`,
      `fem/elements/element_traits.hpp:3`, `mesh/mesh.hpp:6`.

### Task F.4: Perbaiki paket wheel (2 bug nyata)

- [ ] `python/katai/cli.py` mengklaim "line for line" sama dengan `cli/main.cpp`, tapi hanya
      `solve|validate|info`. Tambahkan `mesh`, `results`, dan flag `--timings/--progress/--monitor`,
      atau turunkan klaimnya. **Pilih satu dan tulis di docstring.**
- [ ] `python/katai/mesher.py` (697 baris): tidak di-export dari `__init__.py`, mengimpor `gmsh` +
      `shapely` yang **tidak dideklarasikan** (`build_wheel.ps1:125` → `dependencies = ["numpy"]`),
      tapi tetap ter-ship (`packages = ["katai"]`). Akibatnya `import katai.mesher` di instalasi
      wheel bersih pasti `ImportError`. Pilih: (a) hapus dari paket, (b) deklarasikan
      `gmsh`+`shapely` sebagai extra, (c) jadikan plugin opsional.
- [ ] Gate bahasa: `scripts/check_language.py` hanya mendeteksi huruf/kata **Turki**
      (regex `[ğĞıİşŞüÜöÖçÇ]`). Docstring **Indonesia** di `mesher.py` lolos. Persempit policy ke
      "English-only" (baseline `scripts/language_baseline.json` = `{}` → bisa diperketat).

### Task F.5: Rujukan menggantung & hole yang diketahui

- [ ] `python/src/core_bindings.cpp:374` & `:606` menyebut `katai.generate_stratigraphy` yang **tidak
      ada** (0 hit di seluruh paket). Implementasikan binding-nya (C++ sudah punya
      `kernel/model/include/katai/model/stratigraphy.hpp`) atau hapus rujukannya. → lihat Task U.2.
- [ ] `web/server/app.py:235` cabang `command=="mesh"` di `cli_report` = dead code (jalur `/mesh`
      memakai mesher Python, bukan CLI). Bersihkan.
- [ ] Root `FEM/`: hapus ~45 scratch `.py`, `plaxis_style_mesher.py` (versi **lama** — tanpa
      `target_element_size` dan Tri15), dan file `nul` (sisa redirect shell).

### Task F.6: Gerbang bahasa & arsitektur diperkuat

- [ ] `scripts/check_architecture.py` sudah memeriksa front end hanya meng-include
      `<katai/api/katai.hpp>` — pertahankan.
- [ ] Tambah gate: tidak boleh ada referensi ke file dokumentasi yang tidak ada (menangkap kelas
      bug `ARCHITECTURE.md`).

**Exit Phase F:** `ctest` hijau di tree portable; `pytest web/server/test_app.py` hijau;
`npm run build` + `npm run test:e2e` hijau; `katai validate --json` pada `tests/corpus/*.k2d`
(26 file) tidak keluar kode 4; wheel `pip install` → `import katai` dan `import katai.mesher`
(atau tidak lagi ada) keduanya jalan.

---

## 4. Phase E1 — Kerangka numerik (melengkapi Phase 11)

> Phase 11 sudah mengukur akurat. Yang belum ada: **kebijakan budget** yang memisahkan pemakaian
> interaktif dari verifikasi, dan **leva yang belum dicoba** untuk osilasi active set.

### Task E1.1: Pisahkan budget solve (kebijakan, bukan kode)

| Mode | Budget | Perilaku | Soal |
|---|---|---|---|
| **Interaktif** (UI web, `POST /api/jobs`) | 300 s default | `status="timeout"`, `.res` parsial disimpan, UI menampilkan "perlu budget lebih lama" |漊 D9 sudah mengizinkan ini; yang belum ada adalah **pesan yang mengarahkan** |
| **Verifikasi** (harness, `run_all.py`) | tak terbatas (`measure_uncapped.sh` sudah ada) |_job tidak dibunuh_ | Korpus L2-U/L9/Berlin **tidak pernah boleh** dibunuh 300 s |

- [ ] `KATAI_SOLVE_TIMEOUT_S` jadi dua knob: `KATAI_SOLVE_TIMEOUT_S` (interaktif) dan
      `KATAI_SOLVE_TIMEOUT_S_VERIFY=0` (tak terbatas) untuk harness.
- [ ] Justifikasi biologis: **PLAXIS sendiri tidak menyelesaikan HS embankment undrained dalam
      5 menit.** Batas 5 menit adalah anggaran *dev*, bukan properti fisika. Jangan mengukur
      kebenaran dengan anggaran interaktif.

### Task E1.2: Osi active set 1↔3400 (akar masalah 2)

Gejala terukur: 15–20 iterasi Newton per increment 2,5 %; line-search α 0,1–0,4; episode NO-DESCENT;
**jumlah titik plastis berayun 1 ↔ 3400 antar iterasi**. Ayunan sebesar itu berarti himpunan aktif
tidak konvergen — iterasi melompat antara dua cekungan.

- [ ] **Diagnostik dulu:** log ukuran himpunan aktif per iterasi (bukan hanya per langkah).
      Gunakan `KATAI_HS_TRACE` yang sudah ada; tambahkanJika perlu, tulis ukuran himpunan aktif
      ke `.progress.json` agar terlihat di UI.
- [ ] Hipotesis A: himpunan aktif pada **continuum tangent** basi di regime keras (komentar
      `material_model.hpp:727` sudah menyebutnya). Uji: apakah ayunan hilang saat mode
      `kConsistent` aktif terus-menerus?
- [ ] Hipotesis B: **hybrid retry dibayar per increment**. Setiap increment di regime keras
      membayar: 1 percobaan continuum yang gagal + percobaan consistent yang mahal.
      → **Leva 1 (sticky mode):** ingat mode tangent yang berhasil pada increment sebelumnya dan
      **coba itu lebih dulu** pada increment berikutnya. Menghapus pajak "percobaan continuum gagal"
      per increment. Murah, terukur.
- [ ] **Leva 2 (reuse tangent dalam increment):** tangent consistent = 3 run forward-difference
      + 1 run basis = **4× biaya integrasi**, dan ia dihitung ulang tiap iterasi Newton.
      Hitung **sekali per increment**, pakai ulang untuk iterasi-iterasi berikutnya (modified Newton
      di iterasi akhir). Potensi 3–5× pada regime keras. Perlu uji konvergensi: kuadratik → linier.
- [ ] **Leva 3 (kriteri global):** `kStagnationAccept = 1e-3`, `kStagnationWindow = 30`,
      `kLastResortAccept = 1e-2`. Uji melonggarkan kriteria global HS ke `tolerated error` 0,01
      ala PLAXIS (RM §7.9.3) — **eksperimen paling murah dan paling mungkin berdampak besar**, dan
      sudah ada di Phase 11.B tapi belum dicoba untuk HS. Ukur (a) waktu, (b) jawaban vs gate 2 %.
- [ ] **Leva 4 (line search):** `kStallEscalationWindow = 5` sudah ada. Uji escalation lebih awal
      (3) dan/atau *trust region* pada multiplier plastis.
- [ ] **Leva 5 (batas bawah integrasi):** `KATAI_HS_EDGE=1` (eksperimen, default OFF) memperbaiki
      20–50× pada panggilan di tepi tension cut-off dan menggeser jawaban ≤3e-6 kPa, tapi **lebih
      lambat** pada drained (108 s vs 78 s) dan tetap timeout di undrained. Uji ulang **setelah**
      Leva 1–3 — mungkin biaya drained-nya hilang kalau retry tidak dibayar tiap increment.

### Task E1.3: Yang sudah diukur dan tidak boleh diulang

Tidak ada gunanya mengulang: PARDISO vs Eigen (4e-16..1e-12, ~2× lebih cepat);
`KATAI_AUTO_STEPS` (133→32 iterasi, tapi 22→25 s; **tidak efektif untuk HS** karena substep HS
skalanya dengan besar increment regangan — total kerja konstitutif ditentukan jalur regangan,
bukan jumlah langkah); `substol` 1e-3 (netral di drained, tapi **gagal menua** di undrained
near-failure: build phase collapse di 65 % dengan CSP 0,024); orde tri6 (**bukan** lever bebas:
FoS drained +4,3 %).

**Exit E1:** untuk L2-U (tri15, substol 1e-4) — **FoS 1,40 ± 2 % dalam ≤ 900 s** di mesin acuan,
dengan L2-U tri6 1,3991 dicatat sebagai **parity PLAXIS** (lihat Task E3.2), bukan sebagai
verification yang ditolak.

---

## 5. Phase E2 — Mesh kanonik (satu mesher untuk semua jalur)

> **Temuan:** ada **dua dunia meshing**.
> - **CLI / harness / korpus** → `katai mesh` & `app::mesh_from_project` → mesher kernel
>   (Bowyer-Watson, Delaunay terbatas, kualitas Ruppert, `kernel/mesh/src/delaunay.cpp`).
> - **Web app** → `web/server/plaxis_style_mesher.py` → **gmsh + OpenCASCADE** (Boolean Fragment,
>   mesh size field Distance+Threshold+Min, Frontal-Delaunay) → hasilnya disimpan sebagai
>   `explicit_mesh` di proyek, lalu **disolve CLI**.
>
> Artinya: **mesh yang diverifikasi (korpus, via CLI) BUKAN mesh yang dilihat pengguna di web.**
> Keduanya tri6/tri15, keduanya "PLAXIS-style", tapi berbeda algoritma, berbeda kualitas,
> berbeda kualitas sudut. Dan `explicit_mesh` tidak pernah dibaca balik — itulah sebagian dari
> 21 masalah `check_k2d_spec` (Task F.1). Spec tidak bisa mendeskripsikan mesh karena **ada dua**.

- [ ] **E2.1 Keputusan (D11):** mana mesher kanonik?
      Opsi (a) kernel C++ jadi kanonik — Python gmsh dihapus dari jalur produksi; format `.k2d`
      menyimpan mesh sebagai **node+connectivity+material per elemen** (bukan meta gmsh).
      Opsi (b) mesher Python jadi kanonik — kernel memanggilnya lewat subprocess (jelek) atau
      gmsh dijadikan dependensi linker (berat).
      **Rekomendasi: (a)** — kernel adalah sumber hitungan; jangan menambah proses eksternal di
      jalur produksi; gmsh tetap sebagai alat eksplorasi/riset.
- [ ] **E2.2** Jika (a): port `plaxis_style_mesher.py` (local coarseness factor, deteksi lapisan tipis,
      grading, corner refinement — sebagian **sudah ada** di kernel v29: `mesh.rel`, `mesh.grading`,
      `mesh.corner_refine`) ke `kernel/mesh/`, lalu samakan dengan Python.
- [ ] **E2.3** Definisi `explicit_mesh` di format `.k2d`: node, connectivity, material per elemen,
      boundary nodes — **tanpa metadata gmsh**. Writer + reader + schema + validator + doc.
- [ ] **E2.4** Uji ekuivalensi: 26 file korpus di-mesh dengan **dua** mesher; bandingkan jumlah node,
      elemen, sudut minimum, dan **jawaban** (FoS/settlement) per kasus. Selisih jawaban > band
      =_report_, bukan diabaikan.
- [ ] **E2.5** Sтори: `katai mesh` jadi satu-satunya jalan membuat mesh; web memanggil CLI
      `katai mesh` (bukan Python in-process) — menghapus jalur mesh kedua.

**Exit E2:** satu mesher untuk CLI, web, dan harness; `explicit_mesh` terbaca balik; 26 file korpus
memLaporan selisih antar-mesher sebagai baseline.

---

## 6. Phase E3 — Pisahkan jenis orakel di registry PLAXIS

> **Masalah metodologis yang sedangmw相关内容 jadi hilang.** Registry memaksa satu verdict per
> kasus. Padahal ada **dua pertanyaan berbeda** yang tercampur:
> - **Parity:** "apakah model kita menghasilkan angka yang sama dengan PLAXIS?" → jawabannya
>   **memakai diskretisasi PLAXIS** (6-node). Angka PLAXIS/results **tidak** konvergen.
> - **Verifikasi:** "apakah model kita benar?" → dijawab terhadap solusi closed-form, **dengan
>   diskretisasi kita yang harus konvergen**.
>
> Kasus yang terjebak: **L2-undrained**. Hasil tri6 = **1,3991** vs TM 1,4 (0,07 %) — itu
> **parity yang sangat baik**. Tapi ledger **menolaknya** sebagai verification karena tri6
> menggeser FoS drained +4,3 % (jadi "cocok sebagian kebetulan"). Lewat지도 **dari
> ledger**: yang di-*reject* adalah statement "L2-U terverifikasi", bukan statement "L2-U
> parity di diskretisasi PLAXIS". Karena verdict-nya satu kolom, kasus yang sebenarnya **hampir
> lolos hilang** dari catatan.

- [ ] **E3.1** Tambah kolom verdict kedua di `tests/verification/plaxis/registry.json`:
      `parity_vs_plaxis` (diskretisasi PLAXIS, toleransi 2 %) dan `converged_vs_closed_form`
      (diskretisasi kita yang sudah konvergen, toleransi 2 %). Satu kasus boleh
      `parity=PASS, converged=OPEN` — dan keduanya dilaporkan.
- [ ] **E3.2** Kaso L2-U: catat **dua** hasil —
      (a) tri6 + substol 1e-4 → FoS 1,3991 → **parity PASS** (terhadap TM 1,4);
      (b) tri15 + substol 1e-4 → **verifikasi** terhadap closed form/hasil konvergen (masih OPEN).
      Status tri6 yang "ditolak" harus dilabeli ulang, **bukan dihapus**.
- [ ] **E3.3** L1-A (pondasi kaku +11,62 %): karakterisasi sudah benar (singularitas tepi pondasi,
      konvergensi monoton 656→626→605→588 kN). Verdict: `parity=CHARACTERISED` (dengan bukti
      konvergensi mesh), bukan `FAIL`.
- [ ] **E3.4** Tambah `ref_discretisation` ke setiap entri: `plaxis_6node`, `plaxis_tri15`,
      `plaxis_axi`, `closed_form`, `digitised` — supaya band 2 % selalu dibaca terhadap diskretisasi
      yang **benar**.
- [ ] **E3.5** Perbarui `docs/validation/plaxis-parity-report.md` generator untuk dua kolom.

**Exit E3:** laporan parity menampilkan dua kolom; tidak ada kasus yang hilang karena satu kolom.

---

## 7. Phase U1 — Output PLAXIS & aturan modularisasi `App.tsx`

> `web/client/src/App.tsx` = **2.664 baris / 171 KB**, `App()` ~1.500 baris. Task 1.2 (ekstraksi
> modul) **ditunda** dengan alasan benar (Phase 3–5 akan menulis ulang permukaannya). Tapi Phase 5
> sudah Half-dONE (Cross-section + CSV), dan Curves/Tabel/Laporan/Animasi akan menambah beberapa ratus
> baris lagi ke file yang sama. **Tanpa aturan, Phase 5 berakhir dengan file 3.500 baris.**

### Task U1.1: Aturan modularisasi (keputusan, bukan pekerjaan tersendiri)

- [ ] Setiap fitur Output baru **wajib**住在 file baru di `web/client/src/<feature>/`, bukan di
      `App.tsx`. Batas keras: **App.tsx tidak boleh melewati 3.000 baris** selama Phase 5.
- [ ] Komponen yang sudah ada (`SoilMaterialEditor`, `StagePhaseEditor`, `MeshSettingsEditor`,
      `PolygonEdgeEditor`, `LiveMonitorChart`) diekstrak **ketika** fitur yang memakainya selesai —
      bukan sebagai langkah tersendiri (prinsip yang sudah dipakai Phase 1: "extract as you carve out").
- [ ] `canvas.spec.ts` (jaring pengaman tanpa solve) wajib hijau sebelum & sesudah tiap carve-out.

### Task U1.2: Curves manager (RM ch. 10)

- [ ] Kurva x–y bebas: pilih titik监测 (node), pilih besaran, tambah kurva, **beberapa kurva per chart**,
      sumbu logaritmik, titik pra/per/post-kalkulasi.
- [ ] Sumber data: `.res` (CLI JSON) + CSV cross-section (format yang sudah dikonsumsi `compare.py`).
- [ ] Reuse: `LiveMonitorChart` sudah ada — jadikan fondasi, bukan komponen terpisah.

### Task U1.3: Tabel kaya

- [ ] Tabel nodal (sudah ada) → sortable + filterable; tab per struktur; tab stress point.

### Task U1.4: Laporan (RTF/PDF/HTML) + animasi

- [ ] Generator laporan: ringkasan fase, ekstrem + lokasi, amplop gaya struktur, diagnostik,
      kurva terpilih — **memakai `katai.summary()`** yang sudah ada sebagai sumber kebenaran.
- [ ] Animasi AVI: playback medan penuh (terkendung: kernel menunda stress recovery jalur linear
      dinamika dan playback medan penuh — `analysis/dynamics.hpp`).

### Task U1.5: Dialog yang masih kurang

- [ ] **Project properties** modal (tab Project / Model / Constants) — Task 3.2 ditunda.
- [ ] **Legend settings** (skala manual/log, kunci) — Task 5.x.
- [ ] **Output menu bar** bernama (Deformations / Stresses / Forces) — kosi (dropdown + groups sudah
      menutupi;submenu bernama bersifat kosmetik, **ditandai sebagai opsional**).

**Exit U1:** Curves manager + tabel kaya + laporan HTML berfungsi; `App.tsx` ≤ 3.000 baris;
`npm run build` bundle tetap < 400 KB.

---

## 8. Phase U2 — Authoring borehole & stratigrafi (fitur tanda tangan PLAXIS)

> C++ **sudah punya** `kernel/model/include/katai/model/stratigraphy.hpp` (borehole → poligon + garis
> air) dan `Borehole`/`Stratum` **sudah ter-bind** di `_core`. Yang tidak ada: (1) fungsi Python
> (`generate_stratigraphy` dirujuk di docstring tapi tidak ada), (2) permukaan DSL, (3) authoring di UI.
> Task 3.3 ditunda dengan alasan "kernel consuming polygons langsung" — alasan itu **benar untuk
> korpus**, tapi **PLAXIS-parity-butuh authoring borehole**, dan biayanya jauh lebih murah karena
> kernel-nya sudah ada.

- [ ] **U2.1** Bind `generate_stratigraphy` di `python/src/core_bindings.cpp` (hilangkan rujukan
      menggantung sekaligus). Spec: borehole (x, level per boundary, water head) → poligon lapisan
      + garis air + `strata`.
- [ ] **U2.2** Permukaan DSL: `prj.boreholes`, `prj.strata` → handle; dan
      `prj.geometry.from_boreholes(...)` yang menghasilkan region. Tetap **opsional** — korpus
      tetap polygon-based (D1 tidak berubah).
- [ ] **U2.3** UI: dialog "Modify soil layers" (RM §4.2–4.3) — tabel layer dari log borehole →
      pratinjau polygon → region aktif. Ingressi ini yang membedakan "seperti PLAXIS" dari
      "seperti pemanggil API".
- [ ] **U2.4** Verifikasi: `kernel/geometry`/`stratigraphy` sudah punya kasus (KV-GEO-*);
      tambahkan yang menguji jalan **binding + DSL** (bukan hanya kernel).

**Exit U2:** satu model borehole → region di UI; `.k2d` menyimpan borehole sehingga file bisa
dibuka ulang di tempat lain.

---

## 9. Phase U3 — Library validasi (read-only)

> D1 menghapus example/preset dari **UI modelling** (memENU File/Studies/Examples + tombol Presets).
> Itu benar: preset semantik menyulitkan modeling. Tapi PLAXIS punya **tutorial**, dan nilai
> tutorial itu ada di repo ini: **26 korpus + 9 studi**, semuanya benchmark terbit yang bisa di-rerun.
> Yang hilang adalah **rumahnya**, bukan isinya.

- [ ] **U3.1** Browser "Validation examples" sebagai **layar terpisah** (bukan di menu modelling):
      daftar 26 korpus + 9 studi, tiap entri menampilkan: besaran yang diverifikasi, sumber
      (sitasi lengkap + halaman), band, dan **hasil run terakhir**.
- [ ] **U3.2** Klik → **membaca** file itu (read-only) ke proyek baru, ATAU menjalankan langsung
      (tombol "Run in workspace"). Tidak ada penulisan diam-diam ke proyek aktif.
- [ ] **U3.3** Ambil status & band dari `docs/validation/verification-matrix.md` (di-generate) —
      jangan tulis ulang di frontend.
- [ ] **U3.4** Jaga D1: tombol Presets, modal preset, dan entri `import.meta.glob` **tetap hilang**
      dari alur modelling. `canvas.spec.ts` sudah punya guard untuk ini — pertahankan.

**Exit U3:** pengguna bisa menemukan, membaca, dan menjalankan 35 kasus validasi dari UI.

---

## 10. Phase P — Produk & distribusi

> Plan aktif tidak punya sumbu ini sama sekali (Phase 12 hanya "dokumentasi, CI, laporan akhir").
> Tanpa ini, "mirip PLAXIS" berhenti di demo internal.

### Task P.1: Rilis 0.10.0

- [ ] Tutup Phase F. Jalankan `scripts/build.ps1` (Windows) dan `scripts/build-linux.sh` (WSL).
- [ ] `scripts/package_cli.ps1` → `dist/katai2d-0.10.0-win64.zip` + SHA-256.
- [ ] `scripts/build_wheel.ps1` → verifikasi di venv bersih (sudah ada: `katai info`=0,
      validate kv-slp-001=0, solve kv-num-003=0, solve kv-fnd-010=**exit 5** "the honest refusal",
      2 example). Rilis ke **GitHub Releases**.
- [ ] `CHANGELOG.md`: pindahkan `[Unreleased]` → `[0.10.0] - <tanggal>`; catat `.k2d` v19→v29.
- [ ] Peringatan **tidak** mengulang: build tree ini **mengubah jawaban 0.9.0** (interface air, toleransi
      HS, mesh grading). Rilis 0.10.0 harus menyatakan ini; angka 0.9.0 tidak boleh direproduksi
      oleh build ini.

### Task P.2: PyPI

- [ ] `pip install katai2d` (README sudah menjanjikan "planned"). Butuh: name check, twine,
      artifact sdist, dan keputusan lisensi wheel (Apache-2.0 + NOTICE untuk Eigen).
- [ ] Verifikasi wheel di venv bersih **tanpa** `gmsh`/`shapely` (kalau Task F.4 memilih hapus
      `mesher.py`, ini otomatis).

### Task P.3: Code signing (SmartScreen)

- [ ] Executable sekarang tidak-signed → Defender memberi label generik
      (`Trojan:Win32/Wacatac.B!ml` — false positive untuk binary unsigned yang belum punya reputasi).
      README sudah menjelaskannya, tapi **menandatangani** menghapus friksi installer.
- [ ] Meny braços: sertifikat code-signing (OV/EV) + `signtool` di pipeline rilis.

### Task P.4: OS lain

- [ ] Linux sudah bisa dibangun (`ci-linux.yml`, `ubuntu-24.04-mkl`). Rilis `.deb`/AppImage +
      paket pip untuk Linux.
- [ ] macOS: **evaluasi dulu** — OpenMP/thread pool, `KATAI_DLL_PATH` (hook Windows), PARDISO,
      path Unicode (`kernel/io/include/katai/io/utf8_path.hpp` sudah ada). Siapkan sebagai Phase
      terpisah, bukan sampingan rilis 0.10.0.

### Task P.5: Multi-user (untukensic, D12)

- [ ] Server sekarang **single-owner**: satu bearer token, `job_lock` global → **satu solver
      server-wide**, registry job in-memory, `--workers 1` wajib. Untuk dipakai tim, butuh:
      identitas per-user, kuota solver, registry persisten.
- [ ] Ini **bukan** pekerjaan rilis 0.10.0. Cukup: multi-user multi-tenancy dengan scheduling
      solver per-(user,project), `--workers 1` tetap sah, `--workers N` + registry bersama
      butuh rethink `job_lock`.

### Task P.6: CI ber-matrix

- [ ] Tambah job **MKL/PARDISO** (sekarang tidak ada di kedua platform) → `test_pardiso_*`.
- [ ] Job **nightly** untuk label `plaxis` (harness penuh, lambat).
- [ ] Job **Windows + Linux** untuk build rilis (`package_cli.ps1` + `build_wheel.ps1`).
- [ ] Tambah job **web E2E** ke Linux (sekarang sudah ada) + `web/client/tests/*.spec.ts`
      (port 5174) yang **tidak** ada di config Playwright default → tentukan: masukkan atau hapus.
- [ ] Budget waktu CI: suite penuh + `-j 4`; pisahkan yang `slow` ke job nightly.

**Exit P:** 0.10.0 ter rilis di GitHub + PyPI, executable tertandatangani, CI hijau di Windows &
Linux dengan job PARDISO.

---

## 11. Anti-goals (yang TIDAK boleh dilakukan)

1. **Tidak mengejar jumlah fitur PLAXIS.** Targetnya **30 kasus korpus**, bukan "fitur seperti PLAXIS".
   L1 yang benar lebih berharga dari 20 yangRwiah.
2. **Tidak ada fudge factor.** Tidak ada penyesuaian parameter material, faktor koreksi, atau toleransi
   khusus per kasus agar cocok dengan PLAXIS. Selisih dijelaskan mekanismenya (sudah jadi
   Global Constraint plan aktif — pertahankan).
3. **Tidak promoting eksperimen ke default tanpa bukti netralitas.** `KATAI_HS_EDGE`,
   `KATAI_AUTO_STEPS`, `KATAI_HS_STATS`, `KATAI_NL_PROFILE` — semua default-OFF sampai ada
   pengukuran "netral terhadap jawaban" (seperti `substol` 1e-4 yang sudah terbukti netral).
4. **Tidak memindahkan `App.tsx` ke <400 baris sebagai target.** Targetnya fitur, bukan baris;
   ekstraksi terjadi sebagai efek samping dari carve-out fitur.
5. **Tidak menulis ulang `driver.cpp` (5.796 baris) sekarang.** Monolith itu risiko, tapi
   membongkar-phase风险 > nilai selama paritas belum tutup. Pecah **saat** menyentuh dispatch
   fase, bukan sebagai proyek tersendiri.
6. **Tidak menyalin trade dress PLAXIS.** Ikon, logo, nama produk — ikon buatan sendiri (D8).
7. **Tidak menjadikan web satu-satunya jalan ke kapabilitas.** Setiap fitur harus bisa dijalankan
   lewat CLI/Python juga, karena korpus diverifikasi lewat CLI.
8. **Tidak mengorbankan determinisme.** Assembly dua-fase (hitung paralel, scatter sekuensial)
   menjaga hasil bit-identik — jangan diubah demi kecepatan.

---

## 12. Keputusan yang perlu dikonfirmasi

| # | Pertanyaan | Usulan default | Risiko jika salah |
|---|---|---|---|
| **D10** | Tujuan utama: **parity terverifikasi** (A) atau **produk terasa seperti PLAXIS** (B)? | **Keduanya**, dengan A sebagai prioritas但不 mengunci B (F adalah satu-satunya prasyarat bersama). Kalau harus pilih satu: pilih **B** — lebih cepat memberi nilai, dan A tidak akan pernah selesai tanpa D5/D6/D7 (Part II BM, persetujuan thermal/UDCAM-S, file `.smc`). | Salah fokus = satu tahun untuk parity tanpa pengguna, atau produk tanpa bukti |
| **D11** | Mesher kanonik (Task E2.1) | **Kernel C++** (opsi a). Python gmsh jadi alat riset, bukan jalur produksi. | Kalau (b), format `.k2d` akan bring process eksternal — sulit, lambat, danMcEMO mismatch solver |
| **D12** | Multi-user kapan? | **Setelah** 0.10.0 (Phase P.5 terpisah) |、S releases single-user — sesuai roadmap produk saat ini |
| **D13** | Budget solve interaktif 300 s tetap? | **Ya**, tapi dengan pesan yang mengarahkan + jalur verifikasi tak terbatas (E1.1) | 300 s terlalu strict untuk用户的 model nyata → 用户 experience buruk |
| **D14** | Dua kolom verdict di registry PLAXIS (E3)? | **Ya** — `parity_vs_plaxis` + `converged_vs_closed_form` | Kalau satu kolom, kasus yang hampir lolos (L2-U tri6) hilang tanpa jejak |
| **D15** | Library validasi di UI (U3) — melanggar D1? | **Tidak**, karena layar terpisah & read-only; guard `canvas.spec.ts` tetap | Pelanggaran D1 → alur modelling jadi riuh |
| **D16** | whether 1e-4 `substol` boleh jadi default HS? | **Belum** — butuh pengukuran netralitas pada lebih banyak kasus (L1-A, L9, Berlin) sebelum default | Defaultiyama Hash idak netral pada kasus lain → jawaban bergeser |
| **D17** | Tahapan mana yang dikerjakan lebih dulu setelah F? | **E1 (numerik) + U1 (Output)** paralel; E1 membuka L2-U/L9, U1 memberi nilai的用户-facing | Berhenti di tengah → tidak ada yang bergerak |
| **D18** | macOS sekarang atau setelah? | **Setelah** Linux 0.10.1; macOS = Phase terpisah | Makroak technical debt (PATH/dll hook/PARDISO) |

---

## 13. Verification (per phase)

| Phase | Perintah | Kriteria |
|---|---|---|
| F | `ctest --test-dir build/portable -j 4`; `pytest web/server/test_app.py`; `npm run build && npm run test:e2e`; `python scripts/check_k2d_spec.py` | semua hijau; `check_k2d_spec` = 0 masalah |
| E1 | `bash scripts/verification/l2u_matrix.sh`; `bash scripts/verification/l2d_check.sh` | L2-U tri15 FoS 1,40 ± 2 % ≤ 900 s; drained L2 FoS tetap 1,8500 ± 0,05 % |
| E2 | `katai mesh` vs `plaxis_style_mesher` atas 26 korpus | laporan selisih node/elemen/sudut/jawaban; 1 jalur mesh saja di produksi |
| E3 | `python scripts/verification/run_all.py` | laporan dua kolom; tidak ada kasus hilang |
| U1 | `npm run build`; `npm run test:e2e` | bundle < 400 KB; `App.tsx` ≤ 3.000 baris |
| U2 | `ctest -R geo`; `pytest python/tests` | binding + DSL round-trip |
| U3 | `npm run test:e2e` (termasuk guard D1) | guard D1 hijau; library bisa dibuka & dijalankan |
| P | `scripts/package_cli.ps1`; `scripts/build_wheel.ps1`; `ctest` (Windows + Linux) | artefak + SHA-256; wheel terverifikasi di venv bersih |
| semua | `ctest` (default), `git diff --check` | tidak ada regresi dari baseline |
