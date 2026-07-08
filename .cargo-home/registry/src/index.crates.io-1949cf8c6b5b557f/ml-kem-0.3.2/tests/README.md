ML-KEM Test Vectors
===================

The tests in this directory validate that our ML-KEM implementation successfully
validates the NIST test vectors.  The JSON test vector files are taken from the
[NIST ACVP repository].  Specifically, `key-gen.json` and `encap-decap.json` are
the "internal projection" files from the [ML-KEM key generation test
directory][keyGen] and [encap/decap test directory][encapDecap], respectively.

The current copies of these files were taken from commit [65370b8] of that repo.

The actual tests to be performed are described in the [ACVP documentation].

[NIST ACVP repository]: https://github.com/usnistgov/ACVP-Server/tree/master
[keyGen]: https://github.com/usnistgov/ACVP-Server/tree/master/gen-val/json-files/ML-KEM-keyGen-FIPS203
[encapDecap]: https://github.com/usnistgov/ACVP-Server/tree/master/gen-val/json-files/ML-KEM-encapDecap-FIPS203
[65370b8]: https://github.com/usnistgov/ACVP-Server/commit/65370b861b96efd30dfe0daae607bde26a78a5c8
[ACVP documentation]: https://github.com/usnistgov/ACVP/tree/2f786fac5b516733b58889d61a8473113ed62ee3/src/ml-kem/sections
