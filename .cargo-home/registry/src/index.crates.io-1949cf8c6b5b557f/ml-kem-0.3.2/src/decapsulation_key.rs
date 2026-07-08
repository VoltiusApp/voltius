use crate::{
    B32, EncapsulationKey, Seed, SharedKey,
    crypto::{G, J},
    param::{DecapsulationKeySize, ExpandedDecapsulationKey, KemParams},
    pke::{DecryptionKey, EncryptionKey},
};
use array::{
    Array, ArraySize,
    sizes::{U32, U64},
};
use kem::{
    Ciphertext, Decapsulate, Decapsulator, Generate, InvalidKey, Kem, KeyExport, KeyInit,
    KeySizeUser,
};
use module_lattice::{
    MaybeBox,
    ctutils::{CtEq, CtSelect},
};
use rand_core::{TryCryptoRng, TryRng};

#[cfg(feature = "zeroize")]
use zeroize::{Zeroize, ZeroizeOnDrop};

/// A `DecapsulationKey` provides the ability to generate a new key pair, and decapsulate an
/// encapsulated shared key.
#[derive(Clone, Debug)]
pub struct DecapsulationKey<P>
where
    P: KemParams,
{
    /// Decryption key.
    dk_pke: MaybeBox<DecryptionKey<P>>,

    /// Associated encapsulation key.
    ek: EncapsulationKey<P>,

    /// Seed this key was initialized from.
    d: Option<MaybeBox<B32>>,

    /// Random string used during the implicit rejection process.
    z: MaybeBox<B32>,
}

impl<P> DecapsulationKey<P>
where
    P: KemParams,
{
    /// Create a [`DecapsulationKey`] instance from a 64-byte random seed value.
    #[inline]
    #[must_use]
    pub fn from_seed(seed: Seed) -> Self {
        let (d, z) = seed.split();
        Self::generate_deterministic(d, z)
    }

    /// Initialize a [`DecapsulationKey`] from the serialized expanded key form.
    ///
    /// Note that this form is deprecated in practice; use [`DecapsulationKey::from_seed`].
    /// See [`ExpandedKeyEncoding`] for more information.
    ///
    /// # Errors
    /// - Returns [`InvalidKey`] in the event the expanded key failed validation
    #[deprecated(since = "0.3.0", note = "use `DecapsulationKey::from_seed` instead")]
    pub fn from_expanded(enc: &ExpandedDecapsulationKey<P>) -> Result<Self, InvalidKey> {
        let (dk_pke, ek_pke, h, z) = P::split_dk(enc);
        let dk_pke = MaybeBox::new(DecryptionKey::from_bytes(dk_pke));
        let ek_pke = EncryptionKey::from_bytes(ek_pke)?;

        let ek = EncapsulationKey::from_encryption_key(ek_pke);
        if ek.h() != *h {
            return Err(InvalidKey);
        }

        Ok(Self {
            dk_pke,
            ek,
            d: None,
            z: MaybeBox::new(z.clone()),
        })
    }

    /// Serialize the [`Seed`] value: 64-bytes which can be used to reconstruct the
    /// [`DecapsulationKey`].
    ///
    /// <div class="warning">
    /// <b>Warning!</B>
    ///
    /// This value is key material. Please treat it with care.
    /// </div>
    ///
    /// # Returns
    /// - `Some` if the [`DecapsulationKey`] was initialized using `from_seed` or `generate`.
    /// - `None` if the [`DecapsulationKey`] was initialized from the expanded form.
    #[inline]
    #[must_use]
    pub fn to_seed(&self) -> Option<Seed> {
        self.d.as_ref().map(|d| d.concat(*self.z))
    }

    /// Get the [`EncapsulationKey`] which corresponds to this [`DecapsulationKey`].
    #[must_use]
    pub fn encapsulation_key(&self) -> &EncapsulationKey<P> {
        &self.ek
    }

    #[inline]
    pub(crate) fn try_generate_from_rng<R>(rng: &mut R) -> Result<Self, <R as TryRng>::Error>
    where
        R: TryCryptoRng + ?Sized,
    {
        let d = B32::try_generate_from_rng(rng)?;
        let z = B32::try_generate_from_rng(rng)?;
        Ok(Self::generate_deterministic(d, z))
    }

    #[inline]
    #[must_use]
    #[allow(clippy::similar_names)] // allow dk_pke, ek_pke, following the spec
    pub(crate) fn generate_deterministic(d: B32, z: B32) -> Self {
        let (dk_pke, ek_pke) = DecryptionKey::generate(&d);
        let ek = EncapsulationKey::from_encryption_key(ek_pke);

        let dk_pke = MaybeBox::new(dk_pke);
        let d = Some(MaybeBox::new(d));
        let z = MaybeBox::new(z);

        Self { dk_pke, ek, d, z }
    }
}

// Handwritten to omit `d` in the comparisons, so keys initialized from seeds compare equally to
// keys initialized from the expanded form
impl<P> PartialEq for DecapsulationKey<P>
where
    P: KemParams,
{
    fn eq(&self, other: &Self) -> bool {
        self.dk_pke.ct_eq(&other.dk_pke).into() && self.ek.eq(&other.ek) && self.z.eq(&other.z)
    }
}

#[cfg(feature = "zeroize")]
impl<P> Drop for DecapsulationKey<P>
where
    P: KemParams,
{
    fn drop(&mut self) {
        self.dk_pke.zeroize();
        if let Some(d) = self.d.as_mut() {
            d.zeroize();
        }
        self.z.zeroize();
    }
}

#[cfg(feature = "zeroize")]
impl<P> ZeroizeOnDrop for DecapsulationKey<P> where P: KemParams {}

impl<P> From<Seed> for DecapsulationKey<P>
where
    P: KemParams,
{
    fn from(seed: Seed) -> Self {
        Self::from_seed(seed)
    }
}

impl<P> Decapsulate for DecapsulationKey<P>
where
    P: Kem<EncapsulationKey = EncapsulationKey<P>, SharedKeySize = U32> + KemParams,
{
    fn decapsulate(&self, encapsulated_key: &Ciphertext<P>) -> SharedKey {
        let mp = self.dk_pke.decrypt(encapsulated_key);
        let (Kp, rp) = G(&[&mp, &self.ek.h()]);
        let Kbar = J(&[self.z.as_slice(), encapsulated_key.as_ref()]);
        let cp = self.ek.ek_pke().encrypt(&mp, &rp);
        Kbar.ct_select(&Kp, cp.ct_eq(encapsulated_key))
    }
}

impl<P> Decapsulator for DecapsulationKey<P>
where
    P: Kem<EncapsulationKey = EncapsulationKey<P>, SharedKeySize = U32> + KemParams,
{
    type Kem = P;

    fn encapsulation_key(&self) -> &EncapsulationKey<P> {
        &self.ek
    }
}

impl<P> Generate for DecapsulationKey<P>
where
    P: KemParams,
{
    fn try_generate_from_rng<R>(rng: &mut R) -> Result<Self, <R as TryRng>::Error>
    where
        R: TryCryptoRng + ?Sized,
    {
        Self::try_generate_from_rng(rng)
    }
}

impl<P> KeySizeUser for DecapsulationKey<P>
where
    P: KemParams,
{
    type KeySize = U64;
}

/// Initialize [`DecapsulationKey`] from a 64-byte uniformly random [`Seed`] value.
impl<P> KeyInit for DecapsulationKey<P>
where
    P: KemParams,
{
    #[inline]
    fn new(seed: &Seed) -> Self {
        Self::from_seed(*seed)
    }
}

/// Serialize the 64-byte [`Seed`] value used to initialize this [`DecapsulationKey`].
///
/// # Panics
/// If this [`DecapsulationKey`] was initialized using legacy expanded key support
/// (see [`ExpandedKeyEncoding`]).
impl<P> KeyExport for DecapsulationKey<P>
where
    P: KemParams,
{
    fn to_bytes(&self) -> Seed {
        self.to_seed().expect("should be initialized from a seed")
    }
}

/// DEPRECATED: support for encoding and decoding [`DecapsulationKey`]s in the legacy expanded form,
/// as opposed to the more widely adopted [`Seed`] form.
///
/// The expanded encoding format is problematic for several reasons, notably they need to validated
/// whereas generation from seeds is always correct, meaning there is no performance advantage to
/// using them, only additional complexity.
///
/// They are significantly larger than seeds (which are 64-bytes) and their sizes vary depending on
/// security level whereas the size of a seed is constant:
/// - ML-KEM-512: 1632 bytes
/// - ML-KEM-768: 2400 bytes
/// - ML-KEM-1024: 3168 bytes
///
/// Many ML-KEM libraries have dropped support for this format entirely.
#[deprecated(since = "0.3.0", note = "use `DecapsulationKey::from_seed` instead")]
pub trait ExpandedKeyEncoding: Sized {
    /// The size of an expanded decapsulation key.
    type EncodedSize: ArraySize;

    /// Parse a [`DecapsulationKey`] from its legacy expanded form.
    ///
    /// # Errors
    /// - If the key fails to validate successfully.
    fn from_expanded_bytes(enc: &Array<u8, Self::EncodedSize>) -> Result<Self, InvalidKey>;

    /// Serialize a [`DecapsulationKey`] to its legacy expanded form.
    fn to_expanded_bytes(&self) -> Array<u8, Self::EncodedSize>;
}

#[allow(deprecated)]
impl<P> ExpandedKeyEncoding for DecapsulationKey<P>
where
    P: KemParams,
{
    type EncodedSize = DecapsulationKeySize<P>;

    fn from_expanded_bytes(expanded: &ExpandedDecapsulationKey<P>) -> Result<Self, InvalidKey> {
        Self::from_expanded(expanded)
    }

    fn to_expanded_bytes(&self) -> ExpandedDecapsulationKey<P> {
        let dk_pke = self.dk_pke.to_bytes();
        let ek = self.ek.to_bytes();
        P::concat_dk(dk_pke, ek, self.ek.h(), *self.z)
    }
}
