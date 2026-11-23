#!/bin/bash
# Rebuilds the tested Apple Silicon desktop addon in an isolated directory.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
if [[ $(uname -s)/$(uname -m) != Darwin/arm64 || $(node --version) != v22.22.0 || $# != 1 ]]; then
  printf 'Usage on Apple Silicon with Node 22.22.0: %s /absolute/path/to/openssl@3\n' "$0" >&2
  exit 1
fi
openssl_root=$1
[[ "$openssl_root" = /* && -f "$openssl_root/lib/libssl.a" && -f "$openssl_root/lib/libcrypto.a" ]]
node --input-type=commonjs - <<'NODE'
const assert = require('node:assert/strict');
assert.equal(require('./node_modules/node-datachannel/package.json').version, '0.33.6');
assert.equal(require('node-addon-api/package.json').version, '7.1.1');
NODE
mkdir -p .codex/scratch
scratch=$(mktemp -d "$root/.codex/scratch/mobile-rtc-addon.XXXXXXXX")
printf 'RTC build directory %s\n' "$scratch"
source="$scratch/libdatachannel"
git clone --depth 1 --branch v0.24.6 --recurse-submodules --shallow-submodules https://github.com/paullouisageneau/libdatachannel.git "$source" > "$scratch/source.log" 2>&1
[[ $(git -C "$source" rev-parse HEAD) == 6b1e2e620f1e37f0eafeee702eaea0043cb305fd ]]
[[ $(git -C "$source/deps/libjuice" rev-parse HEAD) == b89c792e3612faf2f12cf35bcc56857313a06be3 ]]
git -C "$source/deps/libjuice" apply "$root/packaging/rtc/libjuice-ice-role.patch"
addon="$scratch/addon"
build="$scratch/build"
mkdir -p "$addon/node_modules" "$build/_deps"
cp node_modules/node-datachannel/CMakeLists.txt "$addon/"
cp -R node_modules/node-datachannel/src "$addon/"
ln -s "$root/node_modules/node-addon-api" "$addon/node_modules/node-addon-api"
ln -s "$source" "$build/_deps/libdatachannel-src"
node --input-type=module - "$addon/src/cpp/rtc-wrapper.cpp" <<'NODE'
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
const file = process.argv[2];
const source = readFileSync(file, 'utf8');
const original = 'Napi::String::New(info.Env(), RTC_VERSION)';
assert.equal(source.split(original).length, 2);
writeFileSync(file, source.replace(original, 'Napi::String::New(info.Env(), RTC_VERSION "+homer-ice-role")'));
NODE
node_include=$(node -p 'require("node:path").resolve(process.execPath,"../../include/node")')
cmake -S "$addon" -B "$build" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=27.0 \
  -DCMAKE_POLICY_VERSION_MINIMUM=3.10 -DNO_EXAMPLES=ON -DNO_TESTS=ON \
  -DCMAKE_JS_INC="$node_include" '-DCMAKE_SHARED_LINKER_FLAGS=-undefined dynamic_lookup' \
  -DOPENSSL_ROOT_DIR="$openssl_root" -DFETCHCONTENT_SOURCE_DIR_LIBDATACHANNEL="$source" > "$scratch/configure.log" 2>&1
cmake --build "$build" --config Release --target node_datachannel --parallel 6 > "$scratch/build.log" 2>&1
node tests/mobile-ice-role.integration.mjs "$build/node_datachannel.node"
cp "$build/node_datachannel.node" "$scratch/node_datachannel.node"
shasum -a 256 "$scratch/node_datachannel.node"
