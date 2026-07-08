use cipher::{
    AlgorithmName, Block, BlockCipherEncBackend, BlockCipherEncClosure, BlockCipherEncrypt,
    BlockModeEncBackend, BlockModeEncClosure, BlockModeEncrypt, BlockSizeUser, InnerIvInit, Iv,
    IvState, ParBlocksSizeUser, SetIvState,
    array::{Array, ArraySize},
    common::{InnerUser, IvSizeUser},
    consts::U1,
    inout::{InOut, InOutBuf, NotEqualError},
};
use core::fmt;

#[cfg(feature = "zeroize")]
use cipher::zeroize::{Zeroize, ZeroizeOnDrop};

/// CFB-8 mode encryptor.
pub struct Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    cipher: C,
    iv: Block<C>,
}

impl<C> BlockSizeUser for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    type BlockSize = U1;
}

impl<C> BlockModeEncrypt for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    fn encrypt_with_backend(&mut self, f: impl BlockModeEncClosure<BlockSize = Self::BlockSize>) {
        struct Closure<'a, BS, BC>
        where
            BS: ArraySize,
            BC: BlockModeEncClosure<BlockSize = U1>,
        {
            iv: &'a mut Array<u8, BS>,
            f: BC,
        }

        impl<BS, BC> BlockSizeUser for Closure<'_, BS, BC>
        where
            BS: ArraySize,
            BC: BlockModeEncClosure<BlockSize = U1>,
        {
            type BlockSize = BS;
        }

        impl<BS, BC> BlockCipherEncClosure for Closure<'_, BS, BC>
        where
            BS: ArraySize,
            BC: BlockModeEncClosure<BlockSize = U1>,
        {
            #[inline(always)]
            fn call<B: BlockCipherEncBackend<BlockSize = Self::BlockSize>>(self, backend: &B) {
                let Self { iv, f } = self;
                f.call(&mut Backend { iv, backend });
            }
        }

        let Self { cipher, iv } = self;
        cipher.encrypt_with_backend(Closure { iv, f });
    }
}

impl<C> Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    /// Encrypt data using `InOutBuf`.
    #[allow(clippy::missing_panics_doc, reason = "tail is always empty")]
    pub fn encrypt_inout(&mut self, data: InOutBuf<'_, '_, u8>) {
        let (blocks, tail) = data.into_chunks();
        // Block size is equal to 1 byte, so the tail must be always empty
        assert!(tail.is_empty());
        self.encrypt_blocks_inout(blocks);
    }

    /// Encrypt data in place.
    pub fn encrypt(&mut self, buf: &mut [u8]) {
        self.encrypt_inout(buf.into());
    }

    /// Encrypt data from buffer to buffer.
    ///
    /// # Errors
    /// If `in_buf` and `out_buf` have different lengths.
    pub fn encrypt_b2b(&mut self, in_buf: &[u8], out_buf: &mut [u8]) -> Result<(), NotEqualError> {
        InOutBuf::new(in_buf, out_buf).map(|b| self.encrypt_inout(b))
    }
}

impl<C> InnerUser for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    type Inner = C;
}

impl<C> IvSizeUser for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    type IvSize = C::BlockSize;
}

impl<C> InnerIvInit for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    #[inline]
    fn inner_iv_init(cipher: C, iv: &Iv<Self>) -> Self {
        let iv = iv.clone();
        Self { cipher, iv }
    }
}

impl<C> IvState for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    #[inline]
    fn iv_state(&self) -> Iv<Self> {
        self.iv.clone()
    }
}

impl<C> SetIvState for Encryptor<C>
where
    C: BlockCipherEncrypt,
{
    #[inline]
    fn set_iv(&mut self, iv: &Iv<Self>) {
        self.iv = iv.clone();
    }
}

impl<C> AlgorithmName for Encryptor<C>
where
    C: BlockCipherEncrypt + AlgorithmName,
{
    fn write_alg_name(f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("cfb8::Encryptor<")?;
        <C as AlgorithmName>::write_alg_name(f)?;
        f.write_str(">")
    }
}

impl<C> fmt::Debug for Encryptor<C>
where
    C: BlockCipherEncrypt + AlgorithmName,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("cfb8::Encryptor<")?;
        <C as AlgorithmName>::write_alg_name(f)?;
        f.write_str("> { ... }")
    }
}

impl<C: BlockCipherEncrypt> Drop for Encryptor<C> {
    fn drop(&mut self) {
        #[cfg(feature = "zeroize")]
        self.iv.zeroize();
    }
}

#[cfg(feature = "zeroize")]
impl<C: BlockCipherEncrypt + ZeroizeOnDrop> ZeroizeOnDrop for Encryptor<C> {}

struct Backend<'a, BS, BK>
where
    BS: ArraySize,
    BK: BlockCipherEncBackend<BlockSize = BS>,
{
    iv: &'a mut Array<u8, BS>,
    backend: &'a BK,
}

impl<BS, BK> BlockSizeUser for Backend<'_, BS, BK>
where
    BS: ArraySize,
    BK: BlockCipherEncBackend<BlockSize = BS>,
{
    type BlockSize = U1;
}

impl<BS, BK> ParBlocksSizeUser for Backend<'_, BS, BK>
where
    BS: ArraySize,
    BK: BlockCipherEncBackend<BlockSize = BS>,
{
    type ParBlocksSize = U1;
}

impl<BS, BK> BlockModeEncBackend for Backend<'_, BS, BK>
where
    BS: ArraySize,
    BK: BlockCipherEncBackend<BlockSize = BS>,
{
    #[inline(always)]
    fn encrypt_block(&mut self, mut block: InOut<'_, '_, Block<Self>>) {
        let mut t = self.iv.clone();
        self.backend.encrypt_block((&mut t).into());
        let k = Array([t[0]]);
        block.xor_in2out(&k);
        let r = block.get_out()[0];
        let n = self.iv.len();
        for i in 0..n - 1 {
            self.iv[i] = self.iv[i + 1];
        }
        self.iv[n - 1] = r;
    }
}
