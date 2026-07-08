use cipher::{KeyIvInit, StreamCipher, StreamCipherSeek, blobby};
use salsa20::Salsa20;

/// ECRYPT test vectors:
/// https://github.com/das-labor/legacy/blob/master/microcontroller-2/arm-crypto-lib/testvectors/salsa20-256.64-verified.test-vectors
#[test]
fn salsa20_ecrypt() {
    blobby::parse_into_structs!(
        include_bytes!("data/ecrypt.blb");
        #[define_struct]
        static TEST_VECTORS: &[
            TestVector { key, iv, pos, expected }
        ];
    );

    for tv in TEST_VECTORS {
        let key = tv.key.try_into().unwrap();
        let iv = tv.iv.try_into().unwrap();
        let pos = u32::from_be_bytes(tv.pos.try_into().unwrap());

        let mut c = Salsa20::new(key, iv);
        c.seek(pos);

        let mut buf = [0u8; 64];
        c.apply_keystream(&mut buf);

        assert_eq!(buf, tv.expected);
    }
}
