//! Test against the Wycheproof test vectors.

use array::{Array, ArraySize};
#[allow(deprecated)]
use ml_kem::ExpandedKeyEncoding;
use ml_kem::{
    FromSeed, MlKem512, MlKem768, MlKem1024,
    kem::{Decapsulate, KeyExport, TryKeyInit},
};
use serde::Deserialize;
use std::fs::File;

#[derive(Deserialize, Debug)]
struct TestFile {
    algorithm: String,
    schema: String,
    #[serde(rename(deserialize = "testGroups"))]
    groups: Vec<TestGroup>,
}

#[derive(Deserialize, Debug)]
struct TestGroup {
    #[allow(dead_code)]
    #[serde(rename(deserialize = "type"))]
    type_: String,
    #[serde(default, rename(deserialize = "parameterSet"))]
    parameter_set: String,
    source: Source,
    tests: Vec<Test>,
}

#[derive(Deserialize, Debug)]
struct Source {
    name: String,
    version: String,
}

#[derive(Deserialize, Debug)]
struct Test {
    #[serde(rename(deserialize = "tcId"))]
    id: usize,
    comment: Option<String>,
    seed: Option<String>,
    #[serde(default, with = "hex::serde")]
    ek: Vec<u8>,
    dk: Option<String>,
    #[cfg(feature = "hazmat")]
    m: Option<String>,
    c: Option<String>,
    #[serde(default, rename(deserialize = "K"))]
    k: Option<String>,
    result: ExpectedResult,
}

#[derive(Copy, Clone, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ExpectedResult {
    Valid,
    Invalid,
    Acceptable,
}

macro_rules! load_json_file {
    ($json_file:expr) => {{
        let path = format!("../thirdparty/wycheproof/testvectors_v1/{}", $json_file);
        let data_file = File::open(&path)
            .expect("failed to open data file (try running `git submodule update --init`)");

        println!("Loading file: {path}");

        let tests: TestFile = serde_json::from_reader(data_file).expect("invalid test JSON");
        println!("{} ({})", tests.algorithm, tests.schema);
        tests
    }};
}

fn decode_optional_hex<U: ArraySize>(opt: &Option<String>, field: &str) -> Option<Array<u8, U>> {
    opt.as_ref().and_then(|h| {
        let vec = hex::decode(h).unwrap_or_else(|e| panic!("invalid hex for field '{field}': {e}"));
        vec.as_slice().try_into().ok()
    })
}

fn decode_expected_hex<U: ArraySize>(opt: &Option<String>, field: &str) -> Array<u8, U> {
    decode_optional_hex(opt, field)
        .unwrap_or_else(|| panic!("missing or incorrect length field: {field}"))
}

macro_rules! mlkem_test {
    ($name:ident, $json_file:expr, $kem:ident, $kem_module:ident) => {
        #[test]
        fn $name() {
            let tests = load_json_file!($json_file);

            for group in tests.groups {
                println!(
                    "Parameter set: {} ({} v{})\n",
                    &group.parameter_set, &group.source.name, &group.source.version
                );

                for test in &group.tests {
                    println!("Test #{}: {:?}", test.id, &test.result);
                    let test_seed = match decode_optional_hex(&test.seed, "seed") {
                        Some(seed) => seed,
                        None => {
                            assert_eq!(test.result, ExpectedResult::Invalid);
                            continue;
                        }
                    };

                    let (dk, ek) = $kem::from_seed(&test_seed);
                    assert_eq!(test.ek.as_slice(), ek.to_bytes().as_slice());

                    use ml_kem::$kem_module::Ciphertext;
                    let test_c: Ciphertext = match decode_optional_hex(&test.c, "c") {
                        Some(dk) => dk,
                        None => {
                            assert_eq!(test.result, ExpectedResult::Invalid);
                            continue;
                        }
                    };
                    let test_k = decode_expected_hex(&test.k, "K");
                    let decrypted_k = dk.decapsulate(&test_c);
                    assert_eq!(test_k, decrypted_k);
                }
            }
        }
    };
}

macro_rules! mlkem_keygen_seed_test {
    ($name:ident, $json_file:expr, $kem:ident) => {
        #[test]
        fn $name() {
            let tests = load_json_file!($json_file);

            for group in tests.groups {
                println!(
                    "Parameter set: {} ({} v{})\n",
                    &group.parameter_set, &group.source.name, &group.source.version
                );

                for test in &group.tests {
                    println!(
                        "Test #{}: {} ({:?})",
                        test.id,
                        test.comment.as_ref().unwrap(),
                        &test.result
                    );
                    let test_seed = decode_expected_hex(&test.seed, "seed");
                    let test_dk = decode_expected_hex(&test.dk, "dk");

                    let (dk, ek) = $kem::from_seed(&test_seed);

                    #[allow(deprecated)]
                    {
                        assert_eq!(test_dk, dk.to_expanded_bytes());
                    }

                    assert_eq!(test.ek.as_slice(), ek.to_bytes().as_slice());
                }
            }
        }
    };
}

macro_rules! mlkem_encaps_test {
    ($name:ident, $json_file:expr, $kem_module:ident) => {
        #[test]
        fn $name() {
            let tests = load_json_file!($json_file);

            for group in tests.groups {
                println!(
                    "Parameter set: {} ({} v{})\n",
                    &group.parameter_set, &group.source.name, &group.source.version
                );

                for test in &group.tests {
                    println!("Test #{} ({:?})", test.id, &test.result);

                    use ml_kem::$kem_module::EncapsulationKey;
                    let ek_result = EncapsulationKey::new_from_slice(&test.ek);

                    #[cfg_attr(not(feature = "hazmat"), allow(unused_variables))]
                    let ek = match test.result {
                        ExpectedResult::Valid => ek_result.expect("should be valid"),
                        ExpectedResult::Invalid => {
                            assert!(ek_result.is_err());
                            continue;
                        }
                        other => todo!("{:?}", other),
                    };

                    #[cfg(feature = "hazmat")]
                    {
                        let test_m = decode_expected_hex(&test.m, "m");
                        let (c, k) = ek.encapsulate_deterministic(&test_m);

                        let test_c = decode_expected_hex(&test.c, "c");
                        let test_k = decode_expected_hex(&test.k, "K");
                        assert_eq!(test_c, c);
                        assert_eq!(test_k, k);
                    }
                }
            }
        }
    };
}

macro_rules! mlkem_decaps_test {
    ($name:ident, $json_file:expr, $kem_module:ident) => {
        #[test]
        fn $name() {
            let tests = load_json_file!($json_file);

            for group in tests.groups {
                println!(
                    "Parameter set: {} ({} v{})\n",
                    &group.parameter_set, &group.source.name, &group.source.version
                );

                for test in &group.tests {
                    println!("Test #{} ({:?})", test.id, &test.result);

                    #[allow(deprecated)]
                    use ml_kem::$kem_module::{
                        Ciphertext, DecapsulationKey, ExpandedDecapsulationKey,
                    };

                    #[allow(deprecated)]
                    let test_dk: ExpandedDecapsulationKey =
                        match decode_optional_hex(&test.dk, "dk") {
                            Some(dk) => dk,
                            None => {
                                if test.result == ExpectedResult::Invalid {
                                    continue;
                                } else {
                                    panic!("failed to decode expanded decapsulation key!")
                                }
                            }
                        };

                    #[allow(deprecated)]
                    let dk_result = DecapsulationKey::from_expanded(&test_dk);
                    if dk_result.is_err() {
                        assert_eq!(test.result, ExpectedResult::Invalid);
                        continue;
                    }
                    let dk = dk_result.unwrap();

                    let test_c: Ciphertext = match decode_optional_hex(&test.c, "c") {
                        Some(dk) => dk,
                        None => {
                            assert_eq!(test.result, ExpectedResult::Invalid);
                            continue;
                        }
                    };

                    let _ss = dk.decapsulate(&test_c);
                }
            }
        }
    };
}

mlkem_test!(mlkem_512_test, "mlkem_512_test.json", MlKem512, ml_kem_512);
mlkem_test!(mlkem_768_test, "mlkem_768_test.json", MlKem768, ml_kem_768);
mlkem_test!(
    mlkem_1024_test,
    "mlkem_1024_test.json",
    MlKem1024,
    ml_kem_1024
);

mlkem_keygen_seed_test!(
    mlkem_512_keygen_seed_test,
    "mlkem_512_keygen_seed_test.json",
    MlKem512
);
mlkem_keygen_seed_test!(
    mlkem_768_keygen_seed_test,
    "mlkem_768_keygen_seed_test.json",
    MlKem768
);
mlkem_keygen_seed_test!(
    mlkem_1024_keygen_seed_test,
    "mlkem_1024_keygen_seed_test.json",
    MlKem1024
);

mlkem_decaps_test!(
    mlkem_512_semi_expanded_decaps_test,
    "mlkem_512_semi_expanded_decaps_test.json",
    ml_kem_512
);
mlkem_decaps_test!(
    mlkem_768_semi_expanded_decaps_test,
    "mlkem_768_semi_expanded_decaps_test.json",
    ml_kem_768
);
mlkem_decaps_test!(
    mlkem_1024_semi_expanded_decaps_test,
    "mlkem_1024_semi_expanded_decaps_test.json",
    ml_kem_1024
);

mlkem_encaps_test!(
    mlkem_512_encaps_test,
    "mlkem_512_encaps_test.json",
    ml_kem_512
);
mlkem_encaps_test!(
    mlkem_768_encaps_test,
    "mlkem_768_encaps_test.json",
    ml_kem_768
);
mlkem_encaps_test!(
    mlkem_1024_encaps_test,
    "mlkem_1024_encaps_test.json",
    ml_kem_1024
);
