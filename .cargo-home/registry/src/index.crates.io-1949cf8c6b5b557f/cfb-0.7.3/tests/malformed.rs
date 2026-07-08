use byteorder::{LittleEndian, WriteBytesExt};
use cfb::CompoundFile;
use std::{
    fs::read_dir,
    io::{Cursor, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::mpsc,
    thread,
    time::Duration,
};

// Run function on another thread, panic if it takes too long
fn panic_after<T, F>(d: Duration, f: F) -> T
where
    T: Send + 'static,
    F: FnOnce() -> T,
    F: Send + 'static,
{
    let (done_tx, done_rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let val = f();
        done_tx.send(()).expect("Unable to send completion signal");
        val
    });

    match done_rx.recv_timeout(d) {
        Ok(_) => handle.join().expect("Thread panicked"),
        Err(_) => panic!("Thread took too long"),
    }
}

// Checks to see if a file can be walked over and read properly, or fail if it can not be read
fn can_read(path: &Path) {
    let data = std::fs::read(&path).unwrap();

    let cursor = Cursor::new(data);
    let mut cfb = match CompoundFile::open(cursor) {
        Ok(cfb) => cfb,
        Err(_) => return,
    };

    #[allow(clippy::needless_collect)]
    let stream_paths = cfb
        .walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect::<Vec<_>>();

    let _unused = stream_paths
        .into_iter()
        .map(|s| -> Result<Vec<u8>, std::io::Error> {
            let mut data = Vec::new();
            cfb.open_stream(&s)?.read_to_end(&mut data)?;
            Ok(data)
        })
        .collect::<Vec<_>>();
}

/// Regression test for https://github.com/mdsteele/rust-cfb/issues/16.
#[test]
#[should_panic(
    expected = "Found reference to mini sector 123456789, but MiniFAT has \
                only 2 entries"
)]
fn invalid_mini_sector_issue_16() {
    // Create a CFB file with a mini stream.
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).unwrap();
    let version = comp.version();
    comp.create_stream("foo").unwrap().write_all(&[0u8; 80]).unwrap();
    let mut cursor = comp.into_inner();

    // Corrupt the starting mini sector ID of the stream.  Due to how we
    // constructed the CFB file, this will be at byte 116 of the second
    // 128-byte directory entry in the third sector of the CFB file.
    let offset = 116 + 128 * 1 + (version.sector_len() as u64) * 2;
    cursor.seek(SeekFrom::Start(offset)).unwrap();
    cursor.write_u32::<LittleEndian>(123456789).unwrap();

    // Re-open the CFB file and try to read the mini stream.
    let mut comp = CompoundFile::open(cursor).unwrap();
    let mut data = Vec::new();
    comp.open_stream("foo").unwrap().read_to_end(&mut data).unwrap();
}

/// Regression test for https://github.com/mdsteele/rust-cfb/issues/17.
#[test]
#[should_panic(expected = "DIFAT chain includes duplicate sector index 0")]
fn infinite_loop_difat_issue_17() {
    let data = vec![
        208, 207, 17, 224, 161, 177, 26, 225, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        128, 0, 0, 0, 0, 62, 0, 3, 0, 254, 255, 9, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 255,
        255, 255, 255, 255, 255, 255, 27, 80, 255, 255, 253, 0, 0, 0, 254,
        255, 255, 255, 28, 0, 0, 0, 5, 0, 0, 0, 6, 0, 0, 0, 7, 0, 0, 0, 8, 0,
        0, 0, 9, 0, 0, 0, 10, 0, 0, 0, 11, 0, 0, 0, 12, 0, 0, 0, 13, 0, 0, 0,
        14, 0, 0, 0, 15, 208, 207, 17, 224, 161, 177, 26, 225, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 3, 0, 254, 255, 9, 0, 6, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 16,
        0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 254, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0,
        0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 0, 0, 0, 16, 0, 0, 0, 17, 0, 0, 0, 18, 0, 0,
        0, 19, 0, 0, 0, 20, 0, 1, 0, 0, 0, 0, 0, 9, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 252, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 253, 255, 255, 255, 27, 0, 0, 0, 254, 255, 255, 255,
        28, 0, 0, 0, 5, 0, 0, 0, 0, 255, 27, 0, 0, 0, 254, 255, 255, 255, 28,
        0, 0, 0, 5, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 0, 62, 0, 3, 0, 254, 255, 9,
        0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0,
        0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 254, 255,
        255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 253, 255, 255, 255, 27, 0, 0, 0,
        254, 255, 255, 255, 28, 0, 0, 0, 5, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 253, 255, 255, 255, 27, 0, 0, 0, 254, 255, 255, 255, 28, 0, 0, 0,
        5, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255, 255, 255, 255, 255, 255, 255,
    ];
    CompoundFile::open(Cursor::new(data)).unwrap();
}

#[test]
#[should_panic(
    expected = "Invalid CFB file (length of 512 < sector length of 4096)"
)]
fn sector_panic_pr_24() {
    let data = vec![
        208, 207, 17, 224, 161, 177, 26, 225, 47, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 254, 255, 12, 0, 6, 0, 0, 0, 0, 0, 255,
        255, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 16, 0, 0, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 5, 5, 5, 5, 5, 59, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 176, 5, 5, 5,
        5, 5, 5, 208, 207, 17, 224, 255, 177, 26, 225, 0, 0, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 176, 5, 5, 5, 5, 5, 5,
        208, 207, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        229, 229, 229, 229, 229, 229, 231, 229, 229, 229, 229, 229, 229, 229,
        229, 229, 229, 229, 0, 229, 255, 255, 255, 255, 255, 255, 223, 255, 5,
        5, 5, 5, 5, 5, 15, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 176, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 13, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 255, 255,
        255, 255, 255, 17, 224, 255, 255, 255, 255, 255, 255, 255, 255, 177,
        26, 225, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 8, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 207, 207,
        207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207,
        207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207,
        207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207,
        207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207, 207,
        207, 207, 55, 50, 49, 51, 86, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        207, 207, 207, 207, 207, 12, 0, 0, 0, 0, 0, 0, 0, 207, 207, 207, 207,
        207, 207, 207, 207, 207, 207, 207, 5, 5, 5, 5, 5, 5, 5, 5, 12, 0, 6,
        0, 0, 0, 0, 0, 255, 255, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 255, 255, 255, 255,
        255, 17, 224, 255, 255, 255, 255, 255, 255, 255, 255, 177, 26, 225, 0,
        0, 255, 255, 255, 255, 255, 255, 255, 255, 8, 0,
    ];
    CompoundFile::open(Cursor::new(data)).unwrap();
}

#[test]
#[should_panic(expected = "next_id (4294967293) is invalid")]
fn alloc_panic_pr_24() {
    let mut cfb = cfb::open("tests/panics_fuzzed/alloc_panic").unwrap();
    cfb.walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect::<Vec<_>>()
        .into_iter()
        .map(|s| {
            let mut data = Vec::new();
            cfb.open_stream(&s).unwrap().read_to_end(&mut data).unwrap();
            Ok((s, data))
        })
        .collect::<Result<std::collections::HashMap<_, _>, std::io::Error>>()
        .unwrap();
}

#[test]
#[should_panic(expected = "next_id (4294967295) is invalid")]
fn minialloc_panic_pr_24() {
    let mut cfb = cfb::open("tests/panics_fuzzed/minialloc_panic").unwrap();
    cfb.walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect::<Vec<_>>()
        .into_iter()
        .map(|s| {
            let mut data = Vec::new();
            cfb.open_stream(&s).unwrap().read_to_end(&mut data).unwrap();
            Ok((s, data))
        })
        .collect::<Result<std::collections::HashMap<_, _>, std::io::Error>>()
        .unwrap();
}

#[test]
fn check_for_infinite_loops() {
    // Loop through the provided files
    for entry in read_dir("tests/infinite_loops_fuzzed").unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();

        // Test will panic if it takes more than 1 second to load the file ie. stuck in a loop
        panic_after(Duration::from_secs(1), move || can_read(&path))
    }
}
