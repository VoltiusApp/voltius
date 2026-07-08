use cfb::{CompoundFile, Entry, Version};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::Path;
use uuid::Uuid;

//===========================================================================//

fn read_root_storage_to_vec<F>(comp: &CompoundFile<F>) -> Vec<String> {
    comp.read_root_storage().map(|e| e.name().to_string()).collect()
}

fn read_storage_to_vec<F>(comp: &CompoundFile<F>, path: &str) -> Vec<String> {
    comp.read_storage(path).unwrap().map(|e| e.name().to_string()).collect()
}

fn walk_to_vec(entries: &[Entry]) -> Vec<&Path> {
    entries.iter().map(|e| e.path()).collect()
}

//===========================================================================//
// Tests for creating compound files:

#[test]
#[should_panic(expected = "Invalid CFB file (12 bytes is too small)")]
fn file_too_small() {
    let cursor = Cursor::new([1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    CompoundFile::open(cursor).unwrap();
}

#[test]
fn create_empty_compound_file() {
    let version = Version::V3;

    let cursor = Cursor::new(Vec::new());
    let comp =
        CompoundFile::create_with_version(version, cursor).expect("create");
    assert_eq!(comp.version(), version);
    assert_eq!(comp.entry("/").unwrap().name(), "Root Entry");

    let cursor = comp.into_inner();
    assert_eq!(cursor.get_ref().len(), 3 * version.sector_len());
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(comp.version(), version);
    assert_eq!(comp.entry("/").unwrap().name(), "Root Entry");
}

#[test]
fn empty_compound_file_has_no_children() {
    let cursor = Cursor::new(Vec::new());
    let comp = CompoundFile::create_with_version(Version::V4, cursor)
        .expect("create");
    assert!(comp.entry("/").unwrap().is_root());
    assert_eq!(comp.read_storage("/").unwrap().count(), 0);
    assert_eq!(comp.read_root_storage().count(), 0);
}

#[test]
fn partial_final_sector() {
    // Create a CFB with 4096-byte sectors.
    let mut comp = CompoundFile::create_with_version(
        Version::V4,
        Cursor::new(Vec::new()),
    )
    .unwrap();
    // Create a stream with 10,000 bytes of data in it.  This should take
    // up a little over two sectors.
    let stream_data = vec![b'x'; 10000];
    comp.create_stream("s").unwrap().write_all(&stream_data).unwrap();
    // Get the raw CFB data.  Due to the way we constructed the CFB file, it
    // should consist of exactly six sectors (header, FAT, directory, and three
    // for the stream), and the final sector of the stream should be the final
    // sector of the file.  However, we should still pad out the file to the
    // end of that sector, even though the stream doesn't use the whole last
    // sector, for compatibility with other tools that don't support partial
    // final sectors.
    let mut cfb_data = comp.into_inner().into_inner();
    assert_eq!(cfb_data.len(), 6 * 4096);
    let mut expected_final_sector = vec![b'\0'; 4096];
    for i in 0..(stream_data.len() % 4096) {
        expected_final_sector[i] = b'x';
    }
    assert_eq!(&cfb_data[(5 * 4096)..], expected_final_sector.as_slice());
    // Now, truncate the raw CFB data so that the final sector only
    // contains as much data as is actually needed by the stream, then read
    // it as a CFB file.  For compatibility with other tools that create
    // partial final sectors, we should consider it valid and still be able
    // to read the stream.
    cfb_data.truncate(5 * 4096 + stream_data.len() % 4096);
    let mut comp = CompoundFile::open(Cursor::new(cfb_data)).unwrap();
    assert_eq!(comp.entry("s").unwrap().len(), stream_data.len() as u64);
    let mut actual_data = Vec::new();
    comp.open_stream("s").unwrap().read_to_end(&mut actual_data).unwrap();
    assert_eq!(actual_data, stream_data);
}

//===========================================================================//
// Tests for directory methods:

#[test]
fn root_entry() {
    let cursor = Cursor::new(Vec::new());
    let comp = CompoundFile::create(cursor).expect("create");
    assert_eq!(comp.root_entry().path(), comp.entry("/").unwrap().path());
    assert_eq!(comp.root_entry().name(), comp.entry("/").unwrap().name());
    assert!(comp.root_entry().is_root());
}

#[test]
fn create_directory_tree() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.create_storage("/baz").unwrap();
    comp.create_storage("/foo/bar").unwrap();

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(read_root_storage_to_vec(&comp), vec!["baz", "foo"]);
    assert_eq!(read_storage_to_vec(&comp, "/"), vec!["baz", "foo"]);
    assert_eq!(read_storage_to_vec(&comp, "/foo"), vec!["bar"]);
    assert!(read_storage_to_vec(&comp, "/baz").is_empty());
    assert!(read_storage_to_vec(&comp, "/foo/bar").is_empty());
}

#[test]
fn walk_directory_tree() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.create_stream("/baz").unwrap();
    comp.create_storage("/quux").unwrap();
    comp.create_stream("/foo/bar").unwrap();
    let entries: Vec<Entry> = comp.walk().collect();
    assert_eq!(
        walk_to_vec(&entries),
        vec![
            Path::new("/"),
            Path::new("/baz"),
            Path::new("/foo"),
            Path::new("/foo/bar"),
            Path::new("/quux")
        ]
    );
    let entries: Vec<Entry> = comp.walk_storage("/").unwrap().collect();
    assert_eq!(
        walk_to_vec(&entries),
        vec![
            Path::new("/"),
            Path::new("/baz"),
            Path::new("/foo"),
            Path::new("/foo/bar"),
            Path::new("/quux")
        ]
    );
    let entries: Vec<Entry> = comp.walk_storage("/foo").unwrap().collect();
    assert_eq!(
        walk_to_vec(&entries),
        vec![Path::new("/foo"), Path::new("/foo/bar")]
    );
    let entries: Vec<Entry> = comp.walk_storage("/baz").unwrap().collect();
    assert_eq!(walk_to_vec(&entries), vec![Path::new("/baz")]);
}

#[test]
#[should_panic(expected = "Not a storage: \\\"/foo\\\"")]
fn read_storage_on_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(b"foobar").unwrap();
    comp.read_storage("/foo").unwrap();
}

#[test]
#[should_panic(expected = "Not a stream: \\\"/foo\\\"")]
fn open_stream_on_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").expect("storage");
    comp.open_stream("/foo").unwrap();
}

//===========================================================================//
// Tests for path methods:

#[test]
fn path_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(b"foo").unwrap();
    comp.create_storage("/bar/").unwrap();
    comp.create_stream("/bar/quux").unwrap().write_all(b"quux").unwrap();

    assert!(comp.exists("/"));
    assert!(comp.exists("foo"));
    assert!(comp.exists("/bar"));
    assert!(!comp.exists("quux"));
    assert!(comp.exists("bar/quux"));
    assert!(!comp.exists("bar/foo"));
    assert!(comp.exists("/bar/../foo"));
    assert!(comp.exists("/bar/../bar"));
    assert!(!comp.exists("../../foo"));
}

#[test]
fn path_is_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(b"foo").unwrap();
    comp.create_storage("/bar/").unwrap();
    comp.create_stream("/bar/quux").unwrap().write_all(b"quux").unwrap();

    assert!(!comp.is_stream("/"));
    assert!(comp.is_stream("foo"));
    assert!(!comp.is_stream("/bar"));
    assert!(!comp.is_stream("quux"));
    assert!(comp.is_stream("bar/quux"));
    assert!(!comp.is_stream("bar/foo"));
    assert!(comp.is_stream("/bar/../foo"));
    assert!(!comp.is_stream("/bar/../bar"));
    assert!(!comp.is_stream("../../foo"));
}

#[test]
fn path_is_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(b"foo").unwrap();
    comp.create_storage("/bar/").unwrap();
    comp.create_stream("/bar/quux").unwrap().write_all(b"quux").unwrap();

    assert!(comp.is_storage("/"));
    assert!(!comp.is_storage("foo"));
    assert!(comp.is_storage("/bar"));
    assert!(!comp.is_storage("quux"));
    assert!(!comp.is_storage("bar/quux"));
    assert!(!comp.is_storage("bar/foo"));
    assert!(!comp.is_storage("/bar/../foo"));
    assert!(comp.is_storage("/bar/../bar"));
    assert!(!comp.is_storage("../../bar"));
}

//===========================================================================//
// Tests for CLSIDs:

#[test]
fn storage_clsids() {
    let uuid1 = Uuid::from_bytes(*b"ABCDEFGHIJKLMNOP");
    let uuid2 = Uuid::from_bytes(*b"0123456789abcdef");

    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.set_storage_clsid("/", uuid1).unwrap();
    comp.set_storage_clsid("/foo", uuid2).unwrap();
    assert_eq!(comp.root_entry().clsid(), &uuid1);
    assert_eq!(comp.entry("/foo").unwrap().clsid(), &uuid2);

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(comp.root_entry().clsid(), &uuid1);
    assert_eq!(comp.entry("/foo").unwrap().clsid(), &uuid2);
}

#[test]
#[should_panic(expected = "No such storage")]
fn set_nonexistent_storage_clsid() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    let uuid = Uuid::from_bytes(*b"ABCDEFGHIJKLMNOP");
    comp.set_storage_clsid("/foo", uuid).unwrap();
}

#[test]
#[should_panic(expected = "Not a storage")]
fn set_storage_clsid_for_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_new_stream("/foo").unwrap();
    let uuid = Uuid::from_bytes(*b"ABCDEFGHIJKLMNOP");
    comp.set_storage_clsid("/foo", uuid).unwrap();
}

//===========================================================================//
// Tests for state bits:

#[test]
fn state_bits() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("foo").unwrap();
    comp.create_storage("bar").unwrap();
    comp.set_state_bits("foo", 0x12345678).unwrap();
    comp.set_state_bits("bar", 0x0ABCDEF0).unwrap();
    assert_eq!(comp.entry("foo").unwrap().state_bits(), 0x12345678);
    assert_eq!(comp.entry("bar").unwrap().state_bits(), 0x0ABCDEF0);

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(comp.root_entry().state_bits(), 0);
    assert_eq!(comp.entry("foo").unwrap().state_bits(), 0x12345678);
    assert_eq!(comp.entry("bar").unwrap().state_bits(), 0x0ABCDEF0);
}

#[test]
#[should_panic(expected = "No such object")]
fn set_nonexistent_state_bits() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.set_state_bits("/foo", 0x12345678).unwrap();
}

//===========================================================================//
// Tests for creating storages:

#[test]
#[should_panic(expected = "Cannot create storage at \\\"/foobar\\\" \
                           because a stream already exists there")]
fn create_storage_where_stream_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    let data = vec![b'x'; 200];
    comp.create_new_stream("/foobar").unwrap().write_all(&data).unwrap();
    comp.create_storage("/foobar/").unwrap();
}

#[test]
#[should_panic(expected = "Cannot create storage at \\\"/foobar\\\" \
                           because a storage already exists there")]
fn create_storage_where_storage_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foobar/").expect("create_storage");
    comp.create_storage("/foobar/").unwrap();
}

#[test]
#[should_panic(expected = "Cannot create storage at \\\"/\\\" because a \
                           storage already exists there")]
fn create_root_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/").unwrap();
}

#[test]
fn create_storages_all() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage_all("/").unwrap();
    comp.create_storage_all("/foo/bar").unwrap();
    assert_eq!(read_storage_to_vec(&comp, "/"), vec!["foo"]);
    assert_eq!(read_storage_to_vec(&comp, "/foo"), vec!["bar"]);
    comp.create_storage_all("/foo").unwrap();
    comp.create_storage_all("/foo/bar/baz").unwrap();
    assert_eq!(read_storage_to_vec(&comp, "/foo/bar"), vec!["baz"]);
    assert!(comp.is_storage("/foo/bar/baz"));
}

#[test]
#[should_panic(expected = "Cannot create storage")]
fn create_storage_all_with_stream_in_the_way() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("foo").unwrap();
    comp.create_stream("foo/bar").unwrap();
    comp.create_storage_all("foo/bar/baz").unwrap();
}

//===========================================================================//
// Tests for removing storages:

#[test]
fn remove_storages() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.create_storage("/foo/bar").unwrap();
    comp.create_storage("/baz").unwrap();
    comp.create_storage("/quux").unwrap();
    comp.create_storage("/baz/blarg").unwrap();
    comp.remove_storage("/foo/bar").unwrap();
    comp.remove_storage("/foo").unwrap();
    comp.remove_storage("/baz/blarg").unwrap();

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(read_storage_to_vec(&comp, "/"), vec!["baz", "quux"]);
    assert!(read_storage_to_vec(&comp, "/baz").is_empty());
}

#[test]
#[should_panic(expected = "No such storage: \\\"/foo\\\"")]
fn remove_nonexistent_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.remove_storage("/foo").unwrap();
}

#[test]
#[should_panic(expected = "Cannot remove the root storage object")]
fn remove_root_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.remove_storage("/").unwrap();
}

#[test]
#[should_panic(expected = "Not a storage: \\\"/foo\\\"")]
fn remove_storage_on_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap();
    comp.remove_storage("/foo").unwrap();
}

#[test]
#[should_panic(expected = "Storage is not empty: \\\"/foo\\\"")]
fn remove_non_empty_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.create_storage("/foo/bar").unwrap();
    comp.remove_storage("/foo").unwrap();
}

#[test]
fn remove_storage_all_on_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.create_storage("/foo/bar").unwrap();
    comp.create_stream("/foo/bar/baz").unwrap();
    comp.create_stream("/foo/bar/quux").unwrap();
    comp.create_stream("/foo/blarg").unwrap();
    comp.create_storage("/stuff").unwrap();
    comp.create_stream("/stuff/foo").unwrap();
    comp.remove_storage_all("foo").unwrap();

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(read_storage_to_vec(&comp, "/"), vec!["stuff"]);
    assert_eq!(read_storage_to_vec(&comp, "/stuff"), vec!["foo"]);
}

#[test]
fn remove_storage_all_on_root() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.create_stream("/foo/bar").unwrap();
    comp.create_storage("/stuff").unwrap();
    comp.create_stream("/stuff/foo").unwrap();
    comp.remove_storage_all("/").unwrap();

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert!(read_storage_to_vec(&comp, "/").is_empty());
}

//===========================================================================//
// Tests for creating streams:

#[test]
fn create_streams() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(b"foobar").unwrap();
    comp.create_stream("/baz").unwrap().write_all(b"baz!").unwrap();

    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    {
        let mut stream = comp.open_stream("/foo").unwrap();
        let mut data = String::new();
        stream.read_to_string(&mut data).unwrap();
        assert_eq!(&data, "foobar");
    }
    {
        let mut stream = comp.open_stream("/baz").unwrap();
        let mut data = String::new();
        stream.read_to_string(&mut data).unwrap();
        assert_eq!(&data, "baz!");
    }
}

#[test]
fn create_small_stream() {
    let data = vec![b'x'; 500];

    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create_with_version(Version::V3, cursor)
        .expect("create");
    comp.create_stream("foobar").unwrap().write_all(&data).unwrap();

    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    let mut stream = comp.open_stream("foobar").unwrap();
    let mut actual_data = Vec::new();
    stream.read_to_end(&mut actual_data).unwrap();
    assert_eq!(actual_data, data);
}

#[test]
fn create_large_stream() {
    let data = vec![b'x'; 5000];

    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create_with_version(Version::V3, cursor)
        .expect("create");
    comp.create_stream("foobar").unwrap().write_all(&data).unwrap();

    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    let mut stream = comp.open_stream("foobar").unwrap();
    let mut actual_data = Vec::new();
    stream.read_to_end(&mut actual_data).unwrap();
    assert_eq!(actual_data, data);
}

#[test]
fn create_very_large_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create_with_version(Version::V3, cursor)
        .expect("create");
    {
        let mut stream = comp.create_stream("foobar").unwrap();
        let data = vec![b'x'; 1000];
        for _ in 0..1000 {
            stream.write_all(&data).unwrap();
        }
    }

    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    let mut stream = comp.open_stream("foobar").unwrap();
    assert_eq!(stream.len(), 1_000_000);
    assert_eq!(stream.seek(SeekFrom::End(0)).unwrap(), 1_000_000);
}

#[test]
fn create_stream_where_stream_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    let data1 = vec![b'x'; 200];
    comp.create_stream("/foobar").unwrap().write_all(&data1).unwrap();
    let data2 = vec![b'y'; 100];
    comp.create_stream("/foobar").unwrap().write_all(&data2).unwrap();
    let mut stream = comp.open_stream("/foobar").expect("open");
    assert_eq!(stream.len(), data2.len() as u64);
    let mut actual_data = Vec::new();
    stream.read_to_end(&mut actual_data).unwrap();
    assert_eq!(actual_data, data2);
}

#[test]
#[should_panic(expected = "Cannot create stream at \\\"/foobar\\\" \
                           because a storage already exists there")]
fn create_stream_where_storage_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foobar/").expect("create_storage");
    comp.create_stream("/foobar").unwrap();
}

#[test]
#[should_panic(expected = "Cannot create new stream at \\\"/foobar\\\" \
                           because a stream already exists there")]
fn create_new_stream_where_stream_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    let data = vec![b'x'; 200];
    comp.create_new_stream("/foobar").unwrap().write_all(&data).unwrap();
    comp.create_new_stream("/foobar").unwrap();
}

#[test]
#[should_panic(expected = "Cannot create stream at \\\"/foobar\\\" \
                           because a storage already exists there")]
fn create_new_stream_where_storage_exists() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foobar/").expect("create_storage");
    comp.create_new_stream("/foobar").unwrap();
}

//===========================================================================//
// Tests for removing streams:

#[test]
fn remove_streams() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(&vec![b'x'; 5000]).unwrap();
    comp.create_storage("/baz").unwrap();
    comp.create_storage("/quux").unwrap();
    comp.create_stream("/baz/blarg").unwrap();
    comp.remove_stream("/foo").unwrap();
    comp.remove_stream("/baz/blarg").unwrap();

    let cursor = comp.into_inner();
    let comp = CompoundFile::open(cursor).expect("open");
    assert_eq!(read_storage_to_vec(&comp, "/"), vec!["baz", "quux"]);
    assert!(read_storage_to_vec(&comp, "/baz").is_empty());
}

#[test]
fn remove_small_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("/foo").unwrap().write_all(&vec![b'x'; 500]).unwrap();
    comp.remove_stream("/foo").unwrap();
}

#[test]
#[should_panic(expected = "No such stream: \\\"/foo\\\"")]
fn remove_nonexistent_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.remove_stream("/foo").unwrap();
}

#[test]
#[should_panic(expected = "Not a stream: \\\"/foo\\\"")]
fn remove_stream_on_storage() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_storage("/foo").unwrap();
    comp.remove_stream("/foo").unwrap();
}

//===========================================================================//
// Tests for navigating within streams:

#[test]
fn truncate_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    {
        let mut stream = comp.create_stream("/foobar").unwrap();
        stream.write_all(&vec![b'x'; 5000]).unwrap();
        stream.write_all(&vec![b'y'; 5000]).unwrap();
        assert_eq!(stream.len(), 10000);
        assert_eq!(stream.seek(SeekFrom::Start(6000)).unwrap(), 6000);
        stream.set_len(7000).unwrap();
        assert_eq!(stream.len(), 7000);
        assert_eq!(stream.seek(SeekFrom::Current(0)).unwrap(), 6000);
        stream.set_len(5000).unwrap();
        assert_eq!(stream.len(), 5000);
        stream.write_all(&vec![b'x'; 1000]).unwrap();
        assert_eq!(stream.len(), 6000);
    }

    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    let mut stream = comp.open_stream("/foobar").unwrap();
    assert_eq!(stream.len(), 6000);
    let mut actual_data = Vec::new();
    stream.read_to_end(&mut actual_data).unwrap();
    assert_eq!(actual_data.len(), 6000);
    assert!(actual_data == vec![b'x'; 6000]);
}

#[test]
fn extend_stream() {
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    {
        let mut stream = comp.create_stream("/foobar").unwrap();
        assert_eq!(stream.len(), 0);
        stream.write_all(&vec![b'x'; 2000]).unwrap();
        assert_eq!(stream.len(), 2000);
        assert_eq!(stream.seek(SeekFrom::Start(1000)).unwrap(), 1000);
        stream.write_all(&vec![b'y'; 500]).unwrap();
        assert_eq!(stream.len(), 2000);
        assert_eq!(stream.seek(SeekFrom::Current(0)).unwrap(), 1500);
        stream.set_len(5000).unwrap();
        assert_eq!(stream.len(), 5000);
        assert_eq!(stream.seek(SeekFrom::Current(0)).unwrap(), 1500);
        stream.write_all(&vec![b'z'; 500]).unwrap();
        assert_eq!(stream.len(), 5000);
        assert_eq!(stream.seek(SeekFrom::Current(0)).unwrap(), 2000);
    }

    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    let mut stream = comp.open_stream("/foobar").unwrap();
    assert_eq!(stream.len(), 5000);
    let mut actual_data = Vec::new();
    stream.read_to_end(&mut actual_data).unwrap();
    assert_eq!(actual_data.len(), 5000);
    assert_eq!(&actual_data[0..1000], &[b'x'; 1000] as &[u8]);
    assert_eq!(&actual_data[1000..1500], &[b'y'; 500] as &[u8]);
    assert_eq!(&actual_data[1500..2000], &[b'z'; 500] as &[u8]);
    assert_eq!(&actual_data[2000..5000], &[0u8; 3000] as &[u8]);
}

#[test]
fn stream_seek() {
    let mut data = Vec::new();
    data.append(&mut vec![1; 128]);
    data.append(&mut vec![2; 128]);
    data.append(&mut vec![3; 128]);
    data.append(&mut vec![4; 128]);
    assert_eq!(data.len(), 512);
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create(cursor).expect("create");
    comp.create_stream("foobar").unwrap().write_all(&data).unwrap();
    let mut stream = comp.open_stream("foobar").expect("open");
    assert_eq!(stream.len(), 512);
    let mut buffer = vec![0; 128];
    assert_eq!(stream.seek(SeekFrom::Start(128)).unwrap(), 128);
    stream.read_exact(&mut buffer).unwrap();
    assert_eq!(buffer, vec![2; 128]);
    assert_eq!(stream.seek(SeekFrom::End(-128)).unwrap(), 384);
    stream.read_exact(&mut buffer).unwrap();
    assert_eq!(buffer, vec![4; 128]);
    assert_eq!(stream.seek(SeekFrom::Current(-256)).unwrap(), 256);
    stream.read_exact(&mut buffer).unwrap();
    assert_eq!(buffer, vec![3; 128]);
}

//===========================================================================//
