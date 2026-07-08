#![allow(dead_code)]

use crate::{B32, param::CbdSamplingSize};
use module_lattice::EncodedPolynomial;
use sha3::{
    Digest, Sha3_256, Sha3_512, Shake128, Shake256,
    digest::{ExtendableOutput, Update, XofReader},
};

pub(crate) fn G(inputs: &[impl AsRef<[u8]>]) -> (B32, B32) {
    let mut h = Sha3_512::new();
    for x in inputs {
        Digest::update(&mut h, x);
    }
    let out = h.finalize();

    let mut a = B32::default();
    let mut b = B32::default();

    a.copy_from_slice(&out[..32]);
    b.copy_from_slice(&out[32..]);
    (a, b)
}

pub(crate) fn H(x: impl AsRef<[u8]>) -> B32 {
    let mut h = Sha3_256::new();
    Digest::update(&mut h, x);

    // This odd conversion is needed because the `sha3` crate links against an old version of
    // the `generic-array` crate.  It should be pretty cheap though, since there's only one
    // allocation / no copies.
    let mut out = B32::default();
    h.finalize_into(&mut out);
    out
}

pub(crate) fn J(inputs: &[impl AsRef<[u8]>]) -> B32 {
    let mut h = Shake256::default();
    for x in inputs {
        h.update(x.as_ref());
    }
    let mut r = h.finalize_xof();

    let mut out = B32::default();
    r.read(&mut out);
    out
}

pub(crate) type PrfOutput<Eta> = EncodedPolynomial<<Eta as CbdSamplingSize>::SampleSize>;

pub(crate) fn PRF<Eta>(s: &B32, b: u8) -> PrfOutput<Eta>
where
    Eta: CbdSamplingSize,
{
    let mut h = Shake256::default();
    h.update(s.as_ref());
    h.update(&[b]);
    let mut r = h.finalize_xof();

    let mut out = PrfOutput::<Eta>::default();
    r.read(&mut out);
    out
}

pub(crate) fn XOF(rho: &B32, i: u8, j: u8) -> impl XofReader {
    let mut h = Shake128::default();
    h.update(rho);
    h.update(&[i, j]);
    h.finalize_xof()
}

// // A Go script to generate the test vector outputs
//
// package main
//
// import (
// 	"fmt"
// 	"golang.org/x/crypto/sha3"
// )
//
// func main() {
// 	// G: B* -> B32 || B32 = SHA3_512(c)
//   msgG := []byte("Input to an invocation of G")
//   hG := sha3.New512()
//   hG.Write(msgG)
//   fmt.Printf("G: %x\n", hG.Sum(nil))
//
//   // H: B* -> B32 = SHA3_256(s)
//   msgH := []byte("Input to an invocation of H")
//   hH := sha3.New256()
//   hH.Write(msgH)
//   fmt.Printf("H: %x\n", hH.Sum(nil))
//
//   // J: B* -> B32 = SHAKE256(s, 32)
//   msgJ := []byte("Input to an invocation of J")
//   outJ := make([]byte, 32)
//   sha3.ShakeSum256(outJ, msgJ)
//   fmt.Printf("J: %x\n", outJ)
//
//   // PRF<2>: B32 x B -> B64eta = SHAKE256(s || b, 64 * eta)
//   msgPRF2s := []byte("Input s to an invocation of PRF2")
//   msgPRF2b := []byte("b")
//   msgPRF2 := append(msgPRF2s, msgPRF2b...)
//   outPRF2 := make([]byte, 64 * 2)
//   sha3.ShakeSum256(outPRF2, msgPRF2)
//   fmt.Printf("PRF<2>: %x\n", outPRF2)
//
//   // PRF<3>: B33 x B -> B64eta = SHAKE256(s || b, 64 * eta)
//   msgPRF3s := []byte("Input s to an invocation of PRF3")
//   msgPRF3b := []byte("b")
//   msgPRF3 := append(msgPRF3s, msgPRF3b...)
//   outPRF3 := make([]byte, 64 * 3)
//   sha3.ShakeSum256(outPRF3, msgPRF3)
//   fmt.Printf("PRF<3>: %x\n", outPRF3)
//
//   // XOF: B32 x B x B -> B* = SHAKE128(rho || i || j)
//   msgXOFrho := []byte("Input rho, to an XOF invocation!")
//   msgXOFi := []byte("i")
//   msgXOFj := []byte("j")
//   msgXOF := append(append(msgXOFrho, msgXOFi...), msgXOFj...)
//   outXOF := make([]byte, 32)
//   sha3.ShakeSum128(outXOF, msgXOF)
//   fmt.Printf("XOF: %x\n", outXOF)
//
// }

#[cfg(test)]
mod test {
    use super::*;
    use array::typenum::{U2, U3};
    use hex_literal::hex;

    #[test]
    fn g() {
        let msg1 = "Input to ".as_bytes();
        let msg2 = "an invocation of G".as_bytes();
        let (actualA, actualB) = G(&[msg1, msg2]);
        let expectedA = hex!("07dfced2a3a3feb3277cee1709818828ea6d2f42800152e9c312e848122231c2");
        let expectedB = hex!("272969098a1bbd5a0a9844e2f89f206d8f7f4599e36aecaa4793af400fd880d8");
        assert_eq!(actualA, expectedA);
        assert_eq!(actualB, expectedB);
    }

    #[test]
    fn h() {
        let msg = "Input to an invocation of H".as_bytes();
        let actual = H(msg);
        let expected = hex!("0ee3ce94213d7dd0069b24b8b15cdd0bcf8eb1c6b3c21c441dc6a19e979cc7eb");
        assert_eq!(actual, expected);
    }

    #[test]
    fn j() {
        let msg1 = "Input to ".as_bytes();
        let msg2 = "an invocation of J".as_bytes();
        let actual = J(&[msg1, msg2]);
        let expected = hex!("a5292293d70c8eca049cbb475c48fabd625ed2b20785a18248504d3741196b52");
        assert_eq!(actual, expected);
    }

    #[test]
    fn prf() {
        let s = B32::try_from("Input s to an invocation of PRF2".as_bytes())
            .expect("Failed to create B32 from slice");
        let b = b'b';
        let actual = PRF::<U2>(&s, b);
        let expected = hex!(
            "54c002415c2219b564d5c17b0df0c82f83ddf3fdecc7d814ed5d85457c06c2c3\
             ed0b0584f926dffb1e57c6105f8604e81c4605b93f8284e44585104101042075\
             568113c861516d91bed227638654fc7f872df205c113b8364091755b62284eec\
             a6124f2cd4c1cdf598cb8324a4f373470a8f81ee618c75cc33f66facee01c213"
        );
        assert_eq!(actual, expected);

        let s = B32::try_from("Input s to an invocation of PRF3".as_bytes())
            .expect("Failed to create B32 from slice");
        let b = b'b';
        let actual = PRF::<U3>(&s, b);
        let expected = hex!(
            "5e12028f67479b862a12713cda833e21b8ccd51bff9ddc2bfb9ab2910a9dc2e6\
             c58264a3f51ccc9ef4ff936a15505e016f60c36ffe300be01b9fb12eacd57867\
             0873c24709d6146b42c42a07873522eac100d61942ae53e73fbf9095b29b1ab7\
             169e954213c062703dad88c1c5f57f92af143f0364fe057b134b54ea8a55d94c\
             67764b3fc6b37376453978b8f0caeb6b18c188c28ee8681e28339477e042d5a1\
             b4a12deb1de8b9dad026b4e323e03973ffbe25dd511eed5460d22a9851cfc220"
        );
        assert_eq!(actual, expected);
    }

    #[test]
    fn xof() {
        let rho = B32::try_from("Input rho, to an XOF invocation!".as_bytes())
            .expect("Failed to create B32 from slice");
        let i = b'i';
        let j = b'j';

        let mut reader = XOF(&rho, i, j);
        let mut actual = [0u8; 32];
        reader.read(&mut actual);

        let expected = hex!("0d2c3e65f754d074cb366cf1b099ae105cc40f018342509f15f1ba8a1a4144cb");
        assert_eq!(actual, expected);
    }
}
