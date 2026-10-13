// Kondisi geologi: litologi & umur batuan (Peta Geologi Indonesia 1:100.000, Badan Geologi; cadangan Macrostrat),
// kerentanan likuefaksi, dan apa artinya bagi bahaya gempa/longsor/banjir.
import { esc, getJson, setCard, fakta, levelMaks } from './util.js';

// Kata kunci litologi -> karakter tanah dan implikasinya terhadap bahaya.
const KARAKTER = [
  { re: /alluv|aluv|endapan (pantai|sungai|rawa|danau)|swamp|rawa|beach|fluvial|delta|kipas/i,
    jenis: 'Endapan lepas muda (aluvium)', level: 'tinggi',
    implikasi: ['Guncangan gempa <b>diperkuat</b> (amplifikasi) pada tanah lunak.', 'Rawan <b>likuefaksi</b> bila jenuh air dan <b>banjir</b> di dataran rendah.', 'Penurunan muka tanah mungkin terjadi, terutama bila air tanah disedot berlebihan.'] },
  { re: /tuff|tufa|tuf\b|lahar|breccia|breksi|pyroclast|piroklas|volcanic|vulkan|gunung ?api|ash|abu/i,
    jenis: 'Batuan/endapan gunung api', level: 'sedang',
    implikasi: ['Tufa dan endapan lahar yang lapuk menjadi tanah tebal yang <b>mudah longsor</b> pada lereng saat hujan.', 'Endapan gunung api muda yang belum padu dapat memperkuat guncangan gempa.'] },
  { re: /limestone|gamping|kapur|karst|reef|terumbu|coral|koral/i,
    jenis: 'Batugamping (karst)', level: 'sedang',
    implikasi: ['Rongga bawah tanah dapat menyebabkan <b>amblesan</b> (sinkhole).', 'Air permukaan cepat meresap: rawan kekeringan, tetapi banjir kilat dapat terjadi di cekungan.'] },
  { re: /clay|lempung|shale|serpih|marl|napal|mudstone|batulumpur/i,
    jenis: 'Batuan lempung/napal', level: 'sedang',
    implikasi: ['Lempung <b>mengembang-menyusut</b> sehingga dinding dan lantai mudah retak.', 'Bidang lempung licin saat basah menjadi <b>bidang gelincir longsor</b>.'] },
  { re: /sandstone|batupasir|conglomerate|konglomerat/i,
    jenis: 'Batuan sedimen (batupasir/konglomerat)', level: 'rendah',
    implikasi: ['Relatif kompak; longsor terutama pada lereng terjal yang lapisannya searah lereng.'] },
  { re: /granit|diorit|andesit|basalt|gabro|intrusi|intrusive|lava|metamorf|schist|sekis|gneiss|ultramafi|ofiolit|ophiolit/i,
    jenis: 'Batuan beku/metamorf keras', level: 'rendah',
    implikasi: ['Fondasi kokoh dan guncangan gempa cenderung tidak diperkuat.', 'Pada lereng terjal dapat terjadi <b>jatuhan batu</b> bila batuan retak-retak.'] },
];

function interpretasi(teks) {
  return KARAKTER.find((k) => k.re.test(teks || '')) || null;
}

async function macrostrat(lat, lon) {
  const d = await getJson(`https://macrostrat.org/api/v2/geologic_units/map?lat=${lat}&lng=${lon}`);
  const u = d.success?.data?.[0];
  if (!u) return null;
  return { nama: u.name, litologi: u.lith, umur: `${u.b_int_name}${u.t_int_name && u.t_int_name !== u.b_int_name ? `–${u.t_int_name}` : ''}`, sumber: 'Macrostrat (peta geologi global, skala kasar)' };
}

export async function muatGeologi(ctx) {
  const { lat, lon } = ctx;
  let geo = null;
  try {
    geo = await ctx.geologi;
  } catch { /* server ESDM tidak tersedia, pakai Macrostrat */ }
  if (ctx.batal()) return null;

  let batuan = null;
  const lit = Array.isArray(geo?.litologi) ? geo.litologi[0] : null;
  if (lit) {
    batuan = {
      nama: lit.remark || lit.namobj,
      litologi: lit.namobj,
      kode: lit.simobj,
      umur: lit.umurobj,
      sumber: 'Peta Geologi Indonesia 1:100.000 (Badan Geologi, 2018)',
    };
  } else {
    batuan = await macrostrat(lat, lon).catch(() => null);
    if (ctx.batal()) return null;
  }
  if (!batuan) throw new Error('Data geologi tidak tersedia untuk titik ini');

  const kar = interpretasi(`${batuan.nama} ${batuan.litologi}`);
  const liq = Array.isArray(geo?.likuefaksi) ? geo.likuefaksi[0] : null;
  // Kelas Badan Geologi: 1 = tinggi (likuefaksi merata), 2 = menengah, 3 = rendah.
  const NAMA_LIQ = { 1: 'Tinggi', 2: 'Menengah', 3: 'Rendah' };
  const lvLiq = !liq ? '' : liq.kerentanan <= 1 ? 'bahaya' : liq.kerentanan <= 2 ? 'tinggi' : 'sedang';
  const level = levelMaks(kar?.level || 'rendah', lvLiq);
  const kuarter = /kuarter|quaternary|holosen|holocene|pleistosen|pleistocene/i.test(batuan.umur || '');

  let summary = `Lokasi berada di atas <b>${esc(batuan.nama)}</b>${batuan.kode ? ` (${esc(batuan.kode)})` : ''}, berumur <b>${esc(batuan.umur || '?')}</b>.`;
  if (kar) summary += ` Termasuk ${esc(kar.jenis.toLowerCase())}.`;
  if (kuarter && kar?.level !== 'rendah') summary += ' Batuan berumur Kuarter umumnya masih muda dan belum padu.';
  if (liq) summary += ` Lokasi berada di <b>zona kerentanan likuefaksi ${(NAMA_LIQ[Math.round(liq.kerentanan)] || '').toLowerCase()}</b>.`;

  setCard('card-geologi', {
    badge: { rendah: 'Stabil', sedang: 'Perlu perhatian', tinggi: 'Rentan', bahaya: 'Sangat rentan' }[level],
    level,
    radius: 'Titik lokasi',
    summary,
    detail: `
      <div class="facts">
        ${fakta('Satuan batuan', esc(batuan.nama), esc(batuan.litologi && batuan.litologi !== batuan.nama ? batuan.litologi : ''))}
        ${fakta('Umur', esc(batuan.umur || '—'))}
        ${fakta('Likuefaksi', liq ? (NAMA_LIQ[Math.round(liq.kerentanan)] || `Kelas ${liq.kerentanan}`) : 'Tidak dipetakan', liq ? 'Badan Geologi' : 'atau di luar zona rentan')}
        ${fakta('Jenis', kar ? esc(kar.jenis) : '—')}
      </div>
      ${kar ? `<ul class="tips">${kar.implikasi.map((i) => `<li>${i}</li>`).join('')}</ul>` : ''}
      ${liq?.keterangan ? `<p class="meta">${esc(liq.keterangan)}</p>` : ''}
      <p class="meta muted">Sumber: ${esc(batuan.sumber)}. Aktifkan lapisan <i>Geologi</i> atau <i>Kerentanan likuefaksi</i> di kontrol peta (kanan atas) untuk melihat sebarannya.</p>`,
  });

  return { level, batuan, karakter: kar, likuefaksi: liq, tanahLunak: kar?.level === 'tinggi' };
}
