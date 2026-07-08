//! IV state tests.

use aes::*;
use cfb8::{Decryptor, Encryptor};
use cipher::{BlockModeDecrypt, BlockModeEncrypt, IvState, KeyIvInit, SetIvState, iv_state_test};

iv_state_test!(aes128_cfb8_enc_iv_state, Encryptor<Aes128>, encrypt);
iv_state_test!(aes128_cfb8_dec_iv_state, Decryptor<Aes128>, decrypt);
iv_state_test!(aes192_cfb8_enc_iv_state, Encryptor<Aes192>, encrypt);
iv_state_test!(aes192_cfb8_dec_iv_state, Decryptor<Aes192>, decrypt);
iv_state_test!(aes256_cfb8_enc_iv_state, Encryptor<Aes256>, encrypt);
iv_state_test!(aes256_cfb8_dec_iv_state, Decryptor<Aes256>, decrypt);

#[test]
fn aes128_cfb8_encrypt_set_iv() {
    let key = Default::default();
    let iv = Default::default();
    let mut mode = Encryptor::<Aes128>::new(&key, &iv);

    let mut blocks = [Default::default(); 16];

    mode.encrypt_blocks(&mut blocks);
    let iv = mode.iv_state();

    let mut buf1 = blocks;
    let mut buf2 = blocks;

    mode.peek(|m| m.encrypt_blocks(&mut buf1));
    assert_eq!(mode.iv_state(), iv);

    mode.encrypt_blocks(&mut blocks);
    let iv2 = mode.iv_state();

    mode.set_iv(&iv);
    mode.encrypt_blocks(&mut buf2);

    assert_eq!(blocks, buf1);
    assert_eq!(blocks, buf2);
    assert_eq!(mode.iv_state(), iv2);
}

#[test]
fn aes128_cfb8_decrypt_set_iv() {
    let key = Default::default();
    let iv = Default::default();
    let mut mode = Decryptor::<Aes128>::new(&key, &iv);

    let mut blocks = [Default::default(); 16];

    mode.decrypt_blocks(&mut blocks);
    let iv = mode.iv_state();

    let mut buf1 = blocks;
    let mut buf2 = blocks;

    mode.peek(|m| m.decrypt_blocks(&mut buf1));
    assert_eq!(mode.iv_state(), iv);

    mode.decrypt_blocks(&mut blocks);
    let iv2 = mode.iv_state();

    mode.set_iv(&iv);
    mode.decrypt_blocks(&mut buf2);

    assert_eq!(blocks, buf1);
    assert_eq!(blocks, buf2);
    assert_eq!(mode.iv_state(), iv2);
}
