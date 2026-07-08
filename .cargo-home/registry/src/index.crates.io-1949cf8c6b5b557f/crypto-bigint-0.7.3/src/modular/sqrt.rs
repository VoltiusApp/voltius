use crate::{
    Choice, CtOption, Uint,
    modular::{FixedMontyForm, FixedMontyParams, prime_params::PrimeParams},
};

/// Compute a modular square root (if it exists) given [`MontyParams`]
/// and [`PrimeParams`] corresponding to `monty_value`, in Montgomery form.
#[must_use]
pub const fn sqrt_montgomery_form<const LIMBS: usize>(
    monty_value: &Uint<LIMBS>,
    monty_params: &FixedMontyParams<LIMBS>,
    prime_params: &PrimeParams<LIMBS>,
) -> CtOption<Uint<LIMBS>> {
    let value = FixedMontyForm::from_montgomery(*monty_value, monty_params);
    let b = value.pow_vartime(&prime_params.sqrt_exp);

    // Constant-time versions of modular square root algorithms based on:
    // Koo, N., Cho, G.H. and Kwon, S. (2013), "Square root algorithm in 𝔽q for q ≡ 2s + 1 (mod 2s+1)".
    // Electron. Lett., 49: 467-469. https://doi.org/10.1049/el.2012.4239

    let x = match prime_params.s.get() {
        1 => {
            // Shanks algorithm: sqrt = x^((p+1)/4) = x^(t+1)
            b
        }
        2 => {
            // Algorithm 3: p = 5 mod 8 (Atkins variant)
            let ru = FixedMontyForm::from_montgomery(prime_params.monty_root_unity, monty_params);
            let cb = value.mul(&b);
            let zeta = cb.mul(&b);
            let is_one = Uint::eq(zeta.as_montgomery(), monty_params.one());
            monty_select(&cb.mul(&ru), &cb, is_one)
        }
        3 => {
            // Algorithm 4: p = 9 mod 16
            let ru = FixedMontyForm::from_montgomery(prime_params.monty_root_unity, monty_params);
            let ru_2 =
                FixedMontyForm::from_montgomery(prime_params.monty_root_unity_p2, monty_params);
            let ru_3 = ru.mul(&ru_2);
            let cb = value.mul(&b);
            let zeta = cb.mul(&b);

            let mut m = monty_select(
                &ru,
                &FixedMontyForm::one(ru.params()),
                Uint::eq(zeta.as_montgomery(), monty_params.one()),
            );
            // m = ru^2 if zeta = -1
            m = monty_select(
                &m,
                &ru_2,
                Uint::eq(zeta.neg().as_montgomery(), monty_params.one()),
            );
            // m = ru^3 if zeta = ru^2
            m = monty_select(&m, &ru_3, monty_eq(&zeta, &ru_2));

            cb.mul(&m)
        }
        4 => {
            // Algorithm 5: p = 17 mod 32
            let ru = FixedMontyForm::from_montgomery(prime_params.monty_root_unity, monty_params);
            let ru_2 =
                FixedMontyForm::from_montgomery(prime_params.monty_root_unity_p2, monty_params);
            let ru_4 = ru_2.square();
            let ru_6 = ru_2.mul(&ru_4);
            let cb = value.mul(&b);
            let zeta = cb.mul(&b);

            let neg_zeta = zeta.neg();
            let zeta_b = monty_eq(&zeta, &ru_2);
            let neg_zeta_b = monty_eq(&neg_zeta, &ru_2);
            let zeta_d = monty_eq(&zeta, &ru_6);

            // m = B if -zeta in {B, C}, else 1
            let mut m = monty_select(
                &FixedMontyForm::one(ru.params()),
                &ru_2,
                neg_zeta_b.or(monty_eq(&neg_zeta, &ru_4)),
            );
            // m = C if zeta in {-1, D}
            m = monty_select(
                &m,
                &ru_4,
                Uint::eq(neg_zeta.as_montgomery(), monty_params.one()).or(zeta_d),
            );
            // m = D if zeta in {B, C}
            m = monty_select(&m, &ru_6, zeta_b.or(monty_eq(&zeta, &ru_4)));
            // m = m•ru if zeta or -zeta in {B, D}
            m = monty_select(
                &m,
                &m.mul(&ru),
                zeta_b
                    .or(zeta_d)
                    .or(neg_zeta_b)
                    .or(monty_eq(&neg_zeta, &ru_6)),
            );

            cb.mul(&m)
        }
        _ => {
            // Tonelli-Shanks
            let mut x = value.mul(&b);
            let mut d = x.mul(&b);
            let mut z =
                FixedMontyForm::from_montgomery(prime_params.monty_root_unity, monty_params);
            let mut v = prime_params.s.get();
            let mut max_v = v;

            while max_v >= 1 {
                let mut k = 1;
                let mut tmp = d.square();
                let mut j_less_than_v = Choice::TRUE;

                let mut j = 2;
                while j < max_v {
                    let tmp_is_one = Uint::eq(tmp.as_montgomery(), monty_params.one());
                    let squared = monty_select(&tmp, &z, tmp_is_one).square();
                    tmp = monty_select(&squared, &tmp, tmp_is_one);
                    j_less_than_v = j_less_than_v.and(Choice::from_u32_eq(j, v).not());
                    z = monty_select(&z, &squared, tmp_is_one.and(j_less_than_v));
                    k = tmp_is_one.select_u32(j, k);
                    j += 1;
                }

                let b_is_one = Uint::eq(d.as_montgomery(), monty_params.one());
                x = monty_select(&x.mul(&z), &x, b_is_one);
                z = z.square();
                d = d.mul(&z);
                v = k;
                max_v -= 1;
            }

            x
        }
    };

    CtOption::new(x.to_montgomery(), monty_eq(&x.square(), &value))
}

const fn monty_eq<const LIMBS: usize>(
    a: &FixedMontyForm<LIMBS>,
    b: &FixedMontyForm<LIMBS>,
) -> Choice {
    Uint::eq(a.as_montgomery(), b.as_montgomery())
}

const fn monty_select<const LIMBS: usize>(
    a: &FixedMontyForm<LIMBS>,
    b: &FixedMontyForm<LIMBS>,
    c: Choice,
) -> FixedMontyForm<LIMBS> {
    FixedMontyForm::from_montgomery(
        Uint::select(a.as_montgomery(), b.as_montgomery(), c),
        a.params(),
    )
}

#[cfg(test)]
mod tests {
    use super::sqrt_montgomery_form;
    use crate::{
        Odd, U256, U576, Uint,
        modular::{FixedMontyForm, FixedMontyParams, PrimeParams},
    };

    fn root_of_unity<const LIMBS: usize>(
        monty_params: &FixedMontyParams<LIMBS>,
        prime_params: &PrimeParams<LIMBS>,
    ) -> Uint<LIMBS> {
        FixedMontyForm::from_montgomery(prime_params.monty_root_unity, monty_params).retrieve()
    }

    fn test_monty_sqrt<const LIMBS: usize>(
        monty_params: FixedMontyParams<LIMBS>,
        prime_params: PrimeParams<LIMBS>,
    ) {
        let modulus = monty_params.modulus.get();
        let rounds = if cfg!(miri) { 1..=2 } else { 0..=256 };
        for i in rounds {
            let s = i * i;
            let s_monty = FixedMontyForm::new(&Uint::from_u32(s), &monty_params);
            let rt_monty =
                sqrt_montgomery_form(s_monty.as_montgomery(), &monty_params, &prime_params)
                    .expect("no sqrt found");
            let rt = FixedMontyForm::from_montgomery(rt_monty, &monty_params).retrieve();
            let i = Uint::from_u32(i);
            assert!(
                Uint::eq(&rt, &i)
                    .or(Uint::eq(&rt, &modulus.wrapping_sub(&i)))
                    .to_bool_vartime()
            );
        }

        // generator must be non-residue
        let generator = Uint::from_u32(prime_params.generator.get());
        let gen_monty = FixedMontyForm::new(&generator, &monty_params);
        assert!(
            sqrt_montgomery_form(gen_monty.as_montgomery(), &monty_params, &prime_params)
                .is_none()
                .to_bool_vartime()
        );
    }

    #[test]
    fn mod_sqrt_s_1() {
        // p = 3 mod 4, s = 1
        // P-256 field modulus
        let monty_params = FixedMontyParams::new_vartime(Odd::<U256>::from_be_hex(
            "ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
        ));
        let prime_params = PrimeParams::new_vartime(&monty_params, 6);
        assert_eq!(prime_params.s.get(), 1);
        assert_eq!(prime_params.generator.get(), 6);
        assert_eq!(
            root_of_unity(&monty_params, &prime_params),
            U256::from_be_hex("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFE")
        );

        test_monty_sqrt(monty_params, prime_params);
    }

    #[test]
    fn mod_sqrt_s_2() {
        // p = 5 mod 8, s = 2
        // ed25519 base field
        let monty_params = FixedMontyParams::new_vartime(Odd::<U256>::from_be_hex(
            "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed",
        ));
        let prime_params = PrimeParams::new_vartime(&monty_params, 2);
        assert_eq!(prime_params.s.get(), 2);
        assert_eq!(prime_params.generator.get(), 2);
        assert_eq!(
            root_of_unity(&monty_params, &prime_params),
            U256::from_be_hex("2B8324804FC1DF0B2B4D00993DFBD7A72F431806AD2FE478C4EE1B274A0EA0B0")
        );

        test_monty_sqrt(monty_params, prime_params);
    }

    #[test]
    fn mod_sqrt_s_3() {
        // p = 9 mod 16, s = 3
        // brainpoolP384 scalar field
        let monty_params = FixedMontyParams::new_vartime(Odd::<U576>::from_be_hex(
            "00000000000001fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409",
        ));
        let prime_params = PrimeParams::new_vartime(&monty_params, 3);
        assert_eq!(prime_params.s.get(), 3);
        assert_eq!(prime_params.generator.get(), 3);
        assert_eq!(
            root_of_unity(&monty_params, &prime_params),
            U576::from_be_hex(
                "000000000000009a0a650d44b28c17f3d708ad2fa8c4fbc7e6000d7c12dafa92fcc5673a3055276d535f79ff391dcdbcd998b7836647d3a72472b3da861ac810a7f9c7b7b63e2205"
            )
        );

        test_monty_sqrt(monty_params, prime_params);
    }

    #[test]
    fn mod_sqrt_s_4() {
        // p = 17 mod 32, s = 4
        // P-256 scalar field
        let monty_params = FixedMontyParams::new_vartime(Odd::<U256>::from_be_hex(
            "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
        ));
        let prime_params = PrimeParams::new_vartime(&monty_params, 7);
        assert_eq!(prime_params.s.get(), 4);
        assert_eq!(prime_params.generator.get(), 7);
        assert_eq!(
            root_of_unity(&monty_params, &prime_params),
            U256::from_be_hex("ffc97f062a770992ba807ace842a3dfc1546cad004378daf0592d7fbb41e6602")
        );

        test_monty_sqrt(monty_params, prime_params);
    }

    #[test]
    fn mod_sqrt_s_6() {
        // s = 6
        // K-256 scalar field
        let monty_params = FixedMontyParams::new_vartime(Odd::<U256>::from_be_hex(
            "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
        ));
        let prime_params = PrimeParams::new_vartime(&monty_params, 7);
        assert_eq!(prime_params.s.get(), 6);
        assert_eq!(prime_params.generator.get(), 7);
        assert_eq!(
            root_of_unity(&monty_params, &prime_params),
            U256::from_be_hex("0C1DC060E7A91986DF9879A3FBC483A898BDEAB680756045992F4B5402B052F2")
        );

        test_monty_sqrt(monty_params, prime_params);
    }
}
