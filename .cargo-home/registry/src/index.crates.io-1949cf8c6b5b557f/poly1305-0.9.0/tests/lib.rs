//! Poly1305 integration tests.

use core::iter::repeat_n;
use hex_literal::hex;
use poly1305::{
    Block, KEY_SIZE, Poly1305,
    universal_hash::{KeyInit, UniversalHash},
};

#[test]
fn test_nacl_vector() {
    let key = hex!("eea6a7251c1e72916d11c2cb214d3c252539121d8e234e652d651fa4c8cff880");

    let msg = hex!(
        "8e993b9f48681273c29650ba32fc76ce
        48332ea7164d96a4476fb8c531a1186a
        c0dfc17c98dce87b4da7f011ec48c972
        71d2c20f9b928fe2270d6fb863d51738
        b48eeee314a7cc8ab932164548e526ae
        90224368517acfeabd6bb3732bc0e9da
        99832b61ca01b6de56244a9e88d5f9b3
        7973f622a43d14a6599b1f654cb45a74
        e355a5"
    );

    let expected = hex!("f3ffc7703f9400e52a7dfb4b3d3305d9");

    let result1 = Poly1305::new(&key.into()).compute_unpadded(&msg);
    assert_eq!(&expected[..], result1.as_slice());
}

#[test]
fn donna_self_test1() {
    // This gives r = 2 and s = 0.
    let key = hex!("0200000000000000000000000000000000000000000000000000000000000000");

    // This results in a 130-bit integer with the lower 129 bits all set: m = (1 << 129) - 1
    let msg = hex!("ffffffffffffffffffffffffffffffff");

    // The input is a single block, so we should have the following computation:
    //     tag = ((m * r) % p) + s
    //         = ((((1 << 129) - 1) * 2) % p) + 0
    //         = ((1 << 130) - 2) % (1 << 130) - 5
    //         = 3
    let expected = hex!("03000000000000000000000000000000");

    let mut poly = Poly1305::new(&key.into());
    poly.update(&[msg.into()]);
    assert_eq!(&expected[..], poly.finalize().as_slice());
}

#[test]
fn donna_self_test2() {
    let total_key = hex!("01020304050607fffefdfcfbfaf9ffffffffffffffffffffffffffff00000000");
    let total_mac = hex!("64afe2e8d6ad7bbdd287f97c44623d39");

    let mut tpoly = Poly1305::new(&total_key.into());

    for i in 0..256 {
        let mut key = [0u8; KEY_SIZE];
        key.copy_from_slice(&repeat_n(i as u8, KEY_SIZE).collect::<Vec<_>>());

        let msg: Vec<u8> = repeat_n(i as u8, 256).collect();
        let tag = Poly1305::new(&key.into()).compute_unpadded(&msg[..i]);
        tpoly.update(&[tag]);
    }

    assert_eq!(&total_mac[..], tpoly.finalize().as_slice());
}

#[test]
fn test_tls_vectors() {
    // from https://datatracker.ietf.org/doc/html/draft-agl-tls-chacha20poly1305-04#section-7
    let key = b"this is 32-byte key for Poly1305";
    let msg = [0u8; 32];
    let expected = hex!("49ec78090e481ec6c26b33b91ccc0307");

    let mut poly = Poly1305::new(key.into());

    let blocks = Block::slice_as_chunks(&msg).0;
    poly.update(blocks);

    assert_eq!(&expected[..], poly.finalize().as_slice());
}

#[test]
fn test_rfc7539_vector() {
    // From <https://tools.ietf.org/html/rfc7539#section-2.5.2>
    let key = hex!("85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b");
    let msg = hex!("43727970746f6772617068696320466f72756d2052657365617263682047726f7570");
    let expected = hex!("a8061dc1305136c6c22b8baf0c0127a9");

    let result = Poly1305::new(&key.into()).compute_unpadded(&msg);
    assert_eq!(&expected[..], result.as_slice());
}

#[test]
fn padded_input() {
    // poly1305 key and AAD from <https://tools.ietf.org/html/rfc8439#section-2.8.2>
    let key = hex!("7bac2b252db447af09b67a55a4e955840ae1d6731075d9eb2a9375783ed553ff");
    let msg = hex!("50515253c0c1c2c3c4c5c6c7");
    let expected = hex!("ada56caa480fe6f5067039244a3d76ba");

    let mut poly = Poly1305::new(&key.into());
    poly.update_padded(&msg);
    assert_eq!(&expected[..], poly.finalize().as_slice());
}
