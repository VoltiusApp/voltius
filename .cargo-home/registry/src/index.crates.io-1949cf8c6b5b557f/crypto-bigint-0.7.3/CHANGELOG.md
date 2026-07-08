# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.7.3 (2026-03-25)
### Added
- `#[inline]` attributes for shift and wrapping arithmetic ops ([#1229])
- `MontyForm::{is_zero, is_one}` methods ([#1230])
- `Gcd` supertrait bound to `Unsigned`/`Signed` traits ([#1231])

### Changed
- Define `Uint` division traits generically ([#1232])
- Use generic implementation of bit operations for `Wrapping` ([#1235])
- Explicitly seal `MontyForm` ([#1237])

[#1229]: https://github.com/RustCrypto/crypto-bigint/pull/1229
[#1230]: https://github.com/RustCrypto/crypto-bigint/pull/1230
[#1231]: https://github.com/RustCrypto/crypto-bigint/pull/1231
[#1232]: https://github.com/RustCrypto/crypto-bigint/pull/1232
[#1235]: https://github.com/RustCrypto/crypto-bigint/pull/1235
[#1237]: https://github.com/RustCrypto/crypto-bigint/pull/1237

## 0.7.2 (2026-03-20)
### Added
- `Invert` to `MontyForm` supertraits ([#1226])

### Changed
- BREAKING: seal the `Integer` trait ([#1227])

[#1226]: https://github.com/RustCrypto/crypto-bigint/pull/1226
[#1227]: https://github.com/RustCrypto/crypto-bigint/pull/1227

## 0.7.1 (2026-03-10) [YANKED]

NOTE: this release, like v0.7.0, was yanked due to last-minute breaking changes, namely sealing the
`Integer` trait ([#1227]), which is technically a breaking change but one we do not expect will
have any user-facing impact. 

### Added
- `Uint::{concat_resize, concat_checked, split_resize, split_checked}` methods ([#1223])

### Changed
- `PrimeParams` now requires a multiplicative generator value ([#1221])
- Improve performance of Monty `pow`/`pow_vartime` ([#1222])

[#1221]: https://github.com/RustCrypto/crypto-bigint/pull/1221
[#1222]: https://github.com/RustCrypto/crypto-bigint/pull/1222
[#1223]: https://github.com/RustCrypto/crypto-bigint/pull/1223

## 0.7.0 (2026-03-08) [YANKED]

NOTE: this release was yanked due to some last minute breaking-changes introduced in v0.7.1,
namely an additional parameter added to `const_prime_monty_params!` / `PrimeParams`.

### Added
- Binary GCD algorithm ([#755])
- Provide `RandomMod::try_random_mod` and `Random::try_random` methods ([#770])
- `Monty::div_by_2_assign()` ([#777])
- `BoxedUint::inv_mod2k_vartime()` ([#777])
- `BoxedUint::inv_mod2k()` ([#777])
- `Monty::Multiplier` ([#777])
- `serde` support for BoxedUint ([#789])
- `Binary`, `LowerHex`, and `UpperHex` bounds for `Integer` ([#792])
- `DivVartime` trait ([#800])
- `PartialOrd<Uint>` impl for `BoxedUint` ([#803])
- `UintRef` type ([#806], [#1114])
- `Resize` trait ([#809])
- `Invert::invert_vartime` method ([#814])
- `From<Odd>` for `NonZero` impl ([#821])
- `BoxedUint::{to_be_bytes_trimmed, to_le_bytes_trimmed}` ([#824])
- `BoxedUint::{from_be_slice_vartime, from_le_slice_vartime}` ([#833])
- `Int::to_uint` and `Uint::to_int` ([#837])
- `NonZero` and `Odd` type aliases ([#844])
  - `NonZeroUint`/`OddUint`
  - `NonZeroBoxedUint`/`OddBoxedUint`
  - `NonZeroInt`/`OddInt` ([#845])
- `NonZeroInt::new_unwrap` ([#857])
- Classic Binary Extended GCD algorithm ([#854])
- `Xgcd` trait ([#855])
- `Uint::rem_wide` ([#896])
- `Reduce` trait ([#887], [#906])
- `SquareMod` trait ([#915])
- `JacobiSymbol` calculation ([#927])
- `NonZero::<Uint>::{from_be_hex, from_le_hex}` ([#928])
- `Signed` and `Unsigned` marker traits ([#942])
- `Int::wrapping_mul` ([#946])
- `One` trait ala `Zero` ([#947])
- `MontyParams::{one, r2}` accessor methods ([#948])
- Optimized Binary Extended GCD a.k.a. binxgcd ([#945])
- `ConstMontyForm::MODULUS` constant ([#982])
- `Uint::lcm` method ([#1028])
- `getrandom` feature with `Random` trait support ([#1057])
- `NonZero::get_copy`/`Odd::get_copy` ([#1072])
- Checked and wrapping exponentiation methods for `Uint` ([#1081])
- `CheckedSquareRoot` trait ([#1083])
- `BoxedUint::pow_mod` method ([#1084])
- `BoxedUint::concatenating_add` method ([#1090])
- `BoxedUint::overflowing_add` method ([#1091])
- Extra sizes `U8320` and `U12288` ([#1101])
- `Limb::array_as_(mut_)words`/`slice_as_(mut_)words` ([#1103])
- `Uint::{floor_root_vartime, checked_root_vartime}` ([#1089])
- `(Const)MontyForm::pow_vartime` ([#1118])
- `(Const)MontyForm::square_repeat_vartime` method ([#1122])
- `ToOwned<Owned = BoxedUint>` impl for `UintRef` ([#1128])
- `BoxedUint` exponentiation methods: `wrapping_pow`, `wrapping_pow_bounded_exp`,
  `wrapped_pow_vartime` as well as `checked_*`/`saturating_*` equivalents ([#1159])
- Division and remainder operations for `Limb` ([#1162])
- Implement `Integer` and `Unsigned` for `Limb` ([#1174])
- Mixed-size comparisons for `Integer` types ([#1184])
- `MontyParams` getter methods ([#1188])
- `Uint::resize_checked` method ([#1194])
- `const_prime_monty_params!` macro and `PrimeParams` trait ([#1139])
- `ConcatenatingSquare` trait ([#1208])

### Changed
- Bump `der` to v0.8 ([#763], [#1206])
- Bump edition to 2024; MSRV 1.85 ([#772])
- Bound `Monty` on `Retrieve` ([#797])
- `Uint::div`/`Int::div` now accept differently sized denominators ([#799])
- Rename `as_(limbs|words)_mut` => `as_mut_(limbs|words)` ([#805])
- Inversion method naming: ([#816])
  - `inv()` -> `invert()`,
  - `inv_mod()` -> `invert_mod()`,
  - `InvMod` -> `InvertMod`
  - `inv_odd_mod()` -> `invert_odd_mod()`
  - `inv_mod2k()` -> `invert_mod2k()`
- Adopt `core` naming conventions for bigint methods ([#817])
  - Rename `WideningMul` -> `ConcatenatingMul`, `widening_mul()` -> `concatenating_mul()`
  - Rename `mul_wide()`/`split_mul()` -> `widening_mul()`
  - Rename `adc()` -> `carrying_add()`
  - Rename `sbb()` -> `borrowing_sub()`
  - Rename `mac()` -> `carrying_mul_add()` and change the order of arguments to match `core`
- Rename `impl_modulus!` => `const_monty_params!` ([#861])
- Unify `ConstMontyParams` and `MontyParams` ([#873])
- `BoxedUint::div_rem` now accepts mixed sized inputs ([#902])
- `const_monty_form!` now defines a type alias ([#909])
- Modular operations now accept a `NonZero` modulus ([#914])
- Simplify `Uint::add_mod`, `Uint::double_mod` ([#917])
- `Uint::double_mod` now requires a `NonZero` modulus ([#917])
- Bump `hybrid-array` to v0.4 ([#934])
- Implement `Encoding` for all `Uint`s ([#1016], [#1064])
- Rename `random_mod` -> `random_mod_vartime` ([#1030])
- Replace `subtle` with `ctutils`:
  - Replace `ConstChoice` with `ctutils::Choice` ([#1035])
  - Replace `ConstCtOption` with `ctutils::CtOption` ([#1040])
  - Replace `ConstantTimeSelect` with `ctutils::CtSelect` ([#1043])
  - Replace `ConstantTimeEq` with `CtEq` in trait bounds ([#1048])
  - Bound `Integer` on `CtGt`/`CtLt` ([#1049])
- Rename `rand` feature to `rand_core` ([#1058])
- Have `BoxedMontyForm::new` auto-`Clone` its params ([#1087])
- Rename `SquareRoot` trait to `FloorSquareRoot` ([#1083])
- Use `core` convention for mixed-sign op names ([#1092])
  - `{unsigned}::*_signed` for ops that take `{signed}` RHS operand
  - `{signed}::*_unsigned` for ops that take `{unsigned}` RHS operand
- Make vartime bit shifts return an `Option` instead of `CtOption` ([#1096])
- Make vartime inversion return an `Option` instead of `CtOption` ([#1097])
- Unified `MontyParams` ([#1107])
- Have `Monty::zero` and `Monty::one` borrow params ([#1140])
- Rename `MontyForm` -> `FixedMontyForm` ([#1145])
- Split `UnsignedWithMontyForm` out of `Unsigned` ([#1156], [#1189])
- Bump `rand_core` to v0.10 ([#1165])
- Wrapping shifts renamed to unbounded shifts to follow `core` semantics ([#1160])
- Replace `nlimbs!` macro with `const fn nlimbs()` ([#1169])
- Use `cpubits` crate for 32-bit vs 64-bit selection ([#1170])
- More flexible `BoxedUint` addition, subtraction, multiplication ([#1177])
- Lighter-weight support for `Uint` concat/split operations ([#1191])
- Deprecate `Uint:{square, square_wide}` in favor of `concatenating_square` ([#1207])
- Deprecate `BoxedUint::{mul, square}` in favor of concatenating mul/square ([#1208])

### Fixed
- Make `random_bits_core` platform independent ([#781], [#1010], [#1026])
- `Default` impl for `Odd` ([#1071])
- `NonZero::from_le_byte_array` ([#1211])

### Removed
- `PrecomputedInverter` and `Inverter` traits ([#894])
- `BoxedMontyFormInverter` ([#897])
- `*SafeGcdInverter` ([#898])
- `modular::montgomery_reduction` ([#900])
- `ConstMontyParams::inverter` ([#907])
- `ConstMontyFormInverter` ([#908])

[#755]: https://github.com/RustCrypto/crypto-bigint/pull/755
[#763]: https://github.com/RustCrypto/crypto-bigint/pull/763
[#770]: https://github.com/RustCrypto/crypto-bigint/pull/770
[#772]: https://github.com/RustCrypto/crypto-bigint/pull/772
[#777]: https://github.com/RustCrypto/crypto-bigint/pull/777
[#781]: https://github.com/RustCrypto/crypto-bigint/pull/781
[#789]: https://github.com/RustCrypto/crypto-bigint/pull/789
[#792]: https://github.com/RustCrypto/crypto-bigint/pull/792
[#797]: https://github.com/RustCrypto/crypto-bigint/pull/797
[#799]: https://github.com/RustCrypto/crypto-bigint/pull/799
[#800]: https://github.com/RustCrypto/crypto-bigint/pull/800
[#803]: https://github.com/RustCrypto/crypto-bigint/pull/803
[#805]: https://github.com/RustCrypto/crypto-bigint/pull/805
[#806]: https://github.com/RustCrypto/crypto-bigint/pull/806
[#809]: https://github.com/RustCrypto/crypto-bigint/pull/809
[#814]: https://github.com/RustCrypto/crypto-bigint/pull/814
[#816]: https://github.com/RustCrypto/crypto-bigint/pull/816
[#817]: https://github.com/RustCrypto/crypto-bigint/pull/817
[#821]: https://github.com/RustCrypto/crypto-bigint/pull/821
[#824]: https://github.com/RustCrypto/crypto-bigint/pull/824
[#833]: https://github.com/RustCrypto/crypto-bigint/pull/833
[#837]: https://github.com/RustCrypto/crypto-bigint/pull/837
[#844]: https://github.com/RustCrypto/crypto-bigint/pull/844
[#845]: https://github.com/RustCrypto/crypto-bigint/pull/845
[#854]: https://github.com/RustCrypto/crypto-bigint/pull/854
[#855]: https://github.com/RustCrypto/crypto-bigint/pull/855
[#857]: https://github.com/RustCrypto/crypto-bigint/pull/857
[#861]: https://github.com/RustCrypto/crypto-bigint/pull/861
[#873]: https://github.com/RustCrypto/crypto-bigint/pull/873
[#887]: https://github.com/RustCrypto/crypto-bigint/pull/887
[#894]: https://github.com/RustCrypto/crypto-bigint/pull/894
[#896]: https://github.com/RustCrypto/crypto-bigint/pull/896
[#897]: https://github.com/RustCrypto/crypto-bigint/pull/897
[#898]: https://github.com/RustCrypto/crypto-bigint/pull/898
[#900]: https://github.com/RustCrypto/crypto-bigint/pull/900
[#902]: https://github.com/RustCrypto/crypto-bigint/pull/902
[#906]: https://github.com/RustCrypto/crypto-bigint/pull/906
[#907]: https://github.com/RustCrypto/crypto-bigint/pull/907
[#908]: https://github.com/RustCrypto/crypto-bigint/pull/908
[#909]: https://github.com/RustCrypto/crypto-bigint/pull/909
[#914]: https://github.com/RustCrypto/crypto-bigint/pull/914
[#915]: https://github.com/RustCrypto/crypto-bigint/pull/915
[#917]: https://github.com/RustCrypto/crypto-bigint/pull/917
[#927]: https://github.com/RustCrypto/crypto-bigint/pull/927
[#928]: https://github.com/RustCrypto/crypto-bigint/pull/928
[#934]: https://github.com/RustCrypto/crypto-bigint/pull/934
[#942]: https://github.com/RustCrypto/crypto-bigint/pull/942
[#945]: https://github.com/RustCrypto/crypto-bigint/pull/945
[#946]: https://github.com/RustCrypto/crypto-bigint/pull/946
[#947]: https://github.com/RustCrypto/crypto-bigint/pull/947
[#948]: https://github.com/RustCrypto/crypto-bigint/pull/948
[#982]: https://github.com/RustCrypto/crypto-bigint/pull/982
[#1010]: https://github.com/RustCrypto/crypto-bigint/pull/1010
[#1016]: https://github.com/RustCrypto/crypto-bigint/pull/1016
[#1026]: https://github.com/RustCrypto/crypto-bigint/pull/1026
[#1028]: https://github.com/RustCrypto/crypto-bigint/pull/1028
[#1030]: https://github.com/RustCrypto/crypto-bigint/pull/1030
[#1035]: https://github.com/RustCrypto/crypto-bigint/pull/1035
[#1040]: https://github.com/RustCrypto/crypto-bigint/pull/1040
[#1043]: https://github.com/RustCrypto/crypto-bigint/pull/1043
[#1048]: https://github.com/RustCrypto/crypto-bigint/pull/1048
[#1049]: https://github.com/RustCrypto/crypto-bigint/pull/1049
[#1057]: https://github.com/RustCrypto/crypto-bigint/pull/1057
[#1058]: https://github.com/RustCrypto/crypto-bigint/pull/1058
[#1064]: https://github.com/RustCrypto/crypto-bigint/pull/1064
[#1071]: https://github.com/RustCrypto/crypto-bigint/pull/1071
[#1072]: https://github.com/RustCrypto/crypto-bigint/pull/1072
[#1081]: https://github.com/RustCrypto/crypto-bigint/pull/1081
[#1083]: https://github.com/RustCrypto/crypto-bigint/pull/1083
[#1084]: https://github.com/RustCrypto/crypto-bigint/pull/1084
[#1087]: https://github.com/RustCrypto/crypto-bigint/pull/1087
[#1089]: https://github.com/RustCrypto/crypto-bigint/pull/1089
[#1090]: https://github.com/RustCrypto/crypto-bigint/pull/1090
[#1091]: https://github.com/RustCrypto/crypto-bigint/pull/1091
[#1092]: https://github.com/RustCrypto/crypto-bigint/pull/1092
[#1096]: https://github.com/RustCrypto/crypto-bigint/pull/1096
[#1097]: https://github.com/RustCrypto/crypto-bigint/pull/1097
[#1101]: https://github.com/RustCrypto/crypto-bigint/pull/1101
[#1103]: https://github.com/RustCrypto/crypto-bigint/pull/1103
[#1107]: https://github.com/RustCrypto/crypto-bigint/pull/1107
[#1114]: https://github.com/RustCrypto/crypto-bigint/pull/1114
[#1118]: https://github.com/RustCrypto/crypto-bigint/pull/1118
[#1122]: https://github.com/RustCrypto/crypto-bigint/pull/1122
[#1128]: https://github.com/RustCrypto/crypto-bigint/pull/1128
[#1139]: https://github.com/RustCrypto/crypto-bigint/pull/1139
[#1140]: https://github.com/RustCrypto/crypto-bigint/pull/1140
[#1145]: https://github.com/RustCrypto/crypto-bigint/pull/1145
[#1156]: https://github.com/RustCrypto/crypto-bigint/pull/1156
[#1159]: https://github.com/RustCrypto/crypto-bigint/pull/1159
[#1160]: https://github.com/RustCrypto/crypto-bigint/pull/1160
[#1162]: https://github.com/RustCrypto/crypto-bigint/pull/1162
[#1165]: https://github.com/RustCrypto/crypto-bigint/pull/1165
[#1169]: https://github.com/RustCrypto/crypto-bigint/pull/1169
[#1170]: https://github.com/RustCrypto/crypto-bigint/pull/1170
[#1174]: https://github.com/RustCrypto/crypto-bigint/pull/1174
[#1177]: https://github.com/RustCrypto/crypto-bigint/pull/1177
[#1184]: https://github.com/RustCrypto/crypto-bigint/pull/1184
[#1188]: https://github.com/RustCrypto/crypto-bigint/pull/1188
[#1189]: https://github.com/RustCrypto/crypto-bigint/pull/1189
[#1191]: https://github.com/RustCrypto/crypto-bigint/pull/1191
[#1194]: https://github.com/RustCrypto/crypto-bigint/pull/1194
[#1206]: https://github.com/RustCrypto/crypto-bigint/pull/1206
[#1207]: https://github.com/RustCrypto/crypto-bigint/pull/1207
[#1208]: https://github.com/RustCrypto/crypto-bigint/pull/1208
[#1211]: https://github.com/RustCrypto/crypto-bigint/pull/1211

## 0.6.1 (2025-02-14)
### Added
- `?Sized` to all RngCore bounds ([#760])

### Changed
- Make `as_limbs_mut` const ([#757])
- Impl `RemMixed` for even splits as well ([#791])
- Make `Integer` be `fmt::Binary`, `LowerHex`, and `UpperHex` ([#792])

[#757]: https://github.com/RustCrypto/crypto-bigint/pull/757
[#760]: https://github.com/RustCrypto/crypto-bigint/pull/760
[#791]: https://github.com/RustCrypto/crypto-bigint/pull/791
[#792]:https://github.com/RustCrypto/crypto-bigint/pull/792

## 0.6.0 (2025-01-22)
### Added
- `TryFrom<&[u8]>` bound on `Encoding::Repr` ([#261])
- New `Uint` functionality:
  - New methods: `bitand_limb` ([#322]), `gcd` ([#472]), `from_str_radix_vartime` ([#603]),
    `to_string_radix_vartime` ([#659])
  - New trait impls: `MulMod` ([#313]), `Div`/`Rem` ([#720])
- New `BoxedUint` functionality:
  - New methods: `sbb`/`wrapping_sub`/`checked_sub` ([#303]), `mul` ([#306]),
    `from_be_slice`/`from_le_slice` ([#307]), `to_be_bytes`/`to_le_bytes` ([#308]),
    `bits` ([#328]), `conditional_select` ([#329]), `shl_vartime` ([#330]), `shr_vartime` ([#331]),
    `rem_vartime` ([#332]), `inv_mod2k`/`bitor` ([#334]), `pow` ([#337]), `inv_mod` ([#341]),
    `random` ([#349]), `cond_map`/`cond_and_then` ([#352]), `map_limbs` ([#357]),
    `div_rem`/`rem` ([#398]), `new_with_arc` ([#407]), `gcd` ([#497]),
    `from_str_radix_vartime` ([#603]), `to_string_radix_vartime` ([#659])
  - New trait impls: `BitAnd*` ([#314]), `ConstantTimeGreater/Less`/`PartialOrd/Ord` ([#316]),
    `AddMod` ([#317]), `SubMod` ([#320]), `Hash`/`BoxedUint` ([#350]),
    `MulMod`/`BoxedUint` ([#343]), `RandomMod` ([#349]), `Rem` ([#356]), `BitNot`/`BitXor` ([#358]),
    `CheckedMul`/`Mul` ([#361]), `NegMod` ([#362]), `Div` ([#366]), `Integer` ([#367])
  - Montgomery multiplication support ([#323])
- New traits: `FixedInteger` ([#363]), `CheckedDiv` ([#369]), `WideningMul` ([#371]),
  `ConstantTimeSelect` ([#454]), `SquareAssign` ([#431]), `Gcd` ([#499]),
  `DivRemLimb`/`RemLimb` ([#496]), `InvMod` ([#505], [#741]), `SquareRoot` ([#508]),
  `BitOperations` ([#507]), `ShrVartime`/`ShlVartime` ([#509]), `RandomBits` ([#510]),
  `RemMixed` ([#746])
- `num-traits` impls: `Wrapping*` ([#425]), `Zero`/`One` ([#433]), `ConstZero` ([#573]),
  `Num` ([#720])
- safegcd (Bernstein-Yang) GCD + inv mod algorithm ([#372], [#493], [#632], [#635], [#655])
- Constant-time square root and division ([#376])
- Implement `Zeroize` for `NonZero` wrapper ([#406])
- `Zero::set_zero` method ([#426])
- `Inverter`/`PrecomputeInverter` traits ([#438], [#444])
- Uint: `const fn` encoders ([#453])
- Traits to connect integers and Montgomery form representations ([#431]):
  - `Integer::Monty` associated type
  - `Monty` trait with arithmetic bounds and an associated `Monty::Integer` type
- `Odd` wrapper type ([#487])
- `NonZero::new_unwrap` ([#602])
- Implement Karatsuba multiplication for `Uint` and `BoxedUint` ([#649])
- Efficient linear combination for Montgomery forms ([#666])
- Doc comment support for `impl_modulus!` ([#676])
- `core::error::Error` support ([#680])
- `Int` type providing initial signed integer support using two's complement ([#695], [#730])
- Variable-time modular inversion support ([#731])

### Changed
- Toplevel `modular` module now contains all modular functionality ([#300], [#324])
- `Integer` trait: expand bounds to include `*Mod` ([#318]), `Add`/`Sub`/`Mul` ([#435]),
  `RemAssign` ([#709]), `AddAssign`/`MulAssign`/`SubAssign` ([#716])
- `Integer` trait: add new methods `bits(_vartime)`/`leading_zeros` ([#368]),
  `from_limb_like/`one_like`/`zero_like` ([#533])
- Replace `BoxedUint::new` with `::zero_with_precision` ([#327])
- Split `Zero` trait into `Zero` + `ZeroConstant` ([#335])
- Refactor `Integer` trait; add `Constants`/`LimbsConstant` ([#355])
  - The existing `Bounded` trait subsumes `BITS`/`BYTES`
  - `Constants` provides `ONE` and `MAX`
  - `LimbsConstant` provides `LIMBS`
- Rename `BoxedUint::mul_wide` to `mul` ([#359])
- Round up `bits_precision` when creating `BoxedUint` ([#365])
- Make bit ops use `u32` for shifts and bit counts ([#373])
- Align with `core`/`std` on overflow behavior for bit shifts ([#395])
- Make `inv_mod2k(_vartime)` return a `CtChoice` ([#416])
- Rename `CtChoice` to `ConstChoice` ([#417])
- Make division methods take `NonZero`-wrapped divisors ([#419])
- Align with `core`/`std` on `overflowing_sh*` for functions which return an overflow flag ([#430])
- `Uint`: rename `HLIMBS` to `RHS_LIMBS` ([#432])
- Bring `Checked*` traits in line with `Wrapping*` ([#434])
- Rename `*Residue*` types i.e. Montgomery form representations ([#485]):
  - `Residue` -> `ConstMontyForm`
  - `DynResidue` -> `MontyForm`
  - `BoxedResidue` -> `BoxedMontyForm`
  - `*ResidueParams` -> `*MontyParams`
  - `residue_params` -> `params`
  - `params.r` -> `params.one`
- Make `Monty::new_params()` take an `Odd`-wrapped modulus ([#488])
- Expand `Uint` support for `const fn`: `square` ([#514]), `widening_mul` ([#515]),
  `to_le_bytes` ([#555])
- Have `(Boxed)MontyParams::modulus` return `&Odd<_>` ([#517])
- Split `MontyParams::new` and `new_vartime` ([#516], [#518])
- Reverse `Concat(Mixed)`/`Split(Mixed)` argument ordering ([#526])
- Migrate from `generic-array` to `hybrid-array` ([#544])
- Replace `ZeroConstant` with `ConstZero` trait from `num-traits` ([#546], [#573])
- Change `Uint::concat_mixed` and `split_mixed` to accept `self`; make `pub` ([#556], [#558])
- Make `Uint::concat` and `split` const generic over inputs ([#557], [#558])
- Split `Uint::mul_mod` and `Uint::mul_mod_vartime` ([#623])
- Faster constant-time division ([#643])
- `BoxedMontyForm`: always use `Arc` for `params` ([#645])
- Leverage `const_mut_refs`; MSRV 1.83 ([#667])
- Bump `rlp` dependency from 0.5 to 0.6 ([#673])
- Require `RngCore` instead of `CryptoRngCore` for various random methods ([#710])
- Bump `serdect` dependency to v0.3 ([#719])
- Have `rand` feature enable `rand_core/getrandom` instead of `rand_core/std` ([#745])

### Fixed
- Argument ordering to `BoxedUint::chain` ([#315])
- Modulus leading zeros calculation for `MontyForm`/`BoxedMontyForm` ([#713])

### Removed
- `ct_*` prefixes from method names since we're constant-time by default ([#417])
- `const_assert_*` macros ([#452], [#690])

[#261]: https://github.com/RustCrypto/crypto-bigint/pull/261
[#300]: https://github.com/RustCrypto/crypto-bigint/pull/300
[#303]: https://github.com/RustCrypto/crypto-bigint/pull/303
[#306]: https://github.com/RustCrypto/crypto-bigint/pull/306
[#307]: https://github.com/RustCrypto/crypto-bigint/pull/307
[#308]: https://github.com/RustCrypto/crypto-bigint/pull/308
[#313]: https://github.com/RustCrypto/crypto-bigint/pull/313
[#314]: https://github.com/RustCrypto/crypto-bigint/pull/314
[#315]: https://github.com/RustCrypto/crypto-bigint/pull/315
[#316]: https://github.com/RustCrypto/crypto-bigint/pull/316
[#317]: https://github.com/RustCrypto/crypto-bigint/pull/317
[#318]: https://github.com/RustCrypto/crypto-bigint/pull/318
[#320]: https://github.com/RustCrypto/crypto-bigint/pull/320
[#322]: https://github.com/RustCrypto/crypto-bigint/pull/322
[#323]: https://github.com/RustCrypto/crypto-bigint/pull/323
[#324]: https://github.com/RustCrypto/crypto-bigint/pull/324
[#327]: https://github.com/RustCrypto/crypto-bigint/pull/327
[#328]: https://github.com/RustCrypto/crypto-bigint/pull/328
[#329]: https://github.com/RustCrypto/crypto-bigint/pull/329
[#330]: https://github.com/RustCrypto/crypto-bigint/pull/330
[#331]: https://github.com/RustCrypto/crypto-bigint/pull/331
[#332]: https://github.com/RustCrypto/crypto-bigint/pull/332
[#334]: https://github.com/RustCrypto/crypto-bigint/pull/334
[#335]: https://github.com/RustCrypto/crypto-bigint/pull/335
[#337]: https://github.com/RustCrypto/crypto-bigint/pull/337
[#341]: https://github.com/RustCrypto/crypto-bigint/pull/341
[#343]: https://github.com/RustCrypto/crypto-bigint/pull/343
[#349]: https://github.com/RustCrypto/crypto-bigint/pull/349
[#350]: https://github.com/RustCrypto/crypto-bigint/pull/350
[#352]: https://github.com/RustCrypto/crypto-bigint/pull/352
[#355]: https://github.com/RustCrypto/crypto-bigint/pull/355
[#356]: https://github.com/RustCrypto/crypto-bigint/pull/356
[#357]: https://github.com/RustCrypto/crypto-bigint/pull/357
[#358]: https://github.com/RustCrypto/crypto-bigint/pull/358
[#359]: https://github.com/RustCrypto/crypto-bigint/pull/359
[#361]: https://github.com/RustCrypto/crypto-bigint/pull/361
[#362]: https://github.com/RustCrypto/crypto-bigint/pull/362
[#363]: https://github.com/RustCrypto/crypto-bigint/pull/363
[#365]: https://github.com/RustCrypto/crypto-bigint/pull/365
[#366]: https://github.com/RustCrypto/crypto-bigint/pull/366
[#367]: https://github.com/RustCrypto/crypto-bigint/pull/367
[#368]: https://github.com/RustCrypto/crypto-bigint/pull/368
[#369]: https://github.com/RustCrypto/crypto-bigint/pull/369
[#371]: https://github.com/RustCrypto/crypto-bigint/pull/371
[#372]: https://github.com/RustCrypto/crypto-bigint/pull/372
[#373]: https://github.com/RustCrypto/crypto-bigint/pull/373
[#376]: https://github.com/RustCrypto/crypto-bigint/pull/376
[#395]: https://github.com/RustCrypto/crypto-bigint/pull/395
[#398]: https://github.com/RustCrypto/crypto-bigint/pull/398
[#406]: https://github.com/RustCrypto/crypto-bigint/pull/406
[#407]: https://github.com/RustCrypto/crypto-bigint/pull/407
[#416]: https://github.com/RustCrypto/crypto-bigint/pull/416
[#417]: https://github.com/RustCrypto/crypto-bigint/pull/417
[#419]: https://github.com/RustCrypto/crypto-bigint/pull/419
[#425]: https://github.com/RustCrypto/crypto-bigint/pull/425
[#426]: https://github.com/RustCrypto/crypto-bigint/pull/426
[#430]: https://github.com/RustCrypto/crypto-bigint/pull/430
[#431]: https://github.com/RustCrypto/crypto-bigint/pull/431
[#432]: https://github.com/RustCrypto/crypto-bigint/pull/432
[#433]: https://github.com/RustCrypto/crypto-bigint/pull/433
[#434]: https://github.com/RustCrypto/crypto-bigint/pull/434
[#435]: https://github.com/RustCrypto/crypto-bigint/pull/435
[#438]: https://github.com/RustCrypto/crypto-bigint/pull/438
[#444]: https://github.com/RustCrypto/crypto-bigint/pull/444
[#452]: https://github.com/RustCrypto/crypto-bigint/pull/452
[#453]: https://github.com/RustCrypto/crypto-bigint/pull/453
[#454]: https://github.com/RustCrypto/crypto-bigint/pull/454
[#472]: https://github.com/RustCrypto/crypto-bigint/pull/472
[#485]: https://github.com/RustCrypto/crypto-bigint/pull/485
[#487]: https://github.com/RustCrypto/crypto-bigint/pull/487
[#488]: https://github.com/RustCrypto/crypto-bigint/pull/488
[#493]: https://github.com/RustCrypto/crypto-bigint/pull/493
[#496]: https://github.com/RustCrypto/crypto-bigint/pull/496
[#497]: https://github.com/RustCrypto/crypto-bigint/pull/497
[#499]: https://github.com/RustCrypto/crypto-bigint/pull/499
[#505]: https://github.com/RustCrypto/crypto-bigint/pull/505
[#507]: https://github.com/RustCrypto/crypto-bigint/pull/507
[#508]: https://github.com/RustCrypto/crypto-bigint/pull/508
[#509]: https://github.com/RustCrypto/crypto-bigint/pull/509
[#510]: https://github.com/RustCrypto/crypto-bigint/pull/510
[#514]: https://github.com/RustCrypto/crypto-bigint/pull/514
[#515]: https://github.com/RustCrypto/crypto-bigint/pull/515
[#517]: https://github.com/RustCrypto/crypto-bigint/pull/517
[#518]: https://github.com/RustCrypto/crypto-bigint/pull/518
[#526]: https://github.com/RustCrypto/crypto-bigint/pull/526
[#533]: https://github.com/RustCrypto/crypto-bigint/pull/533
[#544]: https://github.com/RustCrypto/crypto-bigint/pull/544
[#546]: https://github.com/RustCrypto/crypto-bigint/pull/546
[#555]: https://github.com/RustCrypto/crypto-bigint/pull/555
[#556]: https://github.com/RustCrypto/crypto-bigint/pull/556
[#557]: https://github.com/RustCrypto/crypto-bigint/pull/557
[#558]: https://github.com/RustCrypto/crypto-bigint/pull/558
[#573]: https://github.com/RustCrypto/crypto-bigint/pull/573
[#602]: https://github.com/RustCrypto/crypto-bigint/pull/602
[#603]: https://github.com/RustCrypto/crypto-bigint/pull/603
[#623]: https://github.com/RustCrypto/crypto-bigint/pull/623
[#632]: https://github.com/RustCrypto/crypto-bigint/pull/632
[#635]: https://github.com/RustCrypto/crypto-bigint/pull/635
[#643]: https://github.com/RustCrypto/crypto-bigint/pull/643
[#645]: https://github.com/RustCrypto/crypto-bigint/pull/645
[#649]: https://github.com/RustCrypto/crypto-bigint/pull/649
[#655]: https://github.com/RustCrypto/crypto-bigint/pull/655
[#659]: https://github.com/RustCrypto/crypto-bigint/pull/659
[#666]: https://github.com/RustCrypto/crypto-bigint/pull/666
[#667]: https://github.com/RustCrypto/crypto-bigint/pull/667
[#673]: https://github.com/RustCrypto/crypto-bigint/pull/673
[#676]: https://github.com/RustCrypto/crypto-bigint/pull/676
[#680]: https://github.com/RustCrypto/crypto-bigint/pull/680
[#690]: https://github.com/RustCrypto/crypto-bigint/pull/690
[#695]: https://github.com/RustCrypto/crypto-bigint/pull/695
[#709]: https://github.com/RustCrypto/crypto-bigint/pull/709
[#710]: https://github.com/RustCrypto/crypto-bigint/pull/710
[#713]: https://github.com/RustCrypto/crypto-bigint/pull/713
[#716]: https://github.com/RustCrypto/crypto-bigint/pull/716
[#719]: https://github.com/RustCrypto/crypto-bigint/pull/719
[#720]: https://github.com/RustCrypto/crypto-bigint/pull/720
[#730]: https://github.com/RustCrypto/crypto-bigint/pull/730
[#731]: https://github.com/RustCrypto/crypto-bigint/pull/731
[#741]: https://github.com/RustCrypto/crypto-bigint/pull/741
[#745]: https://github.com/RustCrypto/crypto-bigint/pull/745
[#746]: https://github.com/RustCrypto/crypto-bigint/pull/746

## 0.5.5 (2023-11-18)
### Added
- Multi-exponentiation ([#248])
- `const_assert_eq!` and `const_assert_ne!` macros ([#293])

[#248]: https://github.com/RustCrypto/crypto-bigint/pull/248
[#293]: https://github.com/RustCrypto/crypto-bigint/pull/293

## 0.5.4 (2023-11-12)
### Added
- `trailing_ones[_vartime]()`, `trailing_zeros_vartime()`, `leading_zeros_vartime()` ([#282])
- Implement `ArrayEncoding` for `U832` ([#288])

### Changed
- Make `Uint::random_mod()` work identically on 32- and 64-bit targets ([#285])

[#282]: https://github.com/RustCrypto/crypto-bigint/pull/282
[#285]: https://github.com/RustCrypto/crypto-bigint/pull/285
[#288]: https://github.com/RustCrypto/crypto-bigint/pull/288

## 0.5.3 (2023-09-04)
### Added
- `BoxedUint`: heap-allocated fixed-precision integers ([#221])
- `extra-sizes` feature ([#229])
- `U4224` and `U4352` ([#233])
- Zeroizing support for `DynResidue` ([#235])
- `cmp_vartime`, `ct_cmp` ([#238])
- Expose Montgomery form in `Residue`/`DynResidue` ([#239])
- Make `Uint::pow` work with different sized exponents ([#251])
- Expose `wrapping_neg` ([#252])
- Make `concat`, `split`, and multiply work with different sized operands ([#253])
- `U16384` and `U32768` ([#255])
- `Uint::{inv_mod, inv_mod2k_vartime}` ([#263])
- `const fn` constructors for `NonZero<Uint>` and `NonZero<Limb>` ([#266])
- Constant-time `Uint::shr()` and `Uint::shl()` ([#267])
- Subtle trait impls for `DynResidue` and `DynResidueParams` ([#269])

### Changed
- Modular inversion improvements ([#263])

### Fixed
- `serdect` usage ([#222])
- Enforce valid modulus for `DynResidueParams` ([#240])
- Enforce valid modulus for `Residue` and associated macros ([#243])
- Make `Uint::{from_be_hex, from_le_hex}` constant-time ([#254])
- Remove conditionals in `Uint::saturating_add()` and `saturating_mul()` ([#256])
- More logical checks in the `Uint::random_mod()` test ([#256])
- Mark `sqrt` for renaming, to explicitly describe it as vartime ([#256])

[#221]: https://github.com/RustCrypto/crypto-bigint/pull/221
[#222]: https://github.com/RustCrypto/crypto-bigint/pull/222
[#229]: https://github.com/RustCrypto/crypto-bigint/pull/229
[#233]: https://github.com/RustCrypto/crypto-bigint/pull/233
[#235]: https://github.com/RustCrypto/crypto-bigint/pull/235
[#238]: https://github.com/RustCrypto/crypto-bigint/pull/238
[#239]: https://github.com/RustCrypto/crypto-bigint/pull/239
[#240]: https://github.com/RustCrypto/crypto-bigint/pull/240
[#243]: https://github.com/RustCrypto/crypto-bigint/pull/243
[#251]: https://github.com/RustCrypto/crypto-bigint/pull/251
[#252]: https://github.com/RustCrypto/crypto-bigint/pull/252
[#253]: https://github.com/RustCrypto/crypto-bigint/pull/253
[#254]: https://github.com/RustCrypto/crypto-bigint/pull/254
[#255]: https://github.com/RustCrypto/crypto-bigint/pull/255
[#256]: https://github.com/RustCrypto/crypto-bigint/pull/256
[#263]: https://github.com/RustCrypto/crypto-bigint/pull/263
[#266]: https://github.com/RustCrypto/crypto-bigint/pull/266
[#267]: https://github.com/RustCrypto/crypto-bigint/pull/267
[#269]: https://github.com/RustCrypto/crypto-bigint/pull/269

## 0.5.2 (2023-04-26)
### Added
- Expose residue params and modulus in `DynResidue` ([#197])
- Impl `DefaultIsZeroes` for `Residue` ([#210])
- `div_by_2()` method for integers in Montgomery form ([#211], [#212])

### Changed
- Montgomery multiplication improvements ([#203])

[#197]: https://github.com/RustCrypto/crypto-bigint/pull/197
[#203]: https://github.com/RustCrypto/crypto-bigint/pull/203
[#210]: https://github.com/RustCrypto/crypto-bigint/pull/210
[#211]: https://github.com/RustCrypto/crypto-bigint/pull/211
[#212]: https://github.com/RustCrypto/crypto-bigint/pull/212

## 0.5.1 (2023-03-13)
### Changed
- Improve `Debug` impls on `Limb` and `Uint` ([#195])

### Fixed
- `const_residue` macro accessibility bug ([#193])

[#193]: https://github.com/RustCrypto/crypto-bigint/pull/193
[#195]: https://github.com/RustCrypto/crypto-bigint/pull/195

## 0.5.0 (2023-02-27)
### Added
- `Residue`: modular arithmetic with static compile-time moduli ([#130])
- `DynResidue`: modular arithmetic with dynamic runtime moduli ([#134])
- Constant-time division by a single `Limb` ([#141])
- Windowed exponentiation for `(Dyn)Residue` ([#147])
- `SubResidue` trait and impls for `Residue` and `DynResidue` ([#149])
- `Pow`, `Invert` and `Square` ([#155])
- `CtChoice` type ([#159])
- `BITS`, `BYTES`, and `LIMBS` to `Integer` trait ([#161])
- Impl `Random` for `Wrapping` ([#168])
- Support to concat `U320` and `U640` ([#173])
- Define `U224` and `U544` on 32-bit platforms ([#179], [#180])

### Changed
- Rename `UInt` -> `Uint` ([#143])
- Rename `Uint` methods ([#144])
  - `limbs` -> `as_limbs`
  - `limbs_mut` -> `as_limbs_mut`
  - `into_limbs` -> `to_limbs`
- Faster `random_mod` ([#146])
- Constant-time `leading_zeros()`, `trailing_zeros()`, `bits()`, and `bit()` for `Uint` ([#153])
- Rename `BIT_SIZE` -> `BITS`, `BYTE_SIZE` -> `BYTES` ([#157])
- More efficient squaring operation ([#133])
- Use `CryptoRngCore` ([#164])
- Bump `serdect` to 0.2 ([#185])
- Bump `der` dependency to v0.7; MSRV 1.65 ([#187])

### Fixed
- Integer overflow in `div2by1()` ([#156])
- Convert from tuple element ordering ([#183])

[#130]: https://github.com/RustCrypto/crypto-bigint/pull/130
[#134]: https://github.com/RustCrypto/crypto-bigint/pull/134
[#141]: https://github.com/RustCrypto/crypto-bigint/pull/141
[#143]: https://github.com/RustCrypto/crypto-bigint/pull/143
[#144]: https://github.com/RustCrypto/crypto-bigint/pull/144
[#146]: https://github.com/RustCrypto/crypto-bigint/pull/146
[#147]: https://github.com/RustCrypto/crypto-bigint/pull/147
[#149]: https://github.com/RustCrypto/crypto-bigint/pull/149
[#153]: https://github.com/RustCrypto/crypto-bigint/pull/153
[#155]: https://github.com/RustCrypto/crypto-bigint/pull/155
[#156]: https://github.com/RustCrypto/crypto-bigint/pull/156
[#157]: https://github.com/RustCrypto/crypto-bigint/pull/157
[#159]: https://github.com/RustCrypto/crypto-bigint/pull/159
[#161]: https://github.com/RustCrypto/crypto-bigint/pull/161
[#164]: https://github.com/RustCrypto/crypto-bigint/pull/164
[#168]: https://github.com/RustCrypto/crypto-bigint/pull/168
[#173]: https://github.com/RustCrypto/crypto-bigint/pull/173
[#179]: https://github.com/RustCrypto/crypto-bigint/pull/179
[#180]: https://github.com/RustCrypto/crypto-bigint/pull/180
[#183]: https://github.com/RustCrypto/crypto-bigint/pull/183
[#185]: https://github.com/RustCrypto/crypto-bigint/pull/185
[#187]: https://github.com/RustCrypto/crypto-bigint/pull/187

## 0.4.9 (2022-10-11)
### Added
- `UInt::from_word` and `::from_wide_word` ([#105])
- `UInt` modulo operations for special moduli ([#108])
- Non-const `UInt` decoding from an array ([#110])
- `const fn` impls of `concat` and `split` ([#111])
- `Limb` left/right bitshifts ([#112])
- `UInt::LIMBS` constant ([#114])

### Changed
- Optimize `UInt::neg_mod` by simply calling `::sub_mod` ([#106])
- Relax bounds for `UInt::add_mod` and `::sub_mod` ([#104])
- Always inline `Limb::bitand` ([#109])
- Faster const decoding of UInt ([#113])
- Optimize `UInt::neg_mod` ([#127])
- Faster comparisons ([#128])
- `UInt::resize` ([#129])
- `UInt::bit` accessor methods ([#122])

### Fixed
- Constant-time behaviour for `ct_reduce`/`ct_div_rem` ([#117])

[#104]: https://github.com/RustCrypto/crypto-bigint/pull/104
[#105]: https://github.com/RustCrypto/crypto-bigint/pull/105
[#106]: https://github.com/RustCrypto/crypto-bigint/pull/106
[#108]: https://github.com/RustCrypto/crypto-bigint/pull/108
[#109]: https://github.com/RustCrypto/crypto-bigint/pull/109
[#110]: https://github.com/RustCrypto/crypto-bigint/pull/110
[#111]: https://github.com/RustCrypto/crypto-bigint/pull/111
[#112]: https://github.com/RustCrypto/crypto-bigint/pull/112
[#113]: https://github.com/RustCrypto/crypto-bigint/pull/113
[#114]: https://github.com/RustCrypto/crypto-bigint/pull/114
[#117]: https://github.com/RustCrypto/crypto-bigint/pull/117
[#122]: https://github.com/RustCrypto/crypto-bigint/pull/122
[#127]: https://github.com/RustCrypto/crypto-bigint/pull/127
[#128]: https://github.com/RustCrypto/crypto-bigint/pull/128
[#129]: https://github.com/RustCrypto/crypto-bigint/pull/129

## 0.4.8 (2022-06-30)
### Added
- `Word` as a replacement for `LimbUInt` ([#88])
- `WideWord` as a replacement for `WideLimbUInt` ([#88])
- `UInt::*_words` as a replacement for `UInt::*_uint_array` ([#88])

### Changed
- Deprecated `*LimbUInt` and `UInt::*_uint_array` ([#88])

[#88]: https://github.com/RustCrypto/crypto-bigint/pull/88

## 0.4.7 (2022-06-12)
### Added
- `Encoding` tests ([#93])

### Changed
- Use const generic impls of `*Mod` traits ([#98])

[#93]: https://github.com/RustCrypto/crypto-bigint/pull/93
[#98]: https://github.com/RustCrypto/crypto-bigint/pull/98

## 0.4.6 (2022-06-12)
### Added
- Impl `ArrayEncoding` for `U576` ([#96])

[#96]: https://github.com/RustCrypto/crypto-bigint/pull/96

## 0.4.5 (2022-06-12)
### Added
- `serde` support ([#73])
- `U576` type alias ([#94])

[#73]: https://github.com/RustCrypto/crypto-bigint/pull/73
[#94]: https://github.com/RustCrypto/crypto-bigint/pull/94

## 0.4.4 (2022-06-02)
### Added
- `UInt::as_uint_array` ([#91])

[#91]: https://github.com/RustCrypto/crypto-bigint/pull/91

## 0.4.3 (2022-05-31)
### Added
- Impl `AsRef`/`AsMut<[LimbUInt]>` for `UInt` ([#89])

[#89]: https://github.com/RustCrypto/crypto-bigint/pull/89

## 0.4.2 (2022-05-18)
### Added
- `UInt::inv_mod2k` ([#86])

### Fixed
- Wrong results for remainder ([#84])

[#84]: https://github.com/RustCrypto/crypto-bigint/pull/84
[#86]: https://github.com/RustCrypto/crypto-bigint/pull/86

## 0.4.1 (2022-05-10)
### Fixed
- Bug in `from_le_slice` ([#82])

[#82]: https://github.com/RustCrypto/crypto-bigint/pull/82

## 0.4.0 (2022-05-08) [YANKED]

NOTE: this release was yanked due to [#82].

### Added
- Const-friendly `NonZero` from `UInt` ([#56])
- Optional `der` feature ([#61], [#80])

### Changed
- Use `const_panic`; MSRV 1.57 ([#60])
- 2021 edition ([#60])

### Fixed
- Pad limbs with zeros when displaying hexadecimal representation ([#74])

[#56]: https://github.com/RustCrypto/crypto-bigint/pull/56
[#60]: https://github.com/RustCrypto/crypto-bigint/pull/60
[#61]: https://github.com/RustCrypto/crypto-bigint/pull/61
[#74]: https://github.com/RustCrypto/crypto-bigint/pull/74
[#80]: https://github.com/RustCrypto/crypto-bigint/pull/80

## 0.3.2 (2021-11-17)
### Added
- `Output = Self` to all bitwise ops on `Integer` trait ([#53])

[#53]: https://github.com/RustCrypto/crypto-bigint/pull/53

## 0.3.1 (2021-11-17)
### Added
- Bitwise ops to `Integer` trait ([#51])

[#51]: https://github.com/RustCrypto/crypto-bigint/pull/51

## 0.3.0 (2021-11-14) [YANKED]
### Added
- Bitwise `Xor`/`Not` operations ([#27])
- `Zero` trait ([#35])
- `Checked*` traits ([#41])
- `prelude` module ([#45])
- `saturating_*` ops ([#47])

### Changed
- Rust 2021 edition upgrade; MSRV 1.56 ([#33])
- Reverse ordering of `UInt::mul_wide` return tuple ([#34])
- Have `Div` and `Rem` impls always take `NonZero` args ([#39])
- Rename `limb::Inner` to `LimbUInt` ([#40])
- Make `limb` module private ([#40])
- Use `Zero`/`Integer` traits for `is_zero`, `is_odd`, and `is_even` ([#46])

### Fixed
- `random_mod` performance for small moduli ([#36])
- `NonZero` moduli ([#36])

### Removed
- Deprecated `LIMB_BYTES` constant ([#43])

[#27]: https://github.com/RustCrypto/crypto-bigint/pull/27
[#33]: https://github.com/RustCrypto/crypto-bigint/pull/33
[#34]: https://github.com/RustCrypto/crypto-bigint/pull/34
[#35]: https://github.com/RustCrypto/crypto-bigint/pull/35
[#36]: https://github.com/RustCrypto/crypto-bigint/pull/36
[#39]: https://github.com/RustCrypto/crypto-bigint/pull/39
[#40]: https://github.com/RustCrypto/crypto-bigint/pull/40
[#41]: https://github.com/RustCrypto/crypto-bigint/pull/41
[#43]: https://github.com/RustCrypto/crypto-bigint/pull/43
[#45]: https://github.com/RustCrypto/crypto-bigint/pull/45
[#46]: https://github.com/RustCrypto/crypto-bigint/pull/46
[#47]: https://github.com/RustCrypto/crypto-bigint/pull/47

## 0.2.11 (2021-10-16)
### Added
- `AddMod` proptests ([#24])
- Bitwise `And`/`Or` operations ([#25])

[#24]: https://github.com/RustCrypto/crypto-bigint/pull/24
[#25]: https://github.com/RustCrypto/crypto-bigint/pull/25

## 0.2.10 (2021-09-21)
### Added
- `ArrayDecoding` trait ([#12])
- `NonZero` wrapper ([#13], [#16])
- Impl `Div`/`Rem` for `NonZero<UInt>` ([#14])

[#12]: https://github.com/RustCrypto/crypto-bigint/pull/12
[#13]: https://github.com/RustCrypto/crypto-bigint/pull/13
[#14]: https://github.com/RustCrypto/crypto-bigint/pull/14
[#16]: https://github.com/RustCrypto/crypto-bigint/pull/16

## 0.2.9 (2021-09-16)
### Added
- `UInt::sqrt` ([#9])

### Changed
- Make `UInt` division similar to other interfaces ([#8])

[#8]: https://github.com/RustCrypto/crypto-bigint/pull/8
[#9]: https://github.com/RustCrypto/crypto-bigint/pull/9

## 0.2.8 (2021-09-14) [YANKED]
### Added
- Implement constant-time division and modulo operations

### Changed
- Moved from RustCrypto/utils to RustCrypto/crypto-bigint repo ([#2])

[#2]: https://github.com/RustCrypto/crypto-bigint/pull/2

## 0.2.7 (2021-09-12)
### Added
- `UInt::shl_vartime`

### Fixed
- `add_mod` overflow handling

## 0.2.6 (2021-09-08)
### Added
- `Integer` trait
- `ShrAssign` impl for `UInt`
- Recursive Length Prefix (RLP) encoding support for `UInt`

## 0.2.5 (2021-09-02)
### Fixed
- `ConditionallySelectable` impl for `UInt`

## 0.2.4 (2021-08-23) [YANKED]
### Added
- Expose `limb` module
- `[limb::Inner; LIMBS]` conversions for `UInt`
- Bitwise right shift support for `UInt` ([#586], [#590])

## 0.2.3 (2021-08-16) [YANKED]
### Fixed
- `UInt::wrapping_mul`

### Added
- Implement the `Hash` trait for `UInt` and `Limb`

## 0.2.2 (2021-06-26) [YANKED]
### Added
- `Limb::is_odd` and `UInt::is_odd`
- `UInt::new`
- `rand` feature

### Changed
- Deprecate `LIMB_BYTES` constant
- Make `Limb`'s `Inner` value public

## 0.2.1 (2021-06-21) [YANKED]
### Added
- `Limb` newtype
- Target-specific rustdocs

## 0.2.0 (2021-06-07) [YANKED]
### Added
- `ConstantTimeGreater`/`ConstantTimeLess` impls for UInt
- `From` conversions between `UInt` and limb arrays
- `zeroize` feature
- Additional `ArrayEncoding::ByteSize` bounds
- `UInt::into_limbs`
- `Encoding` trait

### Removed
- `NumBits`/`NumBytes` traits; use `Encoding` instead

## 0.1.0 (2021-05-30)
- Initial release
