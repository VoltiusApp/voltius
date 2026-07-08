use crate::{
    B32, SharedKey,
    crypto::{G, H},
    kem::{InvalidKey, Kem, Key, KeyExport, KeySizeUser, TryKeyInit},
    param::{EncapsulationKeySize, KemParams},
    pke::EncryptionKey,
};
use array::sizes::U32;
use kem::{Ciphertext, Encapsulate, Generate};
use module_lattice::MaybeBox;
use rand_core::CryptoRng;

/// An `EncapsulationKey` provides the ability to encapsulate a shared key so that it can only be
/// decapsulated by the holder of the corresponding decapsulation key.
#[derive(Clone, Debug)]
pub struct EncapsulationKey<P>
where
    P: KemParams,
{
    ek_pke: MaybeBox<EncryptionKey<P>>,
    h: B32,
}

impl<P> EncapsulationKey<P>
where
    P: Kem<SharedKeySize = U32> + KemParams,
{
    /// Create a new [`EncapsulationKey`] from its serialized form.
    ///
    /// # Errors
    /// If the key failed validation during decoding.
    pub fn new(encapsulation_key: &Key<Self>) -> Result<Self, InvalidKey> {
        EncryptionKey::from_bytes(encapsulation_key)
            .map(Self::from_encryption_key)
            .map_err(|_| InvalidKey)
    }

    /// Encapsulates with the given randomness. This is useful for testing against known vectors.
    ///
    /// # Warning
    /// Do NOT use this function unless you know what you're doing. If you fail to use all uniform
    /// random bytes even once, you can have catastrophic security failure.
    #[cfg_attr(not(feature = "hazmat"), doc(hidden))]
    #[must_use]
    pub fn encapsulate_deterministic(&self, m: &B32) -> (Ciphertext<P>, SharedKey) {
        let (K, r) = G(&[m, &self.h]);
        let c = self.ek_pke.encrypt(m, &r);
        (c, K)
    }

    /// Convert from an `EncryptionKey`.
    #[inline]
    pub(crate) fn from_encryption_key(ek_pke: EncryptionKey<P>) -> Self {
        let h = H(ek_pke.to_bytes());
        Self {
            ek_pke: MaybeBox::new(ek_pke),
            h,
        }
    }

    /// Borrow the encryption key.
    pub(crate) fn ek_pke(&self) -> &EncryptionKey<P> {
        &self.ek_pke
    }

    /// Retrieve the hash of the encryption key.
    pub(crate) fn h(&self) -> B32 {
        self.h
    }
}

impl<P> Encapsulate for EncapsulationKey<P>
where
    P: Kem + KemParams,
{
    type Kem = P;

    fn encapsulate_with_rng<R>(&self, rng: &mut R) -> (Ciphertext<P>, SharedKey)
    where
        R: CryptoRng + ?Sized,
    {
        let m = B32::generate_from_rng(rng);
        self.encapsulate_deterministic(&m)
    }
}

impl<P> KeyExport for EncapsulationKey<P>
where
    P: KemParams,
{
    fn to_bytes(&self) -> Key<Self> {
        self.ek_pke.to_bytes()
    }
}

impl<P> KeySizeUser for EncapsulationKey<P>
where
    P: KemParams,
{
    type KeySize = EncapsulationKeySize<P>;
}

impl<P> TryKeyInit for EncapsulationKey<P>
where
    P: KemParams,
{
    fn new(encapsulation_key: &Key<Self>) -> Result<Self, InvalidKey> {
        Self::new(encapsulation_key)
    }
}

impl<P> Eq for EncapsulationKey<P> where P: KemParams {}
impl<P> PartialEq for EncapsulationKey<P>
where
    P: KemParams,
{
    fn eq(&self, other: &Self) -> bool {
        // Handwritten to avoid derive putting `Eq` bounds on `KemParams`
        self.ek_pke == other.ek_pke && self.h == other.h
    }
}
