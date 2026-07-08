//! IV state tests.

use aes::*;
use cbc::{Decryptor, Encryptor};
use cipher::iv_state_test;

iv_state_test!(aes128_cbc_enc_iv_state, Encryptor<Aes128>, encrypt);
iv_state_test!(aes128_cbc_dec_iv_state, Decryptor<Aes128>, decrypt);
iv_state_test!(aes192_cbc_enc_iv_state, Encryptor<Aes192>, encrypt);
iv_state_test!(aes192_cbc_dec_iv_state, Decryptor<Aes192>, decrypt);
iv_state_test!(aes256_cbc_enc_iv_state, Encryptor<Aes256>, encrypt);
iv_state_test!(aes256_cbc_dec_iv_state, Decryptor<Aes256>, decrypt);
