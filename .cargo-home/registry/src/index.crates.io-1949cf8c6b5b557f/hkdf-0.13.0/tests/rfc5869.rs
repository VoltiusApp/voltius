//! Test vectors from <https://tools.ietf.org/html/rfc5869>.
#![allow(clippy::unwrap_used, reason = "tests")]

use hkdf::{GenericHkdf, HmacImpl};
use hmac::{Hmac, SimpleHmac};

#[derive(Copy, Clone, Debug)]
struct TestVector {
    ikm: &'static [u8],
    salt: &'static [u8],
    info: &'static [u8],
    prk: &'static [u8],
    okm: &'static [u8],
}

fn test<H: HmacImpl>(tvs: &[TestVector]) {
    let mut buf = [0u8; 128];
    for tv in tvs {
        let salt = if tv.salt.is_empty() {
            None
        } else {
            Some(tv.salt)
        };
        let (prk2, hkdf) = GenericHkdf::<H>::extract(salt, tv.ikm);
        let okm_dst = &mut buf[..tv.okm.len()];
        assert!(hkdf.expand(tv.info, okm_dst).is_ok());

        assert_eq!(prk2[..], tv.prk[..]);
        assert_eq!(okm_dst, tv.okm);

        okm_dst.fill(0);
        let hkdf = GenericHkdf::<H>::from_prk(tv.prk).unwrap();
        assert!(hkdf.expand(tv.info, okm_dst).is_ok());
        assert_eq!(okm_dst, tv.okm);
    }
}

macro_rules! new_test {
    ($name:ident, $hash:ty) => {
        #[test]
        fn $name() {
            blobby::parse_into_structs!(
                include_bytes!(concat!("data/", stringify!($name), ".blb"));
                static TEST_VECTORS: &[TestVector { ikm, salt, info, prk, okm }];
            );

            test::<Hmac<$hash>>(TEST_VECTORS);
            test::<SimpleHmac<$hash>>(TEST_VECTORS);
        }
    };
}

new_test!(rfc5869_sha1, sha1::Sha1);
new_test!(rfc5869_sha256, sha2::Sha256);
