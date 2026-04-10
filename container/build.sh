#!/bin/bash
# Build the NanoClaw agent container image
#
# Usage:
#   ./build.sh [tag] [--cn-mirror]
#   NANOCLAW_APT_CN=1 ./build.sh
#   APT_MIRROR_DEBIAN=... APT_MIRROR_SECURITY=... ./build.sh
#
# Without mirrors, apt uses deb.debian.org (often very slow in China).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

IMAGE_NAME="nanoclaw-agent"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
CN_MIRROR=0
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    --cn-mirror|--china|--mirror-cn) CN_MIRROR=1 ;;
    -h|--help)
      echo "Usage: $0 [tag] [--cn-mirror]"
      echo "  --cn-mirror   CN apt (Aliyun http) + npm (npmmirror); override with APT_* / NPM_CONFIG_REGISTRY"
      echo "  NANOCLAW_APT_CN=1  same as --cn-mirror"
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

if [ "${#POSITIONAL[@]}" -gt 1 ]; then
  echo "Too many arguments: only one image tag allowed (got: ${POSITIONAL[*]})" >&2
  exit 1
fi

TAG="${POSITIONAL[0]:-latest}"

if [ "${NANOCLAW_APT_CN:-0}" = "1" ] || [ "${NANOCLAW_APT_CN:-}" = "true" ]; then
  CN_MIRROR=1
fi

# Default Aliyun when CN mirror requested and URLs not overridden.
# Use http:// by default: HTTPS to mirrors can fail behind corporate MITM even with ca-certificates.
# Prefer TLS: APT_MIRROR_DEBIAN=https://mirrors.aliyun.com/debian ./build.sh --cn-mirror
if [ "$CN_MIRROR" = "1" ]; then
  export APT_MIRROR_DEBIAN="${APT_MIRROR_DEBIAN:-http://mirrors.aliyun.com/debian}"
  export APT_MIRROR_SECURITY="${APT_MIRROR_SECURITY:-http://mirrors.aliyun.com/debian-security}"
  export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmmirror.com}"
  echo "Using CN apt mirrors: $APT_MIRROR_DEBIAN"
  echo "Using npm registry: $NPM_CONFIG_REGISTRY"
else
  if [ -z "${APT_MIRROR_DEBIAN:-}" ] && [ -z "${APT_MIRROR_SECURITY:-}" ]; then
    echo "Tip: apt is slow? Use: ./build.sh ${TAG} --cn-mirror   (or NANOCLAW_APT_CN=1)"
  fi
fi

echo "Building NanoClaw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

BUILD_ARGS=()
if [ -n "${APT_MIRROR_DEBIAN:-}" ]; then
  BUILD_ARGS+=(--build-arg "APT_MIRROR_DEBIAN=${APT_MIRROR_DEBIAN}")
fi
if [ -n "${APT_MIRROR_SECURITY:-}" ]; then
  BUILD_ARGS+=(--build-arg "APT_MIRROR_SECURITY=${APT_MIRROR_SECURITY}")
fi
if [ -n "${NPM_CONFIG_REGISTRY:-}" ]; then
  BUILD_ARGS+=(--build-arg "NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}")
fi

DOCKER_BUILDKIT=1 ${CONTAINER_RUNTIME} build "${BUILD_ARGS[@]}" -t "${IMAGE_NAME}:${TAG}" .

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"
echo ""
echo "Test with:"
echo "  echo '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | ${CONTAINER_RUNTIME} run -i ${IMAGE_NAME}:${TAG}"
