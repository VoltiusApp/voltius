use crate::{
    B32,
    crypto::{PRF, PrfOutput, XOF},
    param::CbdSamplingSize,
};
use array::{Array, ArraySize, typenum::U256};
use module_lattice::{Encode, Field, MultiplyNtt, Truncate};
use sha3::digest::XofReader;

module_lattice::define_field!(BaseField, u16, u32, u64, 3329);

pub(crate) type Int = <BaseField as Field>::Int;

/// An element of GF(q).
pub(crate) type Elem = module_lattice::Elem<BaseField>;

/// An element of the ring `R_q`, i.e., a polynomial over `Z_q` of degree 255
pub(crate) type Polynomial = module_lattice::Polynomial<BaseField>;

/// A vector of polynomials of length `K`.
pub(crate) type Vector<K> = module_lattice::Vector<BaseField, K>;

/// An element of the ring `T_q` i.e. a tuple of 128 elements of the direct sum components of `T_q`.
pub(crate) type NttPolynomial = module_lattice::NttPolynomial<BaseField>;

/// A vector of K NTT-domain polynomials.
pub(crate) type NttVector<K> = module_lattice::NttVector<BaseField, K>;

/// A K x K matrix of NTT-domain polynomials.  Each vector represents a row of the matrix, so that
/// multiplying on the right just requires iteration.
pub(crate) type NttMatrix<K> = module_lattice::NttMatrix<BaseField, K, K>;

/// Algorithm 7: `SampleNTT(B)`
pub(crate) fn sample_ntt(B: &mut impl XofReader) -> NttPolynomial {
    struct FieldElementReader<'a> {
        xof: &'a mut dyn XofReader,
        data: [u8; 96],
        start: usize,
        next: Option<Int>,
    }

    impl<'a> FieldElementReader<'a> {
        fn new(xof: &'a mut impl XofReader) -> Self {
            let mut out = Self {
                xof,
                data: [0u8; 96],
                start: 0,
                next: None,
            };

            // Fill the buffer
            out.xof.read(&mut out.data);

            out
        }

        fn next(&mut self) -> Elem {
            if let Some(val) = self.next {
                self.next = None;
                return Elem::new(val);
            }

            loop {
                if self.start == self.data.len() {
                    self.xof.read(&mut self.data);
                    self.start = 0;
                }

                let end = self.start + 3;
                let b = &self.data[self.start..end];
                self.start = end;

                let d1 = Int::from(b[0]) + ((Int::from(b[1]) & 0xf) << 8);
                let d2 = (Int::from(b[1]) >> 4) + (Int::from(b[2]) << 4);

                if d1 < BaseField::Q {
                    if d2 < BaseField::Q {
                        self.next = Some(d2);
                    }
                    return Elem::new(d1);
                }

                if d2 < BaseField::Q {
                    return Elem::new(d2);
                }
            }
        }
    }

    let mut reader = FieldElementReader::new(B);
    NttPolynomial::new(Array::from_fn(|_| reader.next()))
}

pub(crate) fn matrix_sample_ntt<K: ArraySize>(rho: &B32, transpose: bool) -> NttMatrix<K> {
    NttMatrix::new(Array::from_fn(|i| {
        NttVector::new(Array::from_fn(|j| {
            let (i, j) = if transpose { (j, i) } else { (i, j) };
            let mut xof = XOF(rho, Truncate::truncate(j), Truncate::truncate(i));
            sample_ntt(&mut xof)
        }))
    }))
}

/// Algorithm 8: `SamplePolyCBD_eta(B)`
///
/// To avoid all the bitwise manipulation in the algorithm as written, we reuse the logic in
/// `ByteDecode`.  We decode the PRF output into integers with eta bits, then use
/// `count_ones` to perform the summation described in the algorithm.
pub(crate) fn sample_poly_cbd<Eta>(B: &PrfOutput<Eta>) -> Polynomial
where
    Eta: CbdSamplingSize,
{
    let vals: Polynomial = Encode::<Eta::SampleSize>::decode(B);
    Polynomial::new(vals.0.iter().map(|val| Eta::ONES[val.0 as usize]).collect())
}

pub(crate) fn sample_poly_vec_cbd<Eta, K>(sigma: &B32, start_n: u8) -> Vector<K>
where
    Eta: CbdSamplingSize,
    K: ArraySize,
{
    Vector::new(Array::from_fn(|i| {
        let N = start_n + u8::truncate(i);
        let prf_output = PRF::<Eta>(sigma, N);
        sample_poly_cbd::<Eta>(&prf_output)
    }))
}

/// The Number Theoretic Transform (NTT) is a variant of the Discrete Fourier Transform (DFT)
/// defined over a finite field that turns costly polynomial multiplications into simple
/// coefficient-wise multiplications modulo a fixed prime.
pub(crate) trait Ntt {
    type Output;
    fn ntt(&self) -> Self::Output;
}

/// One layer of the forward NTT butterfly.
///
/// `LEN` is the butterfly half-length and `ITERATIONS = 128 / LEN` is the number of
/// butterfly groups in the layer. Making both compile-time constants lets the compiler
/// eliminate the iterator length calculation (`256 / (2 * LEN)`) that `step_by` would
/// otherwise compute with a `UDIV` instruction.
#[inline(always)]
fn ntt_layer<const LEN: usize, const ITERATIONS: usize>(f: &mut Array<Elem, U256>, k: &mut usize) {
    for i in 0..ITERATIONS {
        let start = i * 2 * LEN;
        let zeta = ZETA_POW_BITREV[*k];
        *k += 1;

        for j in start..(start + LEN) {
            let t = zeta * f[j + LEN];
            f[j + LEN] = f[j] - t;
            f[j] = f[j] + t;
        }
    }
}

/// Algorithm 9: `NTT`
impl Ntt for Polynomial {
    type Output = NttPolynomial;

    fn ntt(&self) -> NttPolynomial {
        let mut k = 1;
        let mut f = self.0;

        ntt_layer::<128, 1>(&mut f, &mut k);
        ntt_layer::<64, 2>(&mut f, &mut k);
        ntt_layer::<32, 4>(&mut f, &mut k);
        ntt_layer::<16, 8>(&mut f, &mut k);
        ntt_layer::<8, 16>(&mut f, &mut k);
        ntt_layer::<4, 32>(&mut f, &mut k);
        ntt_layer::<2, 64>(&mut f, &mut k);

        f.into()
    }
}

impl<K: ArraySize> Ntt for Vector<K> {
    type Output = NttVector<K>;

    fn ntt(&self) -> NttVector<K> {
        NttVector::new(self.0.iter().map(Ntt::ntt).collect())
    }
}

/// The inverse NTT is the reverse of the Number Theoretic Transform, converting coefficient-wise
/// products back into standard polynomial form while preserving correctness modulo the same prime.
#[allow(clippy::module_name_repetitions)]
pub(crate) trait NttInverse {
    type Output;
    fn ntt_inverse(&self) -> Self::Output;
}

/// One layer of the inverse NTT butterfly.
///
/// See [`ntt_layer`] for the rationale behind the const generics.
#[inline(always)]
fn ntt_inverse_layer<const LEN: usize, const ITERATIONS: usize>(
    f: &mut Array<Elem, U256>,
    k: &mut usize,
) {
    for i in 0..ITERATIONS {
        let start = i * 2 * LEN;
        let zeta = ZETA_POW_BITREV[*k];
        *k -= 1;

        for j in start..(start + LEN) {
            let t = f[j];
            f[j] = t + f[j + LEN];
            f[j + LEN] = zeta * (f[j + LEN] - t);
        }
    }
}

/// Algorithm 10: `NTT^{-1}`
impl NttInverse for NttPolynomial {
    type Output = Polynomial;

    fn ntt_inverse(&self) -> Polynomial {
        let mut f: Array<Elem, U256> = self.0.clone();
        let mut k = 127;

        ntt_inverse_layer::<2, 64>(&mut f, &mut k);
        ntt_inverse_layer::<4, 32>(&mut f, &mut k);
        ntt_inverse_layer::<8, 16>(&mut f, &mut k);
        ntt_inverse_layer::<16, 8>(&mut f, &mut k);
        ntt_inverse_layer::<32, 4>(&mut f, &mut k);
        ntt_inverse_layer::<64, 2>(&mut f, &mut k);
        ntt_inverse_layer::<128, 1>(&mut f, &mut k);

        Elem::new(3303) * &Polynomial::new(f)
    }
}

impl<K: ArraySize> NttInverse for NttVector<K> {
    type Output = Vector<K>;

    fn ntt_inverse(&self) -> Vector<K> {
        Vector::new(self.0.iter().map(NttInverse::ntt_inverse).collect())
    }
}

/// Algorithm 11: `MultiplyNTTs`
impl MultiplyNtt for BaseField {
    fn multiply_ntt(lhs: &NttPolynomial, rhs: &NttPolynomial) -> NttPolynomial {
        let mut out = NttPolynomial::new(Array::default());

        for i in 0..128 {
            let (c0, c1) = base_case_multiply(
                lhs.0[2 * i],
                lhs.0[2 * i + 1],
                rhs.0[2 * i],
                rhs.0[2 * i + 1],
                i,
            );

            out.0[2 * i] = c0;
            out.0[2 * i + 1] = c1;
        }

        out
    }
}

/// Algorithm 12: `BaseCaseMultiply`
///
/// This is a hot loop.  We promote to u64 so that we can do the absolute minimum number of
/// modular reductions, since these are the expensive operation.
#[inline]
fn base_case_multiply(a0: Elem, a1: Elem, b0: Elem, b1: Elem, i: usize) -> (Elem, Elem) {
    let a0 = u32::from(a0.0);
    let a1 = u32::from(a1.0);
    let b0 = u32::from(b0.0);
    let b1 = u32::from(b1.0);
    let g = u32::from(GAMMA[i].0);

    let b1g = u32::from(BaseField::barrett_reduce(b1 * g));

    let c0 = BaseField::barrett_reduce(a0 * b0 + a1 * b1g);
    let c1 = BaseField::barrett_reduce(a0 * b1 + a1 * b0);
    (Elem::new(c0), Elem::new(c1))
}

/// Since the powers of zeta used in the `NTT` and `MultiplyNTTs` are fixed, we use pre-computed
/// tables to avoid the need to compute the exponentiations at runtime.
///
/// * `ZETA_POW_BITREV[i] = zeta^{BitRev_7(i)}`
/// * `GAMMA[i] = zeta^{2 BitRev_7(i) + 1}`
///
/// Note that the const environment here imposes some annoying conditions.  Because operator
/// overloading can't be const, we have to do all the reductions here manually.  Because `for` loops
/// are forbidden in `const` functions, we do them manually with `while` loops.
///
/// The values computed here match those provided in Appendix A of FIPS 203.
/// `ZETA_POW_BITREV` corresponds to the first table, and `GAMMA` to the second table.
#[allow(clippy::integer_division_remainder_used, reason = "constant")]
const ZETA_POW_BITREV: [Elem; 128] = {
    const ZETA: u64 = 17;

    const fn bitrev7(x: usize) -> usize {
        ((x >> 6) % 2)
            | (((x >> 5) % 2) << 1)
            | (((x >> 4) % 2) << 2)
            | (((x >> 3) % 2) << 3)
            | (((x >> 2) % 2) << 4)
            | (((x >> 1) % 2) << 5)
            | ((x % 2) << 6)
    }

    // Compute the powers of zeta
    let mut pow = [Elem::new(0); 128];
    let mut i = 0;
    let mut curr = 1u64;

    while i < 128 {
        pow[i] = Elem::new((curr & 0xFFFF) as u16);
        i += 1;
        curr = (curr * ZETA) % BaseField::QLL;
    }

    // Reorder the powers according to bitrev7
    let mut pow_bitrev = [Elem::new(0); 128];
    let mut i = 0;
    while i < 128 {
        pow_bitrev[i] = pow[bitrev7(i)];
        i += 1;
    }
    pow_bitrev
};

#[allow(clippy::integer_division_remainder_used, reason = "constant")]
const GAMMA: [Elem; 128] = {
    const ZETA: u64 = 17;
    let mut gamma = [Elem::new(0); 128];
    let mut i = 0;
    while i < 128 {
        let zpr = ZETA_POW_BITREV[i].0 as u64;
        let g = (zpr * zpr * ZETA) % BaseField::QLL;
        gamma[i] = Elem::new((g & 0xFFFF) as u16);
        i += 1;
    }
    gamma
};

#[cfg(test)]
mod test {
    use super::{
        Array, B32, BaseField, Elem, Field, Int, Ntt, NttInverse, NttMatrix, NttPolynomial,
        NttVector, PRF, Polynomial, U256, XOF,
    };
    use array::{
        ArraySize, Flatten,
        typenum::{U2, U3, U8},
    };

    /// A polynomial with only a scalar component, to make simple test cases
    fn const_ntt(x: Int) -> NttPolynomial {
        let mut p = Polynomial::default();
        p.0[0] = Elem::new(x);
        p.ntt()
    }

    /// Multiplication in `R_q`, modulo X^256 + 1
    fn poly_mul(lhs: &Polynomial, rhs: &Polynomial) -> Polynomial {
        let mut out = Polynomial::default();
        for (i, x) in lhs.0.iter().enumerate() {
            for (j, y) in rhs.0.iter().enumerate() {
                let (sign, index) = if i + j < 256 {
                    (Elem::new(1), i + j)
                } else {
                    (Elem::new(BaseField::Q - 1), i + j - 256)
                };

                out.0[index] = out.0[index] + (sign * *x * *y);
            }
        }
        out
    }

    /// Transpose `NttMatrix`
    fn matrix_transpose<K: ArraySize>(matrix: &NttMatrix<K>) -> NttMatrix<K> {
        NttMatrix::new(Array::from_fn(|i| {
            NttVector::new(Array::from_fn(|j| matrix.0[j].0[i].clone()))
        }))
    }

    #[test]
    #[allow(clippy::cast_possible_truncation)]
    fn polynomial_ops() {
        let f = Polynomial::new(Array::from_fn(|i| Elem::new(i as Int)));
        let g = Polynomial::new(Array::from_fn(|i| Elem::new(2 * i as Int)));
        let sum = Polynomial::new(Array::from_fn(|i| Elem::new(3 * i as Int)));
        assert_eq!((&f + &g), sum);
        assert_eq!((&sum - &g), f);
        assert_eq!(Elem::new(3) * &f, sum);
    }

    #[test]
    #[allow(clippy::cast_possible_truncation, clippy::similar_names)]
    fn ntt() {
        let f = Polynomial::new(Array::from_fn(|i| Elem::new(i as Int)));
        let g = Polynomial::new(Array::from_fn(|i| Elem::new(2 * i as Int)));
        let f_hat = f.ntt();
        let g_hat = g.ntt();

        // Verify that NTT and NTT^-1 are actually inverses
        let f_unhat = f_hat.ntt_inverse();
        assert_eq!(f, f_unhat);

        // Verify that NTT is a homomorphism with regard to addition
        let fg = &f + &g;
        let f_hat_g_hat = &f_hat + &g_hat;
        let fg_unhat = f_hat_g_hat.ntt_inverse();
        assert_eq!(fg, fg_unhat);

        // Verify that NTT is a homomorphism with regard to multiplication
        let fg = poly_mul(&f, &g);
        let f_hat_g_hat = &f_hat * &g_hat;
        let fg_unhat = f_hat_g_hat.ntt_inverse();
        assert_eq!(fg, fg_unhat);
    }

    #[test]
    fn ntt_vector() {
        // Verify vector addition
        let v1: NttVector<U3> = NttVector::new(Array([const_ntt(1), const_ntt(1), const_ntt(1)]));
        let v2: NttVector<U3> = NttVector::new(Array([const_ntt(2), const_ntt(2), const_ntt(2)]));
        let v3: NttVector<U3> = NttVector::new(Array([const_ntt(3), const_ntt(3), const_ntt(3)]));
        assert_eq!((&v1 + &v2), v3);

        // Verify dot product
        assert_eq!((&v1 * &v2), const_ntt(6));
        assert_eq!((&v1 * &v3), const_ntt(9));
        assert_eq!((&v2 * &v3), const_ntt(18));

        // Verify inequality (catches PartialEq mutation that returns true unconditionally)
        assert_ne!(v1, v2);
        assert_ne!(v1, v3);
        assert_ne!(v2, v3);
    }

    #[test]
    fn ntt_matrix() {
        // Verify matrix multiplication by a vector
        let a: NttMatrix<U3> = NttMatrix::new(Array([
            NttVector::new(Array([const_ntt(1), const_ntt(2), const_ntt(3)])),
            NttVector::new(Array([const_ntt(4), const_ntt(5), const_ntt(6)])),
            NttVector::new(Array([const_ntt(7), const_ntt(8), const_ntt(9)])),
        ]));
        let v_in: NttVector<U3> = NttVector::new(Array([const_ntt(1), const_ntt(2), const_ntt(3)]));
        let v_out: NttVector<U3> =
            NttVector::new(Array([const_ntt(14), const_ntt(32), const_ntt(50)]));
        assert_eq!(&a * &v_in, v_out);

        // Verify transpose
        let aT = NttMatrix::new(Array([
            NttVector::new(Array([const_ntt(1), const_ntt(4), const_ntt(7)])),
            NttVector::new(Array([const_ntt(2), const_ntt(5), const_ntt(8)])),
            NttVector::new(Array([const_ntt(3), const_ntt(6), const_ntt(9)])),
        ]));
        assert_eq!(matrix_transpose(&a), aT);
    }

    // To verify the accuracy of sampling, we use a theorem related to the law of large numbers,
    // which bounds the convergence of the Kullback-Liebler distance between the empirical
    // distribution and the hypothesized distribution.
    //
    // Theorem (Cover & Thomas, 1991, Theorem 12.2.1): Let $X_1, \ldots, X_n$ be i.i.d. $~P(x)$.
    // Then:
    //
    //   Pr{ D(P_{x^n} || P) > \epsilon } \leq 2^{ -n ( \epsilon - |X|^{ log(n+1) / n } ) }
    //
    // So if we test by computing D(P_{x^n} || P) and requiring the value to be below a threshold
    // \epsilon, then an unbiased sampling should pass with overwhelming probability 1 - 2^{-k},
    // for some k based on \epsilon, |X|, and n.
    //
    // If we take k = 256 and n = 256, then we can solve for the required threshold \epsilon:
    //
    //   \epsilon = 1 + |X|^{ 0.03125 }
    //
    // For the cases we're interested in here:
    //
    //   CBD(eta = 2) => |X| = 5   => epsilon ~= 2.0516
    //   CBD(eta = 2) => |X| = 7   => epsilon ~= 2.0627
    //   Uniform byte => |X| = 256 => epsilon ~= 2.1892
    //
    // Taking epsilon = 2.05 makes us conservative enough in all cases, without significantly
    // increasing the probability of false negatives.
    const KL_THRESHOLD: f64 = 2.05;

    // The centered binomial distributions are calculated as:
    //
    //   bin_\eta(k) = (2\eta \choose k + \eta) 2^{-2\eta}
    //
    // for k in $-\eta, \ldots, \eta$.  The cases of interest here are \eta = 2, 3.
    type Distribution = [f64; Q_SIZE];
    const Q_SIZE: usize = BaseField::Q as usize;
    static CBD2: Distribution = {
        let mut dist = [0.0; Q_SIZE];
        dist[Q_SIZE - 2] = 1.0 / 16.0;
        dist[Q_SIZE - 1] = 4.0 / 16.0;
        dist[0] = 6.0 / 16.0;
        dist[1] = 4.0 / 16.0;
        dist[2] = 1.0 / 16.0;
        dist
    };
    static CBD3: Distribution = {
        let mut dist = [0.0; Q_SIZE];
        dist[Q_SIZE - 3] = 1.0 / 64.0;
        dist[Q_SIZE - 2] = 6.0 / 64.0;
        dist[Q_SIZE - 1] = 15.0 / 64.0;
        dist[0] = 20.0 / 64.0;
        dist[1] = 15.0 / 64.0;
        dist[2] = 6.0 / 64.0;
        dist[3] = 1.0 / 64.0;
        dist
    };
    static UNIFORM: Distribution = [1.0 / (BaseField::Q as f64); Q_SIZE];

    fn kl_divergence(p: &Distribution, q: &Distribution) -> f64 {
        p.iter()
            .zip(q.iter())
            .map(|(p, q)| if *p == 0.0 { 0.0 } else { p * (p / q).log2() })
            .sum()
    }

    #[allow(clippy::cast_precision_loss, clippy::large_stack_arrays)]
    fn test_sample(sample: &[Elem], ref_dist: &Distribution) {
        // Verify data and compute the empirical distribution
        let mut sample_dist: Distribution = [0.0; Q_SIZE];
        let bump: f64 = 1.0 / (sample.len() as f64);
        for x in sample {
            assert!(x.0 < BaseField::Q);
            assert!(ref_dist[x.0 as usize] > 0.0);

            sample_dist[x.0 as usize] += bump;
        }

        let d = kl_divergence(&sample_dist, ref_dist);
        assert!(d < KL_THRESHOLD);
    }

    #[test]
    #[allow(clippy::cast_possible_truncation)]
    fn sample_uniform() {
        // We require roughly Q/2 samples to verify the uniform distribution.  This is because for
        // M < N, the uniform distribution over a subset of M elements has KL distance:
        //
        //   M sum(p * log(q / p)) = log(q / p) = log(N / M)
        //
        // Since Q ~= 2^11 and 256 == 2^8, we need 2^3 == 8 runs of 256 to get out of the bad
        // regime and get a meaningful measurement.
        let rho = B32::default();
        let sample: Array<Array<Elem, U256>, U8> = Array::from_fn(|i| {
            let mut xof = XOF(&rho, 0, i as u8);
            super::sample_ntt(&mut xof).into()
        });

        test_sample(&sample.flatten(), &UNIFORM);
    }

    #[test]
    fn sample_poly_cbd() {
        // Eta = 2
        let sigma = B32::default();
        let prf_output = PRF::<U2>(&sigma, 0);
        let sample = super::sample_poly_cbd::<U2>(&prf_output).0;
        test_sample(&sample, &CBD2);

        // Eta = 3
        let sigma = B32::default();
        let prf_output = PRF::<U3>(&sigma, 0);
        let sample = super::sample_poly_cbd::<U3>(&prf_output).0;
        test_sample(&sample, &CBD3);
    }
}
