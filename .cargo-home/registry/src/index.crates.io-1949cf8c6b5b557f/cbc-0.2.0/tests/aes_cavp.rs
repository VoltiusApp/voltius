//! Test vectors from CAVP "AES Multiblock Message Test (MMT) Sample Vectors":
//! <https://csrc.nist.gov/Projects/Cryptographic-Algorithm-Validation-Program/Block-Ciphers>
use aes::*;
use cbc::{Decryptor, Encryptor};
use cipher::block_mode_test;

block_mode_test!(aes128_cbc_enc, "aes128", Encryptor<Aes128>, encrypt);
block_mode_test!(aes192_cbc_enc, "aes192", Encryptor<Aes192>, encrypt);
block_mode_test!(aes256_cbc_enc, "aes256", Encryptor<Aes256>, encrypt);

block_mode_test!(aes128_cbc_dec, "aes128", Decryptor<Aes128>, decrypt);
block_mode_test!(aes192_cbc_dec, "aes192", Decryptor<Aes192>, decrypt);
block_mode_test!(aes256_cbc_dec, "aes256", Decryptor<Aes256>, decrypt);

block_mode_test!(aes128enc_cbc_enc, "aes128", Encryptor<Aes128Enc>, encrypt);
block_mode_test!(aes192enc_cbc_enc, "aes192", Encryptor<Aes192Enc>, encrypt);
block_mode_test!(aes256enc_cbc_enc, "aes256", Encryptor<Aes256Enc>, encrypt);

block_mode_test!(aes128dec_cbc_dec, "aes128", Decryptor<Aes128Dec>, decrypt);
block_mode_test!(aes192dec_cbc_dec, "aes192", Decryptor<Aes192Dec>, decrypt);
block_mode_test!(aes256dec_cbc_dec, "aes256", Decryptor<Aes256Dec>, decrypt);
