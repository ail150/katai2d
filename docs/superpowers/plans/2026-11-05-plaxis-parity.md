# PLAXIS Parity Implementation Plan (UI, validasi input, verifikasi tutorial & benchmark)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Kerjakan per phase, satu task per commit, catat progres di `.superpowers/sdd/2026-11-05-plaxis-parity/progress.md`.

**Goal:** Membuat webapp katai2d mengikuti alur kerja dan tampilan PLAXIS 2D (program Input dan Output), membuang semua example/preset dari UI, menambahkan sistem loader/freeze untuk setiap proses backend, membuat validasi input sedetail mungkin, lalu memverifikasi engine terhadap 19 lesson PLAXIS 2D Tutorial Manual dan benchmark Schweiger (2002) Berlin sand dengan galat < 2 %.

**Architecture:** Kernel C++ tetap menjadi satu-satunya sumber hitungan (CLI `katai validate|mesh|solve|results`). Server FastAPI (`web/server/app.py`) tetap sebagai job runner, ditambah batas waktu dan endpoint diagnosa. Client React dipecah dari satu file `App.tsx` (2712 baris) menjadi modul shell Input, shell Output, editor dialog, dan modul kanvas. Logika kanvas (gambar, snap, seleksi, zoom/pan, preview mesh) dipindahkan tanpa perubahan perilaku.

**Tech Stack:** C++17/Eigen (kernel), FastAPI + Python 3.12 (server), React + TypeScript + Vite (client), Playwright (E2E), CTest + pytest (regresi), PyMuPDF (ekstraksi kurva vektor dari PDF).

**Sumber referensi:** `../plaxis2DSources/` (di luar repo, tidak di-commit):
- `PLAXIS_2D_1_Tutorial Manual.pdf` (TM, 2025.1, 295 hlm, 19 lesson)
- `PLAXIS_2D_2_Reference Manual.pdf` (RM)
- `PLAXIS_2D_3_Material Models Manual.pdf` (MMM)
- `PLAXIS_2D_4_Scientific Manual.pdf` (SM)
- `geotechBenchmarking.pdf` (BM, Schweiger 2002, hanya Part I, 26 hlm)
- `HardeningSoilVerification.pdf`, `15-Hardening-Soil-Model-PLAXIS.pdf`

---

## Keputusan yang harus dikonfirmasi sebelum mulai

Setiap butir di bawah punya usulan default. Plan ini ditulis dengan asumsi default tersebut.

| # | Pertanyaan | Usulan default | Risiko jika salah |
|---|---|---|---|
| D1 | "Hapus semua example dan preset" berlaku untuk apa? | Hapus dari **UI** (menu File/Studies/Examples, tombol Presets, modal preset, `import.meta.glob` di `App.tsx` baris 10–19, `web/client/public/examples`, `web/examples`). `tests/corpus/*.k2d` (26 file) dan `tests/studies/*.k2d` (9 file) **tetap** sebagai fixture regresi kernel (dipakai CTest `test_input_corpus` dan `tests/test_studies_presets.py`). | Menghapus fixture kernel mematikan 26+ test regresi. |
| D2 | Definisi "galat < 2 % di setiap data point" | Untuk titik i: `e_i = |y_katai(x_i) − y_ref(x_i)| / max(|y_ref(x_i)|, 0.10 · max_j |y_ref(x_j)|)`. Lolos jika `max_i e_i < 2 %`. Kurva katai diinterpolasi linear ke absis referensi. Lantai 10 % dari puncak diperlukan karena galat relatif di titik yang nilainya mendekati nol tidak terdefinisi. Nilai skalar (gaya, FoS) memakai galat relatif biasa. | Tanpa lantai, titik dekat nol (misalnya ujung bawah dinding) selalu gagal walaupun kurvanya identik. |
| D3 | Grafik tutorial adalah gambar raster (screenshot PLAXIS) | Kurva didigitasi manual dengan kalibrasi sumbu. Ketidakpastian digitasi `u_dig` dicatat per kurva (target ≤ 0.5 % dari rentang sumbu). Jika `u_dig` mendekati 2 %, kriteria tidak bisa diputuskan dan dilaporkan begitu, tidak dianggap lolos. | Klaim "< 2 %" pada data yang dibaca dari gambar beresolusi rendah tidak bisa dipertahankan. |
| D4 | Pernyataan manual yang hanya perkiraan ("about one meter", "around 1 Hz", "more than 50 days") | Dicatat sebagai pemeriksaan kualitatif dengan rentang yang disebut manual, bukan gate 2 %. | Gate 2 % terhadap angka "kira-kira" tidak bermakna. |
| D5 | Benchmark Berlin: file hanya berisi Part I. Part II (reference solution PLAXIS HS beserta parameter HS-nya) tidak ada di file. | Target utama = kurva "reference solution" di halaman sampul BM (vektor, bisa diekstrak tepat). Parameter HS reference solution **wajib diperoleh dari Part II asli** (minta ke user). Tidak boleh mengarang parameter. Tanpa Part II, benchmark hanya bisa dibandingkan terhadap rentang B1–B17 dan "measurement (corrected)" (Fig. 7). | Membandingkan dengan parameter tebakan membuat galat 2 % tidak berarti. |
| D6 | Lesson berskala besar: L11 (UDCAM-S + Cyclic accumulation and optimisation tool, data kontur Drammen clay dari NGI), L18–L19 (modul thermal, THM, pembekuan) | Dikerjakan paling akhir (Phase 9) sebagai modul baru. Masing-masing butuh spec desain sendiri sebelum implementasi. | Masing-masing modul ini setara beberapa minggu kerja. Mengerjakannya di awal menunda semua hal lain. |
| D7 | L17 membutuhkan rekaman gempa `225a.smc` | File tidak ada di `plaxis2DSources`. User perlu menyediakannya. | Tanpa file itu L17 bagian gempa tidak bisa diverifikasi. |
| D8 | "Mirip PLAXIS" sejauh mana | Tata letak, nama mode/dialog/menu, urutan alur kerja, dan nama parameter mengikuti RM/TM. Ikon, logo, dan nama produk PLAXIS/Bentley **tidak** disalin. Ikon dibuat sendiri. | Menyalin trade dress membuka risiko hak cipta/merek. |
| D9 | Perilaku batas waktu 5 menit | Default `KATAI_SOLVE_TIMEOUT_S = 300`, dapat diubah per job. Saat habis: proses dihentikan, fase terakhir yang selesai tetap disimpan, job berstatus `timeout` dengan diagnosa. Batas ini dipakai selama pengembangan dan verifikasi. Untuk pemakaian produksi bisa dinaikkan. | Batas keras di produksi bisa memotong analisis konsolidasi panjang yang memang sah. |

---

## Global Constraints

- **Tidak ada fudge factor.** Hasil tidak boleh disesuaikan dengan mengubah parameter material, faktor koreksi, atau tolerance khusus per kasus agar cocok dengan PLAXIS. Selisih yang tersisa dijelaskan dengan mekanismenya (formulasi elemen, integrasi, kontrol langkah) dan dirujuk ke SM/RM.
- Semua test yang lulus sekarang tetap lulus: CTest (termasuk 136 ID di `docs/validation/verification-matrix.md`), `pytest web/server/test_app.py`, `tests/test_studies_presets.py`, `npm run build`.
- Perubahan format `.k2d` menaikkan versi (sekarang v29), dicatat di `docs/k2d-format.md` dan `docs/k2d.schema.json`, dan file lama tetap terbaca.
- Teks/gambar dari PDF PLAXIS tidak di-commit. Yang di-commit hanya data numerik turunan (CSV hasil digitasi, nilai referensi) dengan rujukan halaman.
- Satu solve pada satu waktu tetap dipertahankan (`job_lock` di `app.py`) kecuali ada keputusan lain.
- Kanvas: perilaku gambar, snap (`screenToWorld`), seleksi, zoom 0.25–8, pan, dan preview mesh tidak berubah. Dijaga oleh E2E sebelum dan sesudah refactor.

## Review Focus

- Kebenaran fisika di setiap fitur backend baru (rujukan SM/MMM per persamaan).
- Tidak ada aksi UI yang bisa memicu dua request backend bersamaan.
- Pesan validasi menunjuk ke field yang tepat dan bisa diklik.
- Laporan verifikasi bisa direproduksi dengan satu perintah.

---

## Ringkasan phase

| Phase | Isi | Bergantung pada | Perkiraan ukuran |
|---|---|---|---|
| 0 | Baseline, harness verifikasi, registry referensi | – | M |
| 1 | Refactor `App.tsx`, hapus example/preset dari UI | 0 | L |
| 2 | Sistem loader/freeze, batas waktu 5 menit, jendela progres | 1 | M |
| 3 | Shell Input bergaya PLAXIS | 1, 2 | XL |
| 4 | Validasi input mendetail | 3 | L |
| 5 | Program Output bergaya PLAXIS | 1, 2 | XL |
| 6 | Verifikasi gelombang A: lesson yang fiturnya sudah ada | 0, (3–5 untuk E2E UI) | L |
| 7 | Gap backend gelombang B: statik/flow (L4, L5, L6, L9, L12, L13, L14) | 6 | XL |
| 8 | Gap backend gelombang C: dinamik (L15, L16, L17) | 6 | L |
| 9 | Modul besar: thermal (L18, L19) dan UDCAM-S (L11) | 7, 8, D6 | XXL |
| 10 | Benchmark Berlin sand | 0, D5 | M |
| 11 | Protokol performa (berjalan paralel sejak Phase 0) | 2 | berkelanjutan |
| 12 | Penutupan: dokumentasi, CI, laporan akhir | semua | S |

Phase 3–5 (UI) dan Phase 6–8 (engine) bisa berjalan paralel setelah Phase 2 selesai, karena verifikasi engine memakai CLI langsung.

---

## Phase 0 — Baseline dan harness verifikasi

**Tujuan:** Punya alat ukur sebelum mengubah apa pun.

### Task 0.1: Baseline status dan waktu

- [ ] Jalankan CTest penuh, pytest server, `npm run build`, dan `npm run test:e2e`. Simpan hasil dan durasi per test ke `docs/validation/baseline-2026-11-05.md`.
- [ ] Jalankan `katai solve --timings` pada semua `tests/corpus/*.k2d` dan `tests/studies/*.k2d`. Catat waktu, jumlah elemen, jumlah langkah, dan jumlah iterasi. Kasus > 300 s masuk antrean Phase 11.

### Task 0.2: Registry referensi PLAXIS

**Files:** Create `tests/verification/plaxis/README.md`, `tests/verification/plaxis/registry.yaml`.

- [ ] Satu entri per lesson L1–L19 dan per figure benchmark. Isi: halaman sumber, besaran, satuan, nilai/berkas kurva, jenis (`scalar`, `curve`, `qualitative`), ketidakpastian sumber (`exact`, `approx`, `digitised u_dig=…`), dan fitur yang dibutuhkan.
- [ ] Isi awal nilai skalar yang tertulis di TM:

| Lesson | Besaran | Nilai TM | Halaman |
|---|---|---|---|
| L1 kasus A | Force-Y × 2π (rigid, uy = −0.05 m) | ≈ 588 kN | 28 |
| L1 kasus B | q·πR² (flexible, qy = −188 kPa) | ≈ 590 kN | 35 |
| L2 | FoS drained / undrained | 1.8 / 1.4 | 51 |
| L4 | FoS Ph7 / Ph8 | ≈ 1.33 / ≈ 1.83 | 90–91 |
| L7 | gaya angkur saat diaktifkan | 500 / 1000 kN (= prestress) | 137 |
| L9 | Pexcess setelah Ph4 | < 1.0 kPa | 158 |
| L9 | penurunan timbunan | "about one meter" (kualitatif) | 164 |
| L11 | Vcap statik / siklik | 228.1 MN / 174.14 MN; Neq = 6.001 | 176, 191 |
| L16 | penurunan tiang maks / akhir | ≈ 14 mm / ≈ 9.5 mm | 253–254 |
| L17 | frekuensi dominan | ≈ 1 Hz (kualitatif) | 269 |
| L18 | temperatur permukaan / dasar | 283.0 K / 283.4 K | 281 |

### Task 0.3: Alat digitasi dan ekstraksi kurva

**Files:** Create `scripts/verification/digitise.py`, `scripts/verification/extract_vector_curves.py`.

- [ ] `extract_vector_curves.py`: ekstrak polyline dari halaman PDF vektor (BM semua halaman figure, termasuk sampul) memakai `pymupdf.Page.get_drawings()`. Kalibrasi sumbu dari label tick (teks). Pisahkan kurva menurut warna/dash/marker. Keluaran CSV per kurva.
- [ ] `digitise.py`: digitasi semi-manual figure raster TM. Input: PNG halaman, 2 titik kalibrasi per sumbu, titik-titik kurva. Hitung `u_dig` dengan mendigitasi ulang 4 tick yang diketahui.
- [ ] Simpan CSV di `tests/verification/plaxis/<id>/ref_*.csv` dengan header metadata (sumber, halaman, figure, kalibrasi, `u_dig`).

### Task 0.4: Harness pembanding

**Files:** Create `scripts/verification/compare.py`, `scripts/verification/run_all.py`.

- [ ] `compare.py` menerapkan metrik D2 untuk kurva dan galat relatif untuk skalar. Keluaran JSON + plot PNG overlay (referensi vs katai) + tabel galat per titik.
- [ ] `run_all.py` membangun model setiap kasus dari skrip (bukan dari UI), menjalankan CLI dengan batas waktu 300 s, mengekstrak besaran lewat `katai results` atau API Python, lalu membandingkan. Status per kasus: `PASS`, `FAIL`, `TIMEOUT`, `BLOCKED (fitur belum ada)`, `UNDECIDABLE (u_dig)`.
- [ ] Laporan agregat `docs/validation/plaxis-parity-report.md` di-generate otomatis.
- [ ] Daftarkan sebagai CTest berlabel `plaxis` (EXCLUDE dari run default karena lama), plus `python scripts/verification/run_all.py --only L1`.

**Exit Phase 0:** baseline tercatat, registry terisi untuk 19 lesson dan BM, harness bisa menjalankan L1 dari skrip dan menghasilkan laporan.

---

## Phase 1 — Refactor client dan penghapusan example/preset

**Tujuan:** Memecah `web/client/src/App.tsx` supaya UI bergaya PLAXIS bisa dibangun tanpa merusak kanvas.

### Task 1.1: Jaring pengaman E2E untuk kanvas

- [ ] Tambah `e2e/canvas.spec.ts` yang menggambar dari proyek kosong: polygon tanah, garis struktur, beban, snap ke grid, seleksi, zoom roda mouse, pan tombol tengah, generate mesh, dan memeriksa jumlah node/elemen. Spec ini **tidak** memakai preset.

### Task 1.2: Ekstraksi modul tanpa perubahan perilaku

**Files (Create):**
- `src/state/projectStore.ts` (state proyek, undo/redo dari `setProjectSafe`/`moveHistory`)
- `src/api/client.ts` (`request()` + semua endpoint)
- `src/canvas/transform.ts` (`canvasTransform`, `worldToScreen`, `screenToWorld`, snap)
- `src/canvas/draw/*.ts` (`drawMesh`, kontur, panah, `drawLoads`, `drawBoundaryConditions`, diagram gaya struktur)
- `src/canvas/interaction.ts` (`canvasDown/Move/Up`, draft, hit test)
- `src/canvas/CanvasView.tsx`
- `src/editors/*` (`SoilMaterialEditor`, `StagePhaseEditor`, `MeshSettingsEditor`, `PolygonEdgeEditor`, `renderFields`)
- `src/output/*` (`outputGroups`, `getScalar`, `computeNodalStrains`, `LiveMonitorChart`)

- [ ] Pindahkan kode apa adanya. Commit per modul. Setelah setiap commit, `npm run build` dan `e2e/canvas.spec.ts` harus lulus.

### Task 1.3: Hapus example dan preset dari UI (D1)

- [ ] Hapus `import.meta.glob` corpus/studies, `corpusExamples`, `studyExamples`, `allPresets`, menu Studies dan Examples, item "Browse presets…" dan "Tutorial 1" di menu File, tombol Presets, modal preset, `loadExample`.
- [ ] Hapus `web/client/public/examples/` dan `web/examples/`. Pindahkan dua file tutorial 1 yang dipakai `web/server/test_app.py` (baris 202, 233, 277) ke `web/server/tests/fixtures/`.
- [ ] E2E: hapus `examples.spec.ts` dan `studies.spec.ts`. Ubah `tutorial.spec.ts` dan `inactive_excavation.spec.ts` agar membangun model lewat kanvas. `corpus.spec.ts` tetap (membangun ulang dari nilai fixture lewat UI, tidak lewat menu preset).
- [ ] Putuskan nasib `scripts/generate_studies_presets.py` sesuai D1 (default: tetap sebagai generator fixture).
- [ ] Pastikan `grep -r "corpus\|studies\|examples" web/client/src` tidak menyisakan referensi ke preset.

**Exit Phase 1:** `App.tsx` < 400 baris (hanya komposisi), semua E2E dan build lulus, tidak ada example/preset di UI.

---

## Phase 2 — Loader, freeze, batas waktu, dan jendela progres

**Tujuan:** Setiap proses backend memperlihatkan status dan mengunci UI. Proses lama dihentikan otomatis.

### Task 2.1: Busy manager di client

**Files:** Create `src/busy/BusyProvider.tsx`, `src/busy/BusyOverlay.tsx`.

- [ ] Satu sumber kebenaran `busy = {kind, label, startedAt, cancellable, jobId?}`. Semua panggilan backend lewat `runBusy(kind, fn)`: `save`, `validate`, `checkGeometry`, `mesh`, `calculate`, `loadResults`, `import`, `export`, `curves`, `crossSection`.
- [ ] Overlay menutup seluruh workspace: pointer, keyboard (termasuk shortcut undo/redo/delete), dan wheel diblokir. Isi overlay: spinner, label proses, waktu berjalan, tombol Stop bila `cancellable`.
- [ ] Ganti `isMeshing` lama dengan mekanisme ini. Pertahankan `data-testid="meshing-loader"` sebagai alias agar E2E lama tetap jalan.
- [ ] Debounce: klik ganda pada Calculate/Generate mesh tidak memicu dua request.

### Task 2.2: Batas waktu solve di server (D9)

**Files:** Modify `web/server/app.py`, `web/server/test_app.py`.

- [ ] Env `KATAI_SOLVE_TIMEOUT_S` (default 300) dan field opsional `timeout_s` pada `POST /api/projects/{pid}/jobs`.
- [ ] Worker memantau waktu. Saat habis: `terminate()`, lalu `kill()` setelah 10 s. Status job `timeout`. Simpan fase terakhir yang selesai. Kumpulkan diagnosa: fase berjalan, langkah, iterasi terakhir, global error, isi `progress.json` terakhir, 200 baris log terakhir.
- [ ] Endpoint `GET /api/jobs/{jid}/diagnostics`.
- [ ] Validate dan results: turunkan timeout `run_cli` dari 900 s ke 120 s dengan pesan yang jelas.
- [ ] Test pytest dengan CLI palsu yang tidur > timeout.

### Task 2.3: Jendela "Active tasks" bergaya PLAXIS (RM §7.13, hlm. 382–387)

- [ ] Jendela modal selama solve, berisi:
  - Tab per fase.
  - Kernel information (waktu mulai).
  - Multiplier total di akhir langkah sebelumnya (ΣMstage, ΣMsf, Pexcess,max, Time, dll. sejauh tersedia di `progress.json`).
  - Kurva progres (memakai ulang `LiveMonitorChart`: ΣMstage vs u untuk Plastic, ΣMsf vs u untuk Safety, Pexcess,max vs log t untuk Consolidation).
  - Iteration process (langkah, iterasi, global error, tolerance).
  - Plastic points per langkah (jika kernel melapor; jika belum, tambah ke `progress.json`).
  - Tombol **Stop**. Pause dan Preview tidak disediakan sampai kernel mendukung.
- [ ] Ikon status fase di Phases explorer (RM hlm. 304): akan dihitung, tidak dihitung, sukses, sukses dengan asumsi (warning), gagal, timeout.

**Exit Phase 2:** setiap aksi backend memperlihatkan overlay dan tidak bisa diklik ganda. Solve > 300 s berhenti dengan status `timeout` dan diagnosa. Test pytest dan E2E baru lulus.

---

## Phase 3 — Shell Input bergaya PLAXIS

**Tujuan:** Tata letak dan alur kerja mengikuti RM §3–§7 dan alur TM Lesson 1 dan 3.

### Task 3.1: Tata letak jendela utama (RM §3.2, Fig. 3–9)

- [ ] Title bar dengan tanda `*` untuk perubahan belum disimpan.
- [ ] Menu bar: File, Edit, Soil, Structures, Mesh, Flow conditions, Phases, Options, Help. Isi menu sesuai RM §3.3 sejauh fiturnya ada; item yang belum ada tidak ditampilkan.
- [ ] General toolbar: New, Open, Save, Undo/Redo, Project properties, tombol "Output".
- [ ] Tab mode: **Soil**, **Structures** (biru, mode geometri) | **Mesh**, **Flow conditions**, **Staged construction** (hijau, mode kalkulasi).
- [ ] Side toolbar per mode (RM §3.4, A.3). Tool kanvas yang sudah ada dipetakan ke tombol ini.
- [ ] Explorer kiri: **Selection explorer**, **Model explorer** (Attributes library, Stratigraphy, Geometry, Features, Model conditions), **Phases explorer** (mode kalkulasi).
- [ ] Panel bawah: **Session**/log (pengganti command line; command line skrip tidak termasuk scope).
- [ ] Status bar: koordinat kursor, toggle rulers, grid, snapping. Tombol **Snapping options** membuka jendela Snapping (Snap to object, Snap to grid, Spacing, Number of snap intervals).

### Task 3.2: Project properties (RM §3.1.1, hlm. 20–27)

- [ ] Tab **Project** (Title, Company, Comments), **Model** (Plane strain / Axisymmetry, 15-Noded / 6-Noded, satuan, Contour xmin/xmax/ymin/ymax), **Constants** (γw, gravitasi).
- [ ] Proyek baru langsung membuka jendela ini (seperti TM hlm. 12).

### Task 3.3: Borehole dan Modify soil layers (RM §4.2–4.3)

Fitur baru. Saat ini stratigrafi hanya lewat polygon.
- [ ] Tool **Create borehole**. Jendela **Modify soil layers**: kolom tanah, Add/Insert/Delete layer, tab Soil layers (Top, Bottom, material), Water (Head per borehole), Initial conditions (K0), Preconsolidation (OCR/POP).
- [ ] Generator: boreholes → polygon tanah dalam contour (interpolasi linear antar borehole seperti TM L6 dan L12). Hasilnya polygon biasa yang tetap bisa diedit di kanvas, jadi model mesh dan kernel tidak berubah.
- [ ] Head per borehole → garis freatik global (BoreholeWaterLevel).
- [ ] Peringatan dua borehole di posisi sama (RM hlm. 50).

### Task 3.4: Material sets (RM §6)

- [ ] Jendela **Material sets**: Set type (Soil and interfaces, Plates, Geogrids, Embedded beams, Anchors; tambahan Discontinuities dan Cables mengikuti Phase 7), daftar, tombol New/Edit/Copy/Delete. Drag material ke polygon atau ke kolom borehole.
- [ ] Jendela soil dengan tab **General** (model, drainage type, γunsat, γsat, einit, Rayleigh α/β), **Mechanical** (field per model sesuai MMM: MC, HS, HSsmall, SS, SSC, HB, MCC, NGI-ADP, JR, LE), **Groundwater** (kx, ky, ck, data set; Phase 7 menambah Hypres/USDA/Staring), **Interfaces** (Stiffness Derived/Direct → `iface_kn/ks`; Strength Rigid/Manual → `rinter_rigid/Rinter`; virtual thickness), **Initial** (K0 Automatic/Manual, OCR, POP).
- [ ] Panel **Feedback** (Errors/Warnings/Hints) di sisi jendela, diisi dari Phase 4.
- [ ] Jendela Plate (Elastic/Elastoplastic, w, EA, EI, ν, Mp, Np, Prevent punching), Anchor (EA, Ls, Fmax,tens, Fmax,comp), Geogrid, Embedded beam (Lspacing, D, E, skin dan base resistance, connection).
- [ ] Field digenerate dari `docs/k2d.schema.json` dan dikelompokkan per tab lewat metadata baru `x-plaxis-tab` dan `x-plaxis-label` di schema. Label memakai istilah PLAXIS (E50ref, Eoedref, Eurref, Rinter, …).

### Task 3.5: Mode Structures

- [ ] Klik kanan pada plate: Create positive interface / negative interface (TM hlm. 58).
- [ ] Fixed-end anchor dan node-to-node anchor sebagai tool terpisah (saat ini `kind` 1 dengan opsi).
- [ ] Selection explorer menampilkan properti objek terpilih (Material, Directionx/y, Equivalent length, qy,start,ref, u_y,start,ref).
- [ ] Create array (rectangular/polar) dan Check geometry (dari Phase 4).

### Task 3.6: Mode Mesh (RM §7.1)

- [ ] Jendela **Mesh options**: Element distribution Very coarse/Coarse/Medium/Fine/Very fine (re = 2.00/1.33/1.00/0.67/0.50), Expert: Relative element size, Enhanced mesh refinements. Petakan ke parameter mesher yang ada (`mesh.preset`, `elem_size`, `grading`, `corner_refine`).
- [ ] Coarseness factor per objek di Model explorer, dengan tombol Refine/Coarsen (× √2).
- [ ] Generate mesh dan View mesh (membuka Output pada tampilan mesh).
- [ ] Verifikasi: jumlah elemen untuk contour TM L1 dengan Medium berada di rentang PLAXIS (90–350 elemen, RM hlm. 299). Selisih jumlah elemen yang besar akan memengaruhi perbandingan di Phase 6.

### Task 3.7: Flow conditions (RM §7.10)

- [ ] Water levels: Borehole water levels, User water levels (Create water level).
- [ ] Kondisi air per polygon: Global level, Custom level, Head, Interpolate, Dry (petakan ke `pwater`/`pwlevel`/`dry`).
- [ ] Groundwater flow BC per tepi: Seepage, Closed, Head, Inflow (petakan ke `edge_flow`). Wells dan Drains.

### Task 3.8: Staged construction dan jendela Phases (RM §7.3, §7.9)

- [ ] Phases explorer dengan Add phase, Insert phase, Delete phase, Edit phase, Copy, dan Start from phase.
- [ ] Jendela **Phases** tiga panel:
  - **General**: ID, Start from phase, Calculation type (K0 procedure, Gravity loading, Plastic, Consolidation, Safety, Dynamic, Fully coupled flow-deformation, Flow only setelah Phase 7), Loading type (Staged construction, Incremental multipliers, Target ΣMsf, Minimum excess pore pressure, Degree of consolidation), ΣMstage, Time interval, Pore pressure calculation type (Phreatic, Use pressures from previous phase, Steady state groundwater flow, Transient).
  - **Deformation control parameters**: Ignore undrained behaviour, Reset displacements to zero, Reset small strain, Updated mesh (Phase 7), Ignore suction.
  - **Numerical control parameters**: Use default iter parameters, Max steps, Tolerated error, Max number of iterations, Desired min/max iterations, Arc-length control, Max load fraction per step, Max number of steps stored.
  - **Reached values** (ΣMstage, ΣMsf, Force-X/Y, waktu) setelah dihitung.
  - Log info for last calculation.
- [ ] Petakan setiap field ke parameter `.k2d` yang ada (`tol`, `maxiter`, `loadsteps`, `mstage`, `resetdisp`, `ignoreund`, `cstop`, …). Field PLAXIS yang belum punya padanan di kernel ditampilkan nonaktif dengan keterangan, atau ditambahkan di Phase 7/11.
- [ ] Klik kanan objek di kanvas: Activate/Deactivate (perilaku toggle yang sudah ada di `canvasDown`). Seleksi multi dengan rubber-band.
- [ ] **Select points for curves** sebelum Calculate (memakai monitor point yang ada, diperluas menjadi beberapa titik). Jika belum dipilih, tanya seperti RM hlm. 459.
- [ ] Mark/Unmark for calculation dan Calculate.

### Task 3.9: E2E alur PLAXIS

- [ ] `e2e/plaxis-flow-l1.spec.ts` dan `e2e/plaxis-flow-l3.spec.ts`: mengikuti langkah TM Lesson 1 (kasus A dan B) dan Lesson 3 dari proyek kosong lewat UI baru sampai Calculate, lalu memeriksa Reached values.

**Exit Phase 3:** L1 dan L3 bisa dibangun dari nol mengikuti urutan langkah TM, semua lewat UI baru, E2E lulus.

---

## Phase 4 — Validasi input mendetail

**Tujuan:** Model yang lolos validasi bisa dihitung. Setiap pesan menunjuk ke field dan bisa diklik.

### Task 4.1: Kontrak issue terstruktur

- [ ] `katai validate --json` mengeluarkan daftar `{severity: error|warning|hint, code, path, message}` (path JSON seperti `materials[2].Rf` sudah ada di `validate.hpp`).
- [ ] Endpoint validate mengembalikan JSON tersebut, tidak lagi stdout mentah.
- [ ] Client memetakan `path` ke dialog/tab/field (`materials[i].*` → Material sets, tab sesuai `x-plaxis-tab`; `phases[i].*` → jendela Phases; `structs[i]` → objek di kanvas). Klik pesan membuka dan menyorot field.

### Task 4.2: Validasi langsung di client

- [ ] Validasi tipe, rentang, dan field wajib dari `k2d.schema.json` saat mengetik (misalnya ν di [0, 0.5), 0 < Rinter ≤ 1, E > 0, Eurref > E50ref untuk HS).
- [ ] Aturan yang sama di server tetap menjadi otoritas. Test memastikan client dan server memberi hasil yang sama untuk sekumpulan kasus.

### Task 4.3: Check geometry (RM §5.1.4)

Pemeriksaan baru di kernel (`katai check-geometry --json`) atau di server Python:
- [ ] Titik dan garis yang berimpit atau hampir berimpit (toleransi 0.005 × diagonal model).
- [ ] Polygon yang saling tumpang tindih, polygon yang memotong dirinya sendiri, celah antar polygon tanah, area di contour yang tidak tertutup tanah.
- [ ] Struktur di luar tanah atau tidak terhubung ke tanah (anchor node-to-node yang ujungnya tidak di node, fixed-end anchor tanpa arah).
- [ ] Interface pada garis yang tidak berbatasan dengan tanah.
- [ ] Beban atau prescribed displacement di luar geometri.

### Task 4.4: Pemeriksaan sebelum Calculate (RM hlm. 382, App. H)

- [ ] Material belum ditetapkan pada polygon aktif (PLAXIS error 12/248).
- [ ] Mesh belum dibuat atau kedaluwarsa terhadap geometri (error 250; sekarang server re-mesh diam-diam, ganti dengan prompt).
- [ ] Cluster mengambang atau tumpuan kurang (risiko determinan nol, error 11/16): deteksi komponen terhubung pada mesh aktif per fase.
- [ ] Kombinasi tidak sah: model × drainage × tipe fase (misalnya NGI-ADP hanya Undrained C; Jointed rock hanya Drained/Non-porous; Dynamic tidak untuk axisymmetric; well tidak berlaku di consolidation, K2D-A009). Pindahkan dari "dicek engine saat solve" ke validator.
- [ ] Permeabilitas nol di fase flow (error 24). Rasio permeabilitas > 10⁵ (warning, RM hlm. 237).
- [ ] Urutan fase: parent belum dihitung, fase setelah perubahan geometri harus dihitung ulang dari Initial (RM hlm. 387).
- [ ] Safety phase tanpa parent plastic. ΣMstage < 1 di parent (warning 2).
- [ ] Kontras kekakuan elemen > 10⁶ (error 15).
- [ ] Mesh: elemen degenerasi, rasio aspek buruk (Mesh > Quality, warning tampil kuning).
- [ ] Peringatan inisial: K0 yang membuat titik tarik MC (warning 5), dikecek dengan K0 dan φ.

### Task 4.5: Feedback panel dan katalog pesan

- [ ] Panel Feedback di jendela material dan panel Messages global, dikelompokkan Errors (memblokir Calculate), Warnings, Hints.
- [ ] `docs/diagnostics.md` diperluas: setiap kode punya sebab, akibat, dan cara memperbaiki.
- [ ] Test: satu `.k2d` rusak per aturan di `tests/validator/*.k2d`, diperiksa oleh `tests/test_k2d_validator.cpp` dan pytest.

**Exit Phase 4:** semua aturan punya test. Model dengan 0 error di validator tidak gagal di solver karena masalah input (diuji pada semua model verifikasi Phase 6–8).

---

## Phase 5 — Program Output bergaya PLAXIS

**Tujuan:** Tampilan hasil mengikuti RM §8–§10.

### Task 5.1: Shell Output

- [ ] Rute `/output/:projectId` yang bisa dibuka di tab baru (seperti program Output terpisah), juga bisa dari tombol di Input.
- [ ] Menu: File (Export to file, Report), View (Legend settings, Scale, plot types), Project (Calculation information, Material information, Step info), Geometry (Phreatic level, Fixities), Mesh (Quality, Node numbers, Cluster borders), **Deformations**, **Stresses**, **Forces**, **Interface stresses**, Tools, Window.
- [ ] Drop-down fase/langkah dengan Ctrl-Up/Ctrl-Down (RM §8.4.9). Kernel perlu menyimpan langkah antara sesuai "Max number of steps stored" bila belum.
- [ ] Toolbar tipe tampilan: Contours, Shadings, Arrows, Principal directions, Deformed mesh, Distribution.

### Task 5.2: Besaran hasil

- [ ] Deformations: Deformed mesh, Total/Phase/Incremental displacements (|u|, ux, uy), total/incremental strains. Phase displacements butuh selisih antar fase dari kernel.
- [ ] Stresses: Cartesian dan principal effective/total, p_active/p_steady/p_excess, groundwater flow (|q|, head), **Plastic points** dengan simbol RM hlm. 442 (failure, tension cut-off, cap, cap+hardening, hardening). Jika status titik plastis belum disimpan di `.res`, tambahkan di `results_io.hpp`.
- [ ] Forces: N, Q, M plate; gaya angkur dan geogrid; hoop force axisymmetric; envelope.
- [ ] Interface stresses: σ'N, τ, τrel (sudah ada di `.res` v2).
- [ ] Legend settings (Automatic/Manual/Logarithmic, lock legend), hint box di posisi kursor (node: koordinat, u; stress point: tegangan, material).

### Task 5.3: Curves manager (RM ch. 10)

- [ ] Tab Charts, Curve points, Select points. Jendela Curve generation: sumbu x/y dari Project (ΣMstage, ΣMsf, Time, Step, Force-Y) atau dari titik (u, tegangan, regangan, p). Invert sign. Banyak kurva per chart.
- [ ] Data titik pra-kalkulasi menyimpan setiap langkah (perluasan monitor point yang ada).
- [ ] Ekspor CSV. Format CSV ini juga yang dipakai harness `compare.py`.

### Task 5.4: Cross section dan Tables

- [ ] **Cross section**: garis dua titik di kanvas, profil besaran yang aktif di sepanjang garis, langkah individual (TM L12 hlm. 202). Interpolasi dengan fungsi bentuk elemen, bukan rata-rata nodal.
- [ ] **Table**: tabel node/stress point/struktur dengan filter dan ekspor.
- [ ] Distance measurement (TM L5 kemiringan bangunan).

### Task 5.5: Ekspor laporan

- [ ] Ekspor PNG tampilan dan CSV tabel/kurva. Report generator RTF/PDF tidak termasuk scope awal.

**Exit Phase 5:** semua plot yang dipakai di figure TM L1–L10 bisa dibuat di Output, dan CSV kurva/cross section bisa diumpankan ke `compare.py`.

---

## Phase 6 — Verifikasi gelombang A (fitur sudah tersedia)

**Tujuan:** Verifikasi lesson yang fiturnya sudah ada di kernel. Setiap lesson: model dibangun dari skrip (`tests/verification/plaxis/Lxx/build.py`), dihitung lewat CLI dengan batas 300 s, dibandingkan dengan registry. Setelah UI siap, tambahkan E2E yang membangun model yang sama lewat UI dan memeriksa bahwa `.k2d` hasilnya identik dengan versi skrip.

| Lesson | Yang dibandingkan | Catatan risiko |
|---|---|---|
| L1 A/B | Force-Y × 2π ≈ 588 kN; q·πR² ≈ 590 kN; kurva ΣMstage–|u| Node (0,4) (Fig 1–27, digitasi) | Reaksi footing rigid sensitif terhadap kehalusan mesh di tepi footing. Gunakan Medium yang setara jumlah elemennya. |
| L2 | FoS 1.8 / 1.4; kurva ΣMsf–|u| (Fig 2–14) | FoS dari strength reduction tergantung kontrol langkah Msf (PLAXIS: increment 0.1, 100 langkah). |
| L3 | Kurva |u| titik A vs ΣMstage (Fig 3–15); M dan Q dinding (Fig 3–14, nilai maks pada plot); gaya strut (tabel) | Clay Undrained (A) dengan HS dan POP. |
| L7 | Gaya angkur = prestress saat diaktifkan (500/1000 kN); M dinding (Fig 7–22) | Grout body embedded beam + node-to-node anchor. Steady-state flow di Ph6 memakai `flowpore`. |
| L8 | ΣMsf–|u| fase ULS (Fig 8–6); ΣMsf > 1.0 | EC7 DA3 sudah ada (`design`). Faktor pada tan φ'. |
| L10 | Head dengan dan tanpa well (Fig 10–5); |q| (Fig 10–4) | Well extraction 1.5 m³/hari/m, hmin 17 m. |
| L9 tanpa updated mesh (Ph1–Ph12) | −Pexcess vs time di (0, −3) (Fig 9–17); efek drain (Fig 9–22); Pexcess < 1 kPa setelah Ph4; konsolidasi penuh > 50 hari | Soft Soil + ck. Ph13–16 menunggu updated mesh di Phase 7. |

- [ ] Satu task per lesson: build script → run → compare → laporan.
- [ ] Jika gagal 2 %: jalankan protokol investigasi (Phase 11, bagian B). Perbaikan engine masuk task tersendiri dengan test regresi baru di `verification-matrix.md` (ID KV baru, misalnya `KV-PLX-L01-A`).
- [ ] Kasus yang tetap gagal setelah investigasi dilaporkan beserta mekanismenya. Tidak boleh ditutup dengan penyesuaian parameter.

**Exit Phase 6:** setiap baris tabel di atas berstatus PASS, atau FAIL/UNDECIDABLE dengan analisis sebab yang terdokumentasi.

---

## Phase 7 — Gap backend gelombang B (statik dan aliran)

Setiap fitur: spec singkat (rujukan RM/SM/MMM per persamaan) → test unit dengan solusi analitik → field `.k2d` baru + schema + validator → UI → verifikasi lesson.

| Fitur | Lesson | Isi | Rujukan |
|---|---|---|---|
| Discontinuity (gap closure, peak strength) | L4 | Perluasan interface `kind` 4: material discontinuity dengan kn, ks langsung, c, φ, ψ, opsi Consider gap closure. Sebagian besar sudah ada (interface soil-soil, `iface_kn/ks`). | RM Discontinuities; MMM |
| Cable / rock bolt dengan bond | L4 | Elemen kabel elastoplastik dengan bond shear (cohesive strength, bond friction), tensile yield, prestress (Adjust prestress). Bisa diturunkan dari embedded beam yang ada. | RM §6 Cables |
| Tunnel designer (UI) | L5, L6, L19 | Circular dan Free shape (arc, line, Extend to symmetry axis, Symmetric close, subsection, intersect). Keluaran: chord plate + polygon cluster (kernel tidak berubah). | RM Tunnels |
| Pore pressure User-defined per cluster | L5 | WaterConditions User-defined pref (−230 kPa grouting). | RM §7.10 |
| Deconfinement (β-method) | L6 | ΣMstage parsial per cluster yang dinonaktifkan (60 %, lalu 100 %). Periksa apakah `mstage` yang ada cukup. | RM Deconfinement |
| Updated mesh + Updated water pressures | L9 Ph13–16 | Lagrangian terupdate (geometri diperbarui tiap langkah, Jaumann stress rate). Perubahan besar di kernel. | RM hlm. 323–324; SM |
| Flow only (fase steady/transient tanpa deformasi) | L12, L13, L19 | Tipe fase baru. Kernel sudah punya steady flow dan transient flow (`type` 3). Perlu tipe initial "Flow only". | RM §7.4 |
| Flow functions | L12, L13, L14 | Head function Harmonic (amplitudo, periode), Linear (sudah: `headramp`), Table. Discharge function Table untuk precipitation. | RM hlm. 142–146 |
| Precipitation / evaporation | L13 | Fluks permukaan bergantung waktu dengan ψmin dan ψmax. | RM Precipitation |
| Soil-water data sets | L7, L12, L13, L14 | Hypres, USDA, Staring, Standard (tabel parameter Van Genuchten). Kernel sudah punya Van Genuchten. Yang ditambah tabel data set dan pemilihan di UI. | RM hlm. 226–239 |
| Verifikasi aliran tak jenuh | L13 | Saat ini hanya batas jenuh yang terverifikasi (KV-STR-008). Perlu verifikasi tak jenuh dengan solusi Richards 1D. | SM §3 |
| Gravity loading + steady flow initial | L14 | Kemungkinan sudah ada. Verifikasi. | – |

Verifikasi lesson:
- L4: FoS ≈ 1.33 / ≈ 1.83 (Ph7/Ph8); N kabel (Fig 4–18).
- L5, L6: tidak ada angka di TM. Bandingkan figure N dan M lining (digitasi) dan kemiringan bangunan.
- L9 Ph13–16: uy vs time di (0, −3), updated mesh memberi penurunan lebih kecil (Fig 9–23).
- L12: p_active sepanjang cross section (Fig 12–10/11).
- L13: saturasi hari ke-15 (Fig 13–10).
- L14: p_active (Fig 14–15 s.d. 14–18) dan ΣMsf–u crest (Fig 14–19).

**Exit Phase 7:** fitur di atas lulus test unit. L4, L5, L6, L9 (lengkap), L12, L13, L14 diverifikasi sesuai Phase 6.

---

## Phase 8 — Gap backend gelombang C (dinamik)

| Fitur | Lesson | Isi |
|---|---|---|
| Dynamic loads pada titik/garis dengan dynamic multiplier | L15, L16, L17 | Saat ini hanya percepatan dasar. Tambah beban dinamik pada `loads[i]` dengan multiplier Harmonic (amplitudo, frekuensi, fase), Table, dan setengah siklus (L16). |
| Prescribed displacement dinamik dari sinyal | L17 | Base line displacement ux dengan table multiplier dari file `.smc` (Acceleration, Drift correction). Rekaman `Record` yang ada dipakai sebagai dasar. |
| Viscous boundaries per sisi | L15, L16 | Sudah ada sebagai Lysmer (`seisff`). Pastikan bisa dipilih per sisi (Xmax, Ymin). |
| Dynamic dalam axisymmetric | L15, L16 | Saat ini Dynamic hanya plane strain. L15 dan L16 axisymmetric, jadi ini wajib. |
| Rayleigh damping per material plate | L17 | Rayleigh α, β di material plate. |
| Free vibration | L17 | Fase dinamik setelah beban dilepas (mengikuti beban dinamik di atas). |
| Output Fourier spectrum dan kurva time history | L15, L17 | Di Curves manager (Phase 5). |

Verifikasi lesson:
- L15: uy vs t tanpa dan dengan redaman (Fig 15–9/10).
- L16: penurunan tiang maks ≈ 14 mm, akhir ≈ 9.5 mm (Fig 16–9).
- L17: ux vs t (Fig 17–14), frekuensi dominan ≈ 1 Hz, percepatan vs t (Fig 17–16, butuh `225a.smc`, D7).

Kriteria langkah waktu mengikuti SM §6.2 (Newmark α = 0.25, β = 0.5; batas Δt dari lmin dan Vs).

**Exit Phase 8:** L15, L16, L17 diverifikasi.

---

## Phase 9 — Modul besar (setelah konfirmasi D6)

### 9A: Thermal dan THM (L18, L19)

- [ ] Spec desain terpisah `docs/superpowers/specs/2026-xx-thermal-design.md` (SM §5).
- [ ] Material thermal (cs, λs, ρs, αs), konstanta thermal, BC thermal (Temperature, Closed, Convection), Climate.
- [ ] Earth gradient initial, steady-state thermal flow, transient thermal flow, Use temperatures from previous phase, Harmonic temperature function.
- [ ] Ekspansi termal pada tegangan (kopling TM) dan dalam Fully coupled.
- [ ] Pembekuan: kurva unfrozen water content, panas laten, perubahan permeabilitas (L19).
- [ ] Verifikasi: konduksi 1D analitik (erfc), Stefan problem untuk pembekuan, lalu L18 (283.0 K / 283.4 K; T vs waktu di (5, 0), Fig 18–14) dan L19 (T vs waktu di pusat terowongan, plato dekat 273 K, Fig 19–8).

### 9B: UDCAM-S dan Cyclic accumulation (L11)

- [ ] Spec desain terpisah. Butuh data kontur Drammen clay (Andersen) yang dipakai PLAXIS. Jika data tidak tersedia secara sah, L11 diblokir dan dilaporkan.
- [ ] Alat akumulasi siklik (Neq dari storm; TM hlm. 176: Neq = 6.001), optimasi parameter (Tabel 11–3, 11–4), model UDCAM-S dengan Undrained (C).
- [ ] Verifikasi: Vcap statik 228.1 MN dan siklik 174.14 MN, kurva Fig 11–15/16/17.

**Exit Phase 9:** L11, L18, L19 diverifikasi, atau diblokir dengan alasan yang terdokumentasi.

---

## Phase 10 — Benchmark Berlin sand (Schweiger 2002)

### Task 10.1: Model

- [ ] Geometri dan tahapan dari BM Fig. 1 dan hlm. 7–8:
  - Plane strain, dinding diafragma 0.8 m (E = 30·10⁶ kPa, ν = 0.15, γ = 24) sampai −32.00 m, wished-in-place, interface dengan friction φ/2.
  - Muka air −3.00 m, diturunkan ke −17.90 m di dalam galian.
  - Galian −4.80 / −9.30 / −14.35 / −16.80 m. Angkur di −4.30 / −8.80 / −13.85 m, kemiringan 27°, prestress 768 / 945 / 980 kN, jarak 2.30 / 1.35 / 1.35 m, A = 15 cm², E = 2.1·10⁸ kPa (EA/m dan prestress/m dihitung dari jarak; baris 1 = 334 kN/m sesuai Fig. 11).
  - Panjang bebas dan grout body dari Fig. 1 (label 23.3 / 19.8 / 23.8 m dan 8.0 m). Interpretasi ini dicatat dan dikonfirmasi ke Part II.
  - Hydraulic barrier −30.00 m tanpa fungsi struktural.
  - 8 tahap konstruksi sesuai BM hlm. 8.
- [ ] Parameter HS: dari Part II (D5). Tanpa Part II, tahap ini berhenti di model dan perbandingan rentang.

### Task 10.2: Referensi

- [ ] Ekstrak kurva vektor halaman sampul ("reference solution" defleksi dinding final stage dan first excavation stage; penurunan permukaan) dengan `extract_vector_curves.py`.
- [ ] Ekstrak Fig. 2–15 (B1–B17, "measurement (corrected)") sebagai data konteks.

### Task 10.3: Perbandingan

- [ ] Gate 2 % (metrik D2) terhadap kurva "reference solution": defleksi dinding tahap akhir dan tahap galian 1, penurunan permukaan tahap akhir.
- [ ] Varian sampul: Rinter 0.8 / 0.5 dan t_virt 0.01 (`iface_vt`), angkur −4 m / +8 m.
- [ ] Konteks (bukan gate): posisi hasil katai terhadap rentang B1–B17 untuk M dinding (Fig. 9), gaya angkur (Fig. 10, 11), dan terhadap pengukuran (Fig. 7).
- [ ] Gaya angkur baris 1 pada tahap 3 harus sama dengan prestress 334 kN/m (BM hlm. 19 mencatat beberapa peserta kehilangan prestress).

**Exit Phase 10:** laporan benchmark dengan overlay, tabel galat per titik, dan status gate.

---

## Phase 11 — Protokol performa (batas 5 menit)

Berjalan sejak Phase 0. Setiap kasus yang melebihi 300 s masuk antrean.

### A. Pengukuran

- [ ] `katai solve --timings` dan `KATAI_NL_PROFILE=1`: waktu per fase, per langkah, per iterasi, waktu assembly vs solve vs return mapping.
- [ ] Catat: jumlah elemen dan DOF, jumlah langkah (termasuk langkah yang dipecah hingga 512 bagian), iterasi per langkah, titik plastis, titik inaccurate, titik apex.

### B. Investigasi terhadap pengaturan numerik PLAXIS (RM §7.9.3–§7.9.4, SM §2.4, §9, App. B–C)

| Parameter | PLAXIS default | katai sekarang | Yang diperiksa |
|---|---|---|---|
| Tolerated error | 0.01 | MC 1·10⁻⁶, HS 1 %, linear 1·10⁻¹⁰ (`kernel/model/include/katai/model/project.hpp` baris 604) | Tolerance MC 10⁴ kali lebih ketat dari PLAXIS. Ukur dampaknya terhadap waktu dan terhadap galat hasil. Tolerance yang lebih longgar hanya diterima jika gate 2 % tetap terpenuhi. |
| Max iterations | 60 | `maxiter` | – |
| Desired min/max iterations | 6 / 15 (langkah digandakan atau dibagi dua) | langkah tetap `loadsteps` + cut-back | Kontrol langkah otomatis seperti PLAXIS bisa memangkas jumlah langkah. |
| Arc-length | on (Auto, aktif bila CSP < 0.5) | Riks setelah collapse (K2D-A040) | – |
| Max load fraction per step | 0.5 | – | – |
| Over-relaxation | 1.2 | – | Hanya relevan untuk metode initial stress. |
| Max steps | 1000 (Safety, Dynamic: 100) | – | – |
| Konsolidasi: first time step | critical time step (SM §4.4) | `cfirst` | Langkah terlalu kecil memperlambat dan tidak menambah akurasi (SM hlm. 22). |
| Jumlah elemen Medium | 90–350 | tergantung `elem_size` | Mesh yang jauh lebih halus dari PLAXIS memperlambat dan juga mengubah hasil pembanding. |

- [ ] Untuk setiap kasus lambat: hipotesis → eksperimen terkontrol (ubah satu parameter) → ukur waktu dan galat → keputusan. Catat di `docs/validation/performance-log.md`.
- [ ] Perbaikan algoritma (misalnya kontrol langkah otomatis 6/15, quasi-Newton sesuai SM App. C, line search) masuk sebagai task kernel dengan test regresi dan pengukuran waktu sebelum/sesudah.
- [ ] Semua kasus verifikasi selesai < 300 s di mesin referensi (catat spesifikasinya), atau dilaporkan dengan sebab dan usulan.

---

## Phase 12 — Penutupan

- [ ] `docs/validation/plaxis-parity-report.md` final: status setiap lesson L1–L19 dan benchmark (PASS / FAIL dengan sebab / BLOCKED dengan alasan / UNDECIDABLE), overlay kurva, tabel galat, waktu hitung.
- [ ] `docs/validation/verification-matrix.md` di-generate ulang dengan ID baru (`scripts/check_references.py --write`).
- [ ] `CHANGELOG.md`, `docs/k2d-format.md`, `docs/k2d.schema.json`, `web/README.md` diperbarui.
- [ ] CI: build, unit test, validator test, pytest, E2E cepat di setiap commit. Verifikasi PLAXIS penuh (label `plaxis`) dijalankan malam hari atau manual.

---

## Verification (per phase)

| Phase | Perintah | Kriteria |
|---|---|---|
| 0 | `python scripts/verification/run_all.py --only L1` | laporan ter-generate |
| 1–5 | `npm run build`; `npm run test:e2e`; `pytest web/server/test_app.py` | semua lulus |
| 4 | `ctest -R validator`; pytest validator | semua aturan punya test |
| 6–10 | `python scripts/verification/run_all.py` | status sesuai exit criteria tiap phase |
| semua | `ctest` (default), `git diff --check` | tidak ada regresi dari baseline |
