#!/usr/bin/env bash
set -euo pipefail

REF_DIR="${REF_DIR:-../../cli}"
OUT_DIR="${OUT_DIR:-vendor/lark-cli}"
BIN_DIR="${OUT_DIR}/bin"
SKILLS_DIR="${OUT_DIR}/skills"

ALLOWED_SKILLS=(
  lark-shared
  lark-doc
  lark-task
  lark-drive
  lark-base
  lark-contact
  lark-im
)

if [ ! -d "${REF_DIR}" ]; then
  echo "Reference lark-cli repo not found: ${REF_DIR}" >&2
  exit 1
fi

mkdir -p "${BIN_DIR}" "${SKILLS_DIR}"

echo "[sync:lark-cli] building reference cli from ${REF_DIR}"
(
  cd "${REF_DIR}"
  if [ -x "./build.sh" ]; then
    ./build.sh
  else
    go build -o lark-cli .
  fi
)

TMP_BIN="${BIN_DIR}/lark-cli.tmp"
cp "${REF_DIR}/lark-cli" "${TMP_BIN}"
chmod 755 "${TMP_BIN}"
mv "${TMP_BIN}" "${BIN_DIR}/lark-cli"

rm -rf "${SKILLS_DIR}"
mkdir -p "${SKILLS_DIR}"

for skill in "${ALLOWED_SKILLS[@]}"; do
  src="${REF_DIR}/skills/${skill}"
  dst="${SKILLS_DIR}/${skill}"
  if [ ! -d "${src}" ]; then
    echo "Missing skill in reference repo: ${skill}" >&2
    exit 1
  fi
  cp -R "${src}" "${dst}"
done

echo "[sync:lark-cli] synced binary and ${#ALLOWED_SKILLS[@]} skills into ${OUT_DIR}"
