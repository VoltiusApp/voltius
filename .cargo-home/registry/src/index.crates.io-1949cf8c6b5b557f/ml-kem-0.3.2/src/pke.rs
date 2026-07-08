use crate::B32;
use crate::algebra::{
    Ntt, NttInverse, NttMatrix, NttVector, Polynomial, Vector, matrix_sample_ntt, sample_poly_cbd,
    sample_poly_vec_cbd,
};
use crate::compress::Compress;
use crate::crypto::{G, PRF};
use crate::param::{EncodedDecryptionKey, EncodedEncryptionKey, PkeParams};
use array::typenum::{U1, Unsigned};
use kem::{Ciphertext, InvalidKey};
use module_lattice::{
    Encode,
    ctutils::{Choice, CtEq},
};

#[cfg(feature = "zeroize")]
use zeroize::Zeroize;

/// A `DecryptionKey` provides the ability to generate a new key pair, and decrypt an
/// encrypted value.
#[derive(Clone, Default, Debug)]
pub(crate) struct DecryptionKey<P>
where
    P: PkeParams,
{
    s_hat: NttVector<P::K>,
}

impl<P> CtEq for DecryptionKey<P>
where
    P: PkeParams,
{
    fn ct_eq(&self, other: &Self) -> Choice {
        self.s_hat.ct_eq(&other.s_hat)
    }
}

impl<P> Eq for DecryptionKey<P> where P: PkeParams {}
impl<P> PartialEq for DecryptionKey<P>
where
    P: PkeParams,
{
    fn eq(&self, other: &Self) -> bool {
        // Compare decryption keys in constant-time
        self.ct_eq(other).into()
    }
}

#[cfg(feature = "zeroize")]
impl<P> Zeroize for DecryptionKey<P>
where
    P: PkeParams,
{
    fn zeroize(&mut self) {
        self.s_hat.zeroize();
    }
}

impl<P> DecryptionKey<P>
where
    P: PkeParams,
{
    /// Generate a new random decryption key according to the `K-PKE.KeyGen` procedure.
    // Algorithm 12. K-PKE.KeyGen()
    pub(crate) fn generate(d: &B32) -> (Self, EncryptionKey<P>) {
        // Generate random seeds
        let k = P::K::U8;
        let (rho, sigma) = G(&[&d[..], &[k]]);

        // Sample pseudo-random matrix and vectors
        let A_hat: NttMatrix<P::K> = matrix_sample_ntt(&rho, false);
        let s: Vector<P::K> = sample_poly_vec_cbd::<P::Eta1, P::K>(&sigma, 0);
        let e: Vector<P::K> = sample_poly_vec_cbd::<P::Eta1, P::K>(&sigma, P::K::U8);

        // NTT the vectors
        let s_hat = s.ntt();
        let e_hat = e.ntt();

        // Compute the public value
        let t_hat = &(&A_hat * &s_hat) + &e_hat;

        // Assemble the keys
        let dk = DecryptionKey { s_hat };
        let ek = EncryptionKey { t_hat, rho };
        (dk, ek)
    }

    /// Decrypt ciphertext to obtain the encrypted value, according to the K-PKE.Decrypt procedure.
    // Algorithm 14. kK-PKE.Decrypt(dk_PKE, c)
    pub(crate) fn decrypt(&self, ciphertext: &Ciphertext<P>) -> B32 {
        let (c1, c2) = P::split_ct(ciphertext);

        let mut u: Vector<P::K> = Encode::<P::Du>::decode(c1);
        u.decompress::<P::Du>();

        let mut v: Polynomial = Encode::<P::Dv>::decode(c2);
        v.decompress::<P::Dv>();

        let u_hat = u.ntt();
        let sTu = (&self.s_hat * &u_hat).ntt_inverse();
        let mut w = &v - &sTu;
        Encode::<U1>::encode(w.compress::<U1>())
    }

    /// Represent this decryption key as a byte array `(s_hat)`
    pub(crate) fn to_bytes(&self) -> EncodedDecryptionKey<P> {
        P::encode_u12(&self.s_hat)
    }

    /// Parse an decryption key from a byte array `(s_hat)`
    pub(crate) fn from_bytes(enc: &EncodedDecryptionKey<P>) -> Self {
        let s_hat = P::decode_u12(enc);
        Self { s_hat }
    }
}

/// An `EncryptionKey` provides the ability to encrypt a value so that it can only be
/// decrypted by the holder of the corresponding decapsulation key.
#[derive(Clone, Default, Debug, Eq, PartialEq)]
pub(crate) struct EncryptionKey<P>
where
    P: PkeParams,
{
    t_hat: NttVector<P::K>,
    rho: B32,
}

impl<P> EncryptionKey<P>
where
    P: PkeParams,
{
    /// Encrypt the specified message for the holder of the corresponding decryption key, using the
    /// provided randomness, according the `K-PKE.Encrypt` procedure.
    pub(crate) fn encrypt(&self, message: &B32, randomness: &B32) -> Ciphertext<P> {
        let r = sample_poly_vec_cbd::<P::Eta1, P::K>(randomness, 0);
        let e1 = sample_poly_vec_cbd::<P::Eta2, P::K>(randomness, P::K::U8);

        let prf_output = PRF::<P::Eta2>(randomness, 2 * P::K::U8);
        let e2: Polynomial = sample_poly_cbd::<P::Eta2>(&prf_output);

        let A_hat_t: NttMatrix<P::K> = matrix_sample_ntt(&self.rho, true);
        let r_hat: NttVector<P::K> = r.ntt();
        let ATr: Vector<P::K> = (&A_hat_t * &r_hat).ntt_inverse();
        let mut u = ATr + e1;

        let mut mu: Polynomial = Encode::<U1>::decode(message);
        mu.decompress::<U1>();

        let tTr: Polynomial = (&self.t_hat * &r_hat).ntt_inverse();
        let mut v = &(&tTr + &e2) + &mu;

        let c1 = Encode::<P::Du>::encode(u.compress::<P::Du>());
        let c2 = Encode::<P::Dv>::encode(v.compress::<P::Dv>());
        P::concat_ct(c1, c2)
    }

    /// Represent this encryption key as a byte array `(t_hat || rho)`
    pub(crate) fn to_bytes(&self) -> EncodedEncryptionKey<P> {
        let t_hat = P::encode_u12(&self.t_hat);
        P::concat_ek(t_hat, self.rho.clone())
    }

    /// Parse an encryption key from a byte array `(t_hat || rho)`.
    ///
    /// # Errors
    /// Returns [`InvalidKey`] in the event that the key fails the encapsulation key checks
    /// specified in FIPS 203 §7.2.
    pub(crate) fn from_bytes(enc: &EncodedEncryptionKey<P>) -> Result<Self, InvalidKey> {
        let (t_hat, rho) = P::split_ek(enc);
        let t_hat = P::decode_u12(t_hat);
        let ret = Self {
            t_hat,
            rho: rho.clone(),
        };

        // Check the candidate encapsulation key is valid using the method specified in FIPS 203
        // §7.2 ML-KEM Encapsulation:
        //
        // > Encapsulation key check. To check a candidate encapsulation key `ek`, perform the
        // > following:
        // >
        // > 1. (Type check) If `ek` is not an array of bytes of length 384𝑘+32 for the value of 𝑘
        // >    specified by the relevant parameter set, then input checking failed.
        // > 2. (Modulus check) Perform the computation:
        // >
        // >    test ← ByteEncode₁₂(ByteDecode₁₂(ek[0:384𝑘]))
        // >
        // >    (see Section 4.2.1). If `test ≠ ek[0∶384𝑘]`, then input checking failed. This
        // >    check ensures that the integers encoded in the public key are in the valid range
        // >    `[0,q-1]`.
        // >
        // > If both checks pass, then `ML-KEM.Encaps` can be run with input `ek`. It is important
        // > to note that this checking process does not guarantee that ek is a properly produced
        // > output of `ML-KEM.KeyGen`.
        // >
        // > `ML-KEM.Encaps` shall not be run with an encapsulation key that has not been checked as
        // > above.
        //
        // #1 is performed by the `EncodedEncryptionKey` type, and the following check vicariously
        // performs #2 by encoding the integer-mod-q array using our implementation of ByteEncode₁₂
        // and comparing the resulting serialization to see if it round-trips.
        if &ret.to_bytes() == enc {
            Ok(ret)
        } else {
            Err(InvalidKey)
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::{MlKem512, MlKem768, MlKem1024};
    use ::kem::Generate;
    use getrandom::{SysRng, rand_core::UnwrapErr};

    fn round_trip_test<P>()
    where
        P: PkeParams,
    {
        let mut rng = UnwrapErr(SysRng);
        let d = B32::generate_from_rng(&mut rng);
        let original = B32::default();
        let randomness = B32::default();

        let (dk, ek) = DecryptionKey::<P>::generate(&d);
        let encrypted = ek.encrypt(&original, &randomness);
        let decrypted = dk.decrypt(&encrypted);
        assert_eq!(original, decrypted);
    }

    #[test]
    fn round_trip() {
        round_trip_test::<MlKem512>();
        round_trip_test::<MlKem768>();
        round_trip_test::<MlKem1024>();
    }

    fn codec_test<P>()
    where
        P: PkeParams,
    {
        let mut rng = UnwrapErr(SysRng);
        let d = B32::generate_from_rng(&mut rng);
        let (dk_original, ek_original) = DecryptionKey::<P>::generate(&d);

        let dk_encoded = dk_original.to_bytes();
        let dk_decoded = DecryptionKey::from_bytes(&dk_encoded);
        assert_eq!(dk_original, dk_decoded);

        let ek_encoded = ek_original.to_bytes();
        let ek_decoded = EncryptionKey::from_bytes(&ek_encoded).unwrap();
        assert_eq!(ek_original, ek_decoded);
    }

    #[test]
    fn codec() {
        codec_test::<MlKem512>();
        codec_test::<MlKem768>();
        codec_test::<MlKem1024>();
    }

    #[test]
    fn reject_invalid_encryption_keys() {
        // Create an invalid key: all bytes set to 0xFF
        // When decoded as 12-bit coefficients, this produces values of 0xFFF = 4095 > 3329
        let invalid_key = [0xFF; 1184];
        assert!(EncryptionKey::<MlKem768>::from_bytes(&invalid_key.into()).is_err());
    }

    fn key_inequality_test<P>()
    where
        P: PkeParams,
    {
        let mut rng = UnwrapErr(SysRng);
        let d1 = B32::generate_from_rng(&mut rng);
        let d2 = B32::generate_from_rng(&mut rng);

        let (dk1, _) = DecryptionKey::<P>::generate(&d1);
        let (dk2, _) = DecryptionKey::<P>::generate(&d2);

        // Verify inequality (catches PartialEq mutation that returns true unconditionally)
        assert_ne!(dk1, dk2);
    }

    #[test]
    fn key_inequality() {
        key_inequality_test::<MlKem512>();
        key_inequality_test::<MlKem768>();
        key_inequality_test::<MlKem1024>();
    }
}
