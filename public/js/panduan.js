// Panduan menghadapi bencana (sebelum, saat, sesudah) yang tetap bisa dibaca tanpa internet.
// Mengacu panduan umum BNPB & BMKG. Teks dalam dua bahasa: [Indonesia, English].
import { esc, setCard } from './util.js';
import { renderIkon } from './ui.js';
import { tr, bahasa } from './bahasa.js';
import { bicara, hentikanBicara, bisaBicara } from './platform.js';

const S = (nama, ...isi) => ({ nama, isi });
const SEBELUM = ['Sebelum', 'Before'];
const SAAT = ['Saat terjadi', 'During'];
const SESUDAH = ['Sesudah', 'After'];

const PANDUAN = {
  gempa: {
    judul: ['Gempa bumi', 'Earthquake'], ikon: 'activity', warna: 'var(--red)',
    bagian: [
      S(SEBELUM,
        ['Kenali jalan keluar dan titik kumpul di rumah, sekolah, dan kantor.', 'Know the exits and assembly points at home, school, and work.'],
        ['Ikat lemari dan rak tinggi ke dinding. Letakkan barang berat di rak bawah.', 'Strap tall cabinets and shelves to the wall. Keep heavy items on low shelves.'],
        ['Ketahui cara mematikan listrik, gas, dan air.', 'Know how to shut off electricity, gas, and water.'],
        ['Siapkan Tas Siaga dan sepakati titik kumpul keluarga.', 'Prepare a go-bag and agree on a family meeting point.']),
      S(SAAT,
        ['<b>Merunduk, lindungi kepala, bertahan</b> di bawah meja kokoh. Jauhi kaca dan lemari.', '<b>Drop, cover, and hold on</b> under a sturdy table. Stay away from glass and cabinets.'],
        ['Jangan berlari keluar selama guncangan. Jangan memakai lift.', 'Do not run outside while shaking. Do not use elevators.'],
        ['Di luar: jauhi gedung, tiang listrik, pohon, dan papan reklame.', 'Outdoors: move away from buildings, power poles, trees, and billboards.'],
        ['Di kendaraan: menepi dan berhenti, jauh dari jembatan dan jalan layang. Tetap di dalam.', 'In a vehicle: pull over away from bridges and overpasses. Stay inside.']),
      S(SESUDAH,
        ['Keluar dengan tenang memakai alas kaki. Waspadai <b>gempa susulan</b>.', 'Leave calmly wearing shoes. Expect <b>aftershocks</b>.'],
        ['Di pesisir dan guncangan kuat atau lama (&gt; 20 detik)? <b>Segera ke tempat tinggi</b> tanpa menunggu peringatan.', 'On the coast and the shaking was strong or long (&gt; 20 s)? <b>Go to high ground now</b> without waiting for a warning.'],
        ['Tercium gas? Jangan menyalakan api atau saklar. Tutup katup gas, buka jendela.', 'Smell gas? Do not light flames or flip switches. Close the gas valve, open windows.'],
        ['Jangan masuk bangunan yang retak. Ikuti informasi BMKG dan BPBD.', 'Do not enter cracked buildings. Follow BMKG and local authority updates.']),
    ],
  },
  tsunami: {
    judul: ['Tsunami', 'Tsunami'], ikon: 'waves', warna: 'var(--blue)',
    bagian: [
      S(SEBELUM,
        ['Kenali tempat tinggi (≥ 20 m) atau gedung evakuasi terdekat, dan latih rutenya dengan jalan kaki.', 'Know the nearest high ground (≥ 20 m) or evacuation building and practise walking there.'],
        ['Tanda alam: guncangan kuat atau lama, <b>air laut surut tiba-tiba</b>, gemuruh dari laut.', 'Natural warnings: strong or long shaking, <b>sudden sea retreat</b>, a roar from the sea.']),
      S(SAAT,
        ['<b>Segera menjauhi pantai dan sungai</b> ke tempat tinggi, jalan kaki atau motor.', '<b>Move away from the beach and rivers</b> to high ground at once, on foot or motorbike.'],
        ['Jangan kembali untuk mengambil barang. Jangan menonton gelombang.', 'Do not go back for belongings. Do not watch the waves.'],
        ['Tidak sempat? Naik ke <b>lantai 3 atau lebih</b> gedung beton yang kokoh.', 'No time? Climb to the <b>3rd floor or higher</b> of a sturdy concrete building.'],
        ['Terseret air: raih benda yang mengapung.', 'Caught in water: grab something that floats.']),
      S(SESUDAH,
        ['Gelombang bisa datang <b>berkali-kali selama berjam-jam</b>. Jangan turun sampai BMKG menyatakan ancaman berakhir.', 'Waves can come <b>repeatedly for hours</b>. Stay up until BMKG declares the threat over.'],
        ['Jauhi genangan: kabel listrik, puing, dan arus balik berbahaya.', 'Avoid flood water: power lines, debris, and backflow are dangerous.']),
    ],
  },
  banjir: {
    judul: ['Banjir', 'Flood'], ikon: 'droplets', warna: 'var(--teal)',
    bagian: [
      S(SEBELUM,
        ['Simpan dokumen di tempat tinggi dalam wadah kedap air.', 'Keep documents high up in waterproof containers.'],
        ['Bersihkan saluran air. Ketahui jalan menuju tempat yang lebih tinggi.', 'Clear drains. Know your route to higher ground.']),
      S(SAAT,
        ['<b>Matikan listrik</b> dari sekring utama. Pindah ke tempat lebih tinggi.', '<b>Switch off power</b> at the main breaker. Move to higher ground.'],
        ['<b>Jangan menerjang arus.</b> Air setinggi 15 cm yang deras bisa menjatuhkan orang, 60 cm bisa menghanyutkan mobil.', '<b>Never walk or drive through moving water.</b> 15 cm of fast water can knock you down; 60 cm can sweep a car away.'],
        ['Jauhi kabel listrik, selokan, dan lubang got yang tertutup air.', 'Stay away from power lines, drains, and submerged manholes.']),
      S(SESUDAH,
        ['Periksa instalasi listrik sebelum menyalakan kembali.', 'Have wiring checked before switching power back on.'],
        ['Buang makanan yang terendam. Rebus air minum.', 'Throw away food that touched flood water. Boil drinking water.'],
        ['Pakai sepatu bot dan sarung tangan saat membersihkan (cegah leptospirosis).', 'Wear boots and gloves when cleaning up (prevents leptospirosis).']),
    ],
  },
  longsor: {
    judul: ['Tanah longsor', 'Landslide'], ikon: 'mountain', warna: 'var(--brown)',
    bagian: [
      S(SEBELUM,
        ['Kenali tanda: <b>retakan di lereng</b>, pohon atau tiang miring, rembesan air keruh tiba-tiba.', 'Know the signs: <b>cracks on slopes</b>, tilting trees or poles, sudden muddy seepage.'],
        ['Hindari tinggal tepat di bawah atau di tepi tebing.', 'Avoid living directly below or at the edge of a cliff.']),
      S(SAAT,
        ['Hujan deras berjam-jam di daerah lereng: siap mengungsi.', 'Hours of heavy rain on a hillside: be ready to evacuate.'],
        ['Terdengar gemuruh atau pohon tumbang? <b>Lari menjauh ke samping</b>, bukan searah aliran longsor.', 'Hear rumbling or falling trees? <b>Run sideways away</b>, not in the slide\'s path.']),
      S(SESUDAH,
        ['Jauhi area longsor: longsor susulan sering terjadi.', 'Stay away from the slide area: secondary slides are common.'],
        ['Laporkan orang yang tertimbun ke 112. Jangan menggali sendiri di tanah yang labil.', 'Report buried people to 112. Do not dig alone on unstable ground.']),
    ],
  },
  gunung: {
    judul: ['Gunung api', 'Volcano'], ikon: 'triangle', warna: 'var(--orange)',
    bagian: [
      S(SEBELUM,
        ['Ketahui status gunung (Normal, Waspada, Siaga, Awas) dan radius larangan dari PVMBG.', 'Know the volcano alert level (Normal, Advisory, Watch, Warning) and exclusion radius from PVMBG.'],
        ['Siapkan masker N95 dan kacamata pelindung.', 'Keep N95 masks and protective goggles ready.']),
      S(SAAT,
        ['<b>Patuhi perintah evakuasi.</b> Jauhi lembah sungai yang berhulu di gunung (lahar dan awan panas).', '<b>Follow evacuation orders.</b> Avoid river valleys that start on the volcano (lahars and pyroclastic flows).'],
        ['Hujan abu: tetap di dalam, tutup jendela, pakai masker dan kacamata.', 'Ash fall: stay indoors, close windows, wear a mask and goggles.'],
        ['Berkendara pelan: abu membuat jalan licin dan pandangan terbatas.', 'Drive slowly: ash makes roads slippery and reduces visibility.']),
      S(SESUDAH,
        ['Bersihkan abu dari atap. Abu basah sangat berat dan bisa meruntuhkan atap.', 'Clear ash from roofs. Wet ash is very heavy and can collapse roofs.'],
        ['Waspadai lahar bila hujan di puncak.', 'Watch for lahars when it rains on the summit.']),
    ],
  },
  kebakaran: {
    judul: ['Kebakaran & asap', 'Fire & haze'], ikon: 'flame', warna: 'var(--red)',
    bagian: [
      S(SEBELUM,
        ['Bersihkan daun dan ranting kering di sekitar rumah. Jangan membakar lahan atau sampah.', 'Clear dry leaves and branches around the house. Never burn land or rubbish.']),
      S(SAAT,
        ['Asap tebal: kurangi kegiatan di luar, pakai <b>masker N95</b>, tutup jendela.', 'Thick haze: limit outdoor activity, wear an <b>N95 mask</b>, close windows.'],
        ['Lindungi anak, lansia, ibu hamil, dan penderita asma lebih dulu.', 'Protect children, the elderly, pregnant women, and people with asthma first.'],
        ['Api mendekat: mengungsi ke arah yang <b>berlawanan dengan arah angin</b>.', 'Fire approaching: evacuate <b>upwind</b>, away from the direction it is spreading.']),
      S(SESUDAH,
        ['Sesak napas atau batuk berkepanjangan: segera ke fasilitas kesehatan.', 'Shortness of breath or persistent cough: see a doctor promptly.']),
    ],
  },
  cuaca: {
    judul: ['Cuaca ekstrem', 'Severe weather'], ikon: 'cloud-lightning', warna: 'var(--indigo)',
    bagian: [
      S(SAAT,
        ['Angin kencang / puting beliung: masuk bangunan kokoh, jauhi jendela.', 'Strong wind / tornado: get inside a sturdy building, away from windows.'],
        ['Jauhi pohon besar, baliho, dan tiang listrik.', 'Stay away from large trees, billboards, and power poles.'],
        ['Petir: hindari tempat terbuka dan air. Jangan berteduh di bawah pohon yang berdiri sendiri.', 'Lightning: avoid open ground and water. Never shelter under a lone tree.'],
        ['Hujan lebat berjam-jam bisa memicu banjir dan longsor. Pantau peringatan dini BMKG.', 'Hours of heavy rain can trigger floods and landslides. Watch BMKG early warnings.']),
    ],
  },
};

let terpilih = 'gempa';

const bi = ([id, en]) => tr(id, en);
const polos = (html) => html.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&lt;/g, '<');

function render() {
  const p = PANDUAN[terpilih];
  setCard('card-panduan', {
    badge: tr('Offline', 'Offline'),
    level: '',
    summary: tr('Pilih jenis bencana. Panduan ini tersimpan di aplikasi dan bisa dibaca tanpa internet.', 'Choose a hazard. These guides are stored in the app and work without internet.'),
    detail: `
      <div class="pd-pilih" role="tablist">${Object.entries(PANDUAN).map(([id, x]) => `
        <button type="button" role="tab" aria-selected="${id === terpilih}" data-panduan="${id}" style="--c:${x.warna}"><i data-lucide="${x.ikon}"></i>${esc(bi(x.judul))}</button>`).join('')}
      </div>
      ${bisaBicara() ? `<button type="button" class="btn-coba" data-panduan-bacakan><i data-lucide="volume-2"></i>${tr('Bacakan', 'Read aloud')}</button>` : ''}
      ${p.bagian.map((b) => `
        <h3 class="sub">${esc(bi(b.nama))}</h3>
        <ul class="tips pd-isi">${b.isi.map((x) => `<li>${bi(x)}</li>`).join('')}</ul>`).join('')}
      <p class="meta" style="margin-top:14px">${tr('Darurat: <b>112</b>. Ikuti arahan BMKG, PVMBG, dan BPBD setempat.', 'Emergency: <b>112</b>. Follow BMKG, PVMBG, and local authority instructions.')}</p>`,
  });
  renderIkon(document.getElementById('card-panduan'));
}

/** Buka halaman panduan untuk bencana tertentu (dipakai mode darurat & peringatan). */
export function pilihPanduan(id) {
  if (PANDUAN[id]) terpilih = id;
  render();
}

export function pasangPanduan() {
  const card = document.getElementById('card-panduan');
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-panduan]');
    if (b) {
      hentikanBicara();
      terpilih = b.dataset.panduan;
      return render();
    }
    if (e.target.closest('[data-panduan-bacakan]')) {
      const p = PANDUAN[terpilih];
      bicara(`${bi(p.judul)}. ${p.bagian.map((x) => `${bi(x.nama)}. ${x.isi.map((i) => polos(bi(i))).join(' ')}`).join(' ')}`, bahasa());
    }
  });
  render();
}
