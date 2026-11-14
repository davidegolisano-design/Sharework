#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ANDROID_JAR:?Set ANDROID_JAR to an Android 34 platform jar}"
: "${ANDROID_BUILD_TOOLS:?Set ANDROID_BUILD_TOOLS to the build-tools directory}"
: "${SHAREWORK_KEYSTORE:?Set SHAREWORK_KEYSTORE to the release keystore}"
: "${SHAREWORK_STORE_PASSWORD:?Set SHAREWORK_STORE_PASSWORD}"
output="${1:-dist/Sharework-Android-v10.apk}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/res/drawable-nodpi" "$work/classes" "$(dirname "$output")"
cp src/icons/icon-512.png "$work/res/drawable-nodpi/sharework.png"
"$ANDROID_BUILD_TOOLS/aapt2" compile --dir "$work/res" -o "$work/res.zip"
"$ANDROID_BUILD_TOOLS/aapt2" link --manifest android/AndroidManifest.xml -I "$ANDROID_JAR" -o "$work/unsigned.apk" "$work/res.zip"
if [[ -n "${ANDROID_ECJ_JAR:-}" ]]; then
 java -jar "$ANDROID_ECJ_JAR" -8 -nowarn -proc:none -classpath "$ANDROID_JAR" -d "$work/classes" android/src/it/sgdp/sharework/ShareworkActivity.java
else
 javac -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$work/classes" android/src/it/sgdp/sharework/ShareworkActivity.java
fi
mapfile -t classes < <(find "$work/classes" -name '*.class')
"$ANDROID_BUILD_TOOLS/d8" --min-api 26 --lib "$ANDROID_JAR" --output "$work" "${classes[@]}"
(cd "$work" && zip -q unsigned.apk classes.dex)
"$ANDROID_BUILD_TOOLS/zipalign" -f 4 "$work/unsigned.apk" "$work/aligned.apk"
"$ANDROID_BUILD_TOOLS/apksigner" sign --v4-signing-enabled false --ks "$SHAREWORK_KEYSTORE" --ks-pass env:SHAREWORK_STORE_PASSWORD --out "$output" "$work/aligned.apk"
"$ANDROID_BUILD_TOOLS/apksigner" verify --verbose "$output"
