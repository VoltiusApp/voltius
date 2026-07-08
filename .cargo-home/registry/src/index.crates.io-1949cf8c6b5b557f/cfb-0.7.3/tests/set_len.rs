use cfb::{CompoundFile, Version};
use std::io::{Cursor, Read, Write};

//===========================================================================//

fn create_data(len: usize) -> Vec<u8> {
    let mut data = Vec::<u8>::new();
    let mut number = 0u32;
    while data.len() < len {
        data.extend_from_slice(number.to_string().as_bytes());
        number += 1;
    }
    data.truncate(len);
    data
}

fn test_set_stream_len(initial_len: usize, resize_len: usize) {
    let data = create_data(initial_len);
    let cursor = Cursor::new(Vec::new());
    let mut comp = CompoundFile::create_with_version(Version::V3, cursor)
        .expect("create");
    {
        let mut stream = comp.create_stream("/foobar").unwrap();
        stream.write_all(&data).unwrap();
    }
    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    {
        let mut stream = comp.open_stream("/foobar").unwrap();
        assert_eq!(stream.len(), initial_len as u64);
        stream.set_len(resize_len as u64).unwrap();
    }
    let cursor = comp.into_inner();
    let mut comp = CompoundFile::open(cursor).expect("open");
    {
        let mut stream = comp.open_stream("/foobar").unwrap();
        assert_eq!(stream.len(), resize_len as u64);
        let mut actual_data = Vec::new();
        stream.read_to_end(&mut actual_data).unwrap();
        assert_eq!(actual_data.len(), resize_len);
        if resize_len <= initial_len {
            assert_eq!(actual_data, data[..resize_len]);
        } else {
            assert_eq!(actual_data[..initial_len], data);
            assert_eq!(
                actual_data[initial_len..],
                vec![0u8; resize_len - initial_len]
            );
        }
    }
}

//===========================================================================//

#[test]
fn resize_zero_to_zero() {
    test_set_stream_len(0, 0);
}

#[test]
fn resize_small_to_zero() {
    test_set_stream_len(1000, 0);
}

#[test]
fn resize_large_to_zero() {
    test_set_stream_len(5000, 0);
}

#[test]
fn resize_small_to_slightly_smaller() {
    test_set_stream_len(1000, 900);
}

#[test]
fn resize_small_to_slightly_bigger() {
    test_set_stream_len(1000, 1100);
}

#[test]
fn resize_small_to_large() {
    test_set_stream_len(1000, 5000);
}

#[test]
fn resize_large_to_small() {
    test_set_stream_len(5000, 1000);
}

#[test]
fn resize_large_to_huge() {
    test_set_stream_len(5000, 10000);
}

#[test]
fn resize_huge_to_large() {
    test_set_stream_len(10000, 5000);
}

//===========================================================================//
