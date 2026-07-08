#![feature(test)]
#![allow(missing_docs)]
extern crate test;

cipher::block_encryptor_bench!(
    KeyIv: cbc::Encryptor<aes::Aes128>,
    cbc_aes128_encrypt_block,
    cbc_aes128_encrypt_blocks,
);
cipher::block_decryptor_bench!(
    KeyIv: cbc::Decryptor<aes::Aes128>,
    cbc_aes128_decrypt_block,
    cbc_aes128_decrypt_blocks,
);
