#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output_dir="$script_dir/../bin/linux"

cargo build --release --locked --manifest-path "$script_dir/Cargo.toml"
mkdir -p "$output_dir"
cp "$script_dir/target/release/outlink-proximity" "$output_dir/outlink-proximity"
chmod 755 "$output_dir/outlink-proximity"
