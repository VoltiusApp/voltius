use cfb::CompoundFile;
use rand::prelude::{Rng, SeedableRng};
use rand_pcg::Pcg32;
use std::io::{Cursor, Seek, SeekFrom, Write};
use std::path::PathBuf;

/// Regression test for https://github.com/mdsteele/rust-cfb/issues/12.
#[test]
fn large_file_issue_12() {
    // Use a reproducible PRNG sequence.
    let mut rng = Pcg32::from_seed(*b"1941039482934820");

    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).unwrap();
    for _ in 0..50 {
        // Generate a random path.
        let mut path = PathBuf::new();
        for _ in 0..6 {
            path.push(format!("{:08x}", rng.gen::<u64>()));
        }
        comp.create_storage_all(&path).unwrap();
        path.push("file");

        // Create a stream with a random amount of data, chosen such that
        // sometimes the length is below the mini-stream cutoff of 4096, and
        // sometimes it's above.
        let length: usize = rng.gen_range(4000..4200);
        let data = vec![0x11; length];
        comp.create_stream(&path).unwrap().write_all(&data).unwrap();

        // Open the same stream again, and append a bit more data to the end.
        let mut stream = comp.open_stream(&path).unwrap();
        stream.seek(SeekFrom::End(0)).unwrap();
        stream.write_all(b"additional test data").unwrap();
    }

    let cursor = comp.into_inner();
    let _comp = CompoundFile::open(cursor).expect("re-open");
}
