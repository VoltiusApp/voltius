//! Wycheproof test vectors.

use hkdf::{GenericHkdf, HmacImpl};
use hmac::{Hmac, SimpleHmac};

#[derive(Copy, Clone, Debug)]
struct TestVector {
    ikm: &'static [u8],
    salt: &'static [u8],
    info: &'static [u8],
    okm: &'static [u8],
}

fn test<H: HmacImpl>(test_vectors: &[TestVector]) {
    let mut buf = [0u8; 1 << 14];
    for (i, tv) in test_vectors.iter().enumerate() {
        let prk = GenericHkdf::<H>::new(Some(tv.salt), tv.ikm);
        let okm_dst = &mut buf[..tv.okm.len()];

        let mut err = None;
        if prk.expand(tv.info, okm_dst).is_err() {
            err = Some("prk expand");
        }
        if okm_dst != tv.okm {
            err = Some("mismatch in okm");
        }

        if let Some(err_desc) = err {
            panic!("Failed test #{i}: {err_desc}\nTest vector:\t{tv:#?}");
        }
    }
}

macro_rules! new_test {
    ($name:ident, $hash:ty) => {
        #[test]
        fn $name() {
            blobby::parse_into_structs!(
                include_bytes!(concat!("data/", stringify!($name), ".blb"));
                static TEST_VECTORS: &[TestVector { ikm, salt, info, okm }];
            );

            test::<Hmac<$hash>>(TEST_VECTORS);
            test::<SimpleHmac<$hash>>(TEST_VECTORS);
        }
    };
}

new_test!(wycheproof_sha1, sha1::Sha1);
new_test!(wycheproof_sha256, sha2::Sha256);
new_test!(wycheproof_sha384, sha2::Sha384);
new_test!(wycheproof_sha512, sha2::Sha512);
