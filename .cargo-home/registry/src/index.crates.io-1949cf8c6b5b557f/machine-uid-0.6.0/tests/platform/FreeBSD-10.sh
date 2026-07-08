#!/bin/bash
##################
## FreeBSD 10.4 ##
##################

set -e

if [ ! "$(uname -s)" = "FreeBSD" ]; then
    echo "This Script only works in FreeBSD."
    exit 1
fi

set -x

# install dep
pkg update && pkg install -y curl git gcc

# install Rust
curl https://sh.rustup.rs -sSf | sh
source $HOME/.cargo/env

# test project
git clone https://github.com/Hanaasagi/machine-id.git && cd machine-id/
rustup component add clippy-preview
cargo clippy --all-targets --all-features -- -D warnings
cargo test
