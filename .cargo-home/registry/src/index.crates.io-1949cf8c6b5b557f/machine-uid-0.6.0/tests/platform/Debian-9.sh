#!/bin/bash
##################
##   Debian 9  ##
##################

set -e

if [ ! -f "/etc/debian_version" ]; then
    echo "This Script only works in Debian."
    exit 1
fi

set -x

# install dep
apt update && apt install -y curl git gcc

# install Rust
curl https://sh.rustup.rs -sSf | sh
source $HOME/.cargo/env

# test project
git clone https://github.com/Hanaasagi/machine-id.git && cd machine-id/
rustup component add clippy-preview
cargo clippy --all-targets --all-features -- -D warnings
cargo test
