//! Tests for inherent methods.
use aes::*;
use cfb8::{Decryptor, Encryptor};
use cipher::KeyIvInit;

#[test]
fn aes128_cfb8_async_test() {
    type Enc = Encryptor<Aes128>;
    type Dec = Decryptor<Aes128>;

    let key = [42; 16];
    let iv = [24; 16];
    let mut pt = [0u8; 101];
    for (i, b) in pt.iter_mut().enumerate() {
        *b = u8::try_from(i % 11).unwrap();
    }
    let mut enc = Enc::new_from_slices(&key, &iv).unwrap();
    let mut ct = pt;
    enc.encrypt(&mut ct);
    for i in 1..100 {
        let mut enc = Enc::new_from_slices(&key, &iv).unwrap();
        let mut t = pt;
        let t = &mut t[..i];
        enc.encrypt(t);
        assert_eq!(t, &ct[..i]);

        let mut dec = Dec::new_from_slices(&key, &iv).unwrap();
        dec.decrypt(t);
        assert_eq!(t, &pt[..i]);
    }
}
