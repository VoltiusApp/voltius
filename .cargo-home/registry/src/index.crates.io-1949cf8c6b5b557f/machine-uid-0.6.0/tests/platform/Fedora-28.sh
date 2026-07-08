#!/bin/bash
##################
##  Fedora 28  ##
##################

set -e

release="$(cat /etc/os-release | grep NAME | head -1 | cut -d "=" -f2)"

if [ ! "$release" = "Fedora" ]; then
    echo "This Script only works in Fedora."
    exit 1
fi

set -x

# install dep
yum -y install curl git gcc

# install Rust
curl https://sh.rustup.rs -sSf | sh
source $HOME/.cargo/env

# test project
git clone https://github.com/Hanaasagi/machine-id.git && cd machine-id/
rustup component add clippy-preview
cargo clippy --all-targets --all-features -- -D warnings
cargo test
