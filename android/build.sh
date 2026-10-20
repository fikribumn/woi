#!/usr/bin/env bash
# Membangun APK TERRA WOI tanpa Gradle: aapt2 (resource) → javac → d8/dx (dex) → zipalign → apksigner.
# Halaman web (public/) disalin apa adanya ke assets/www.
#
# Pemakaian:   android/build.sh            → android/build/terra-woi-<versi>.apk (ditandatangani kunci rilis)
# Kebutuhan:   JDK 17+, dan salah satu:
#   - Android SDK (ANDROID_HOME) dengan build-tools & platforms/android-35, atau
#   - paket Ubuntu/Debian: apt install android-sdk-build-tools apksigner zipalign
#     (android.jar API 35 diunduh otomatis bila tidak ditemukan)
# Variabel opsional:
#   ANDROID_JAR    path android.jar (API 35)
#   RES_JAR        android.jar untuk link resource; bawaan sama dengan ANDROID_JAR, kecuali aapt2 terlalu lama
#                  untuk membacanya (mis. aapt2 paket Debian), maka API 34 diunduh dan dipakai
#   BUILD_TOOLS    folder berisi aapt2, zipalign, apksigner, d8/dx
#   KEYSTORE       keystore rilis (bawaan: android/keystore/terra-woi.jks, dibuat otomatis bila belum ada)
#   KS_PASS        kata sandi keystore (bawaan: dibaca dari android/keystore/kata-sandi.txt)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$DIR")"
OUT="$DIR/build"
MIN_SDK=24
TARGET_SDK=35

# ---------- Alat ----------
if [[ -z "${BUILD_TOOLS:-}" ]]; then
  if [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/build-tools" ]]; then
    BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"
  elif [[ -d /usr/lib/android-sdk/build-tools/debian ]]; then
    BUILD_TOOLS=/usr/lib/android-sdk/build-tools/debian
  else
    echo "Build-tools Android tidak ditemukan. Set ANDROID_HOME atau BUILD_TOOLS." >&2
    exit 1
  fi
fi
alat() { if [[ -x "$BUILD_TOOLS/$1" ]]; then echo "$BUILD_TOOLS/$1"; else command -v "$1" || true; fi; }
AAPT2="$(alat aapt2)"; ZIPALIGN="$(alat zipalign)"; APKSIGNER="$(alat apksigner)"; D8="$(alat d8)"; DX="$(alat dx)"
for a in AAPT2 ZIPALIGN APKSIGNER; do [[ -n "${!a}" ]] || { echo "$a tidak ditemukan di $BUILD_TOOLS" >&2; exit 1; }; done
[[ -n "$D8$DX" ]] || { echo "d8/dx tidak ditemukan di $BUILD_TOOLS" >&2; exit 1; }

unduh_jar() { # $1 = level API; mencetak path android.jar (diunduh sekali ke android/.sdk)
  local jar="$DIR/.sdk/android-$1.jar"
  if [[ ! -f "$jar" ]]; then
    echo "• Mengunduh android.jar API $1…" >&2
    mkdir -p "$DIR/.sdk"
    curl -fsSL -o "$jar.tmp" "https://raw.githubusercontent.com/Sable/android-platforms/master/android-$1/android.jar"
    mv "$jar.tmp" "$jar"
  fi
  echo "$jar"
}
if [[ -z "${ANDROID_JAR:-}" ]]; then
  ANDROID_JAR="${ANDROID_HOME:-/nonexistent}/platforms/android-$TARGET_SDK/android.jar"
  [[ -f "$ANDROID_JAR" ]] || ANDROID_JAR="$(unduh_jar "$TARGET_SDK")"
fi
if [[ -z "${RES_JAR:-}" ]]; then
  RES_JAR="$ANDROID_JAR"
  "$AAPT2" dump packagename "$RES_JAR" >/dev/null 2>&1 || RES_JAR="$(unduh_jar 34)"
fi

VERSI="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$DIR/AndroidManifest.xml")"
echo "• TERRA WOI $VERSI  (build-tools: $BUILD_TOOLS)"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/assets"

# ---------- Resource & aset ----------
echo "• Resource"
"$AAPT2" compile --dir "$DIR/res" -o "$OUT/res.zip"
cp -r "$ROOT/public" "$OUT/assets/www"
"$AAPT2" link -I "$RES_JAR" \
  --manifest "$DIR/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  -A "$OUT/assets" --java "$OUT/gen" \
  -o "$OUT/dasar.apk" "$OUT/res.zip"

# ---------- Kode ----------
echo "• Kompilasi Java"
find "$DIR/src" "$OUT/gen" -name '*.java' > "$OUT/sumber.txt"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sumber.txt"
echo "• Dex"
if [[ -n "$D8" ]]; then
  "$D8" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
else
  "$DX" --dex --min-sdk-version="$MIN_SDK" --output="$OUT/dex/classes.dex" "$OUT/classes"
fi

# ---------- Paket & tanda tangan ----------
echo "• Paket"
cp "$OUT/dasar.apk" "$OUT/belum-tertanda.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/belum-tertanda.apk" classes.dex)
"$ZIPALIGN" -f -p 4 "$OUT/belum-tertanda.apk" "$OUT/rata.apk"

KEYSTORE="${KEYSTORE:-$DIR/keystore/terra-woi.jks}"
if [[ ! -f "$KEYSTORE" ]]; then
  echo "• Membuat keystore rilis baru: $KEYSTORE"
  echo "  SIMPAN keystore & kata sandinya: pembaruan APK harus ditandatangani dengan kunci yang sama."
  mkdir -p "$(dirname "$KEYSTORE")"
  KS_PASS="${KS_PASS:-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')}"
  printf '%s\n' "$KS_PASS" > "$(dirname "$KEYSTORE")/kata-sandi.txt"
  keytool -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias terra-woi -keyalg RSA -keysize 4096 \
    -validity 10000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=TERRA WOI, O=TERRA WOI, C=ID" >/dev/null 2>&1
fi
export KS_PASS="${KS_PASS:-$(cat "$(dirname "$KEYSTORE")/kata-sandi.txt")}"

APK="$OUT/terra-woi-$VERSI.apk"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias terra-woi --ks-pass env:KS_PASS --key-pass env:KS_PASS \
  --min-sdk-version "$MIN_SDK" --out "$APK" "$OUT/rata.apk"
"$APKSIGNER" verify --min-sdk-version "$MIN_SDK" "$APK"
rm -f "$OUT/belum-tertanda.apk" "$OUT/rata.apk" "$OUT/dasar.apk" "$APK.idsig"
echo "✓ $APK ($(du -h "$APK" | cut -f1))"
