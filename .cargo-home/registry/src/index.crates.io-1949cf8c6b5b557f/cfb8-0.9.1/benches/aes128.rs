#![feature(test)]
#![allow(missing_docs)]
extern crate test;

cipher::block_encryptor_bench!(
    KeyIv: cfb8::Encryptor<aes::Aes128>,
    cfb8_aes128_encrypt_block,
    cfb8_aes128_encrypt_blocks,
);
cipher::block_decryptor_bench!(
    KeyIv: cfb8::Decryptor<aes::Aes128>,
    cfb8_aes128_decrypt_block,
    cfb8_aes128_decrypt_blocks,
);
