//! # http-range
//!
//! HTTP Range header parser.
//! Inspired by Go's net/http library.

static PREFIX: &'static [u8] = b"bytes=";
const PREFIX_LEN: usize = 6;

/// Range parsing error
#[derive(Debug)]
pub enum HttpRangeParseError {
    /// Returned if range is invalid.
    InvalidRange,
    /// Returned if first-byte-pos of all of the byte-range-spec
    /// values is greater than the content size.
    /// See https://github.com/golang/go/commit/aa9b3d7
    NoOverlap,
}

/// HTTP Range header representation.
#[derive(Debug, Clone, Copy)]
pub struct HttpRange {
    pub start: u64,
    pub length: u64,
}

impl HttpRange {
    /// Parses Range HTTP header string as per RFC 2616.
    ///
    /// `header` is HTTP Range header (e.g. `bytes=bytes=0-9`).
    /// `size` is full size of response (file).
    pub fn parse(header: &str, size: u64) -> Result<Vec<HttpRange>, HttpRangeParseError> {
        Self::parse_bytes(header.as_bytes(), size)
    }

    pub fn parse_bytes(header: &[u8], size: u64) -> Result<Vec<HttpRange>, HttpRangeParseError> {
        if header.is_empty() {
            return Ok(Vec::new());
        }

        if !header.starts_with(PREFIX) {
            return Err(HttpRangeParseError::InvalidRange);
        }

        let mut no_overlap = false;

        let ranges: Vec<HttpRange> = header[PREFIX_LEN..]
            .split(|b| *b == b',')
            .filter_map(|ra| {
                let ra = ra.trim();
                if ra.is_empty() {
                    return None;
                }
                match Self::parse_single_range(ra, size) {
                    Ok(Some(range)) => Some(Ok(range)),
                    Ok(None) => {
                        no_overlap = true;
                        None
                    }
                    Err(e) => Some(Err(e)),
                }
            })
            .collect::<Result<_, _>>()?;

        if no_overlap && ranges.is_empty() {
            return Err(HttpRangeParseError::NoOverlap);
        }

        Ok(ranges)
    }

    fn parse_single_range(
        bytes: &[u8],
        size: u64,
    ) -> Result<Option<HttpRange>, HttpRangeParseError> {
        let mut start_end_iter = bytes.splitn(2, |b| *b == b'-');

        let start_str = start_end_iter
            .next()
            .ok_or(HttpRangeParseError::InvalidRange)?
            .trim();
        let end_str = start_end_iter
            .next()
            .ok_or(HttpRangeParseError::InvalidRange)?
            .trim();

        if start_str.is_empty() {
            // If no start is specified, end specifies the
            // range start relative to the end of the file,
            // and we are dealing with <suffix-length>
            // which has to be a non-negative integer as per
            // RFC 7233 Section 2.1 "Byte-Ranges".
            if end_str.is_empty() || end_str[0] == b'-' {
                return Err(HttpRangeParseError::InvalidRange);
            }

            let mut length: u64 = end_str
                .parse_u64()
                .map_err(|_| HttpRangeParseError::InvalidRange)?;

            if length == 0 {
                return Ok(None);
            }

            if length > size {
                length = size;
            }

            Ok(Some(HttpRange {
                start: (size - length),
                length,
            }))
        } else {
            let start: u64 = start_str
                .parse_u64()
                .map_err(|_| HttpRangeParseError::InvalidRange)?;

            if start >= size {
                return Ok(None);
            }

            let length = if end_str.is_empty() {
                // If no end is specified, range extends to end of the file.
                size - start
            } else {
                let mut end: u64 = end_str
                    .parse_u64()
                    .map_err(|_| HttpRangeParseError::InvalidRange)?;

                if start > end {
                    return Err(HttpRangeParseError::InvalidRange);
                }

                if end >= size {
                    end = size - 1;
                }

                end - start + 1
            };

            Ok(Some(HttpRange { start, length }))
        }
    }
}

trait SliceExt {
    fn trim(&self) -> &Self;
    fn parse_u64(&self) -> Result<u64, ()>;
}

impl SliceExt for [u8] {
    fn trim(&self) -> &[u8] {
        fn is_whitespace(c: &u8) -> bool {
            *c == b'\t' || *c == b' '
        }

        fn is_not_whitespace(c: &u8) -> bool {
            !is_whitespace(c)
        }

        if let Some(first) = self.iter().position(is_not_whitespace) {
            if let Some(last) = self.iter().rposition(is_not_whitespace) {
                &self[first..last + 1]
            } else {
                unreachable!();
            }
        } else {
            &[]
        }
    }

    fn parse_u64(&self) -> Result<u64, ()> {
        if self.is_empty() {
            return Err(());
        }
        let mut res = 0u64;
        for b in self {
            if *b >= b'0' && *b <= b'9' {
                res = res
                    .checked_mul(10)
                    .ok_or(())?
                    .checked_add((b - b'0') as u64)
                    .ok_or(())?;
            } else {
                return Err(());
            }
        }

        Ok(res)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct T(&'static str, u64, Vec<HttpRange>);

    #[test]
    fn test_parse() {
        let tests = vec![
            T("", 0, vec![]),
            T("", 1000, vec![]),
            T("foo", 0, vec![]),
            T("bytes=", 0, vec![]),
            T("bytes=", 200, vec![]),
            T("bytes=7", 10, vec![]),
            T("bytes= 7 ", 10, vec![]),
            T("bytes=1-", 0, vec![]),
            T("bytes=5-4", 10, vec![]),
            T("bytes=--6", 200, vec![]),
            T("bytes=--0", 200, vec![]),
            T("bytes=---0", 200, vec![]),
            T(
                "bytes=-6",
                200,
                vec![HttpRange {
                    start: 194,
                    length: 6,
                }],
            ),
            T(
                "bytes=6-",
                200,
                vec![HttpRange {
                    start: 6,
                    length: 194,
                }],
            ),
            T("bytes=-6-", 0, vec![]),
            T("bytes=-0", 200, vec![]),
            T("bytes=0-2,5-4", 10, vec![]),
            T("bytes=2-5,4-3", 10, vec![]),
            T("bytes=--5,4--3", 10, vec![]),
            T("bytes=A-", 10, vec![]),
            T("bytes=A- ", 10, vec![]),
            T("bytes=A-Z", 10, vec![]),
            T("bytes= -Z", 10, vec![]),
            T("bytes=5-Z", 10, vec![]),
            T("bytes=Ran-dom, garbage", 10, vec![]),
            T("bytes=0x01-0x02", 10, vec![]),
            T("bytes=         ", 10, vec![]),
            T("bytes= , , ,   ", 10, vec![]),
            T(
                "bytes=0-9",
                10,
                vec![HttpRange {
                    start: 0,
                    length: 10,
                }],
            ),
            T(
                "bytes=0-",
                10,
                vec![HttpRange {
                    start: 0,
                    length: 10,
                }],
            ),
            T(
                "bytes=5-",
                10,
                vec![HttpRange {
                    start: 5,
                    length: 5,
                }],
            ),
            T(
                "bytes=0-20",
                10,
                vec![HttpRange {
                    start: 0,
                    length: 10,
                }],
            ),
            T(
                "bytes=15-,0-5",
                10,
                vec![HttpRange {
                    start: 0,
                    length: 6,
                }],
            ),
            T(
                "bytes=1-2,5-",
                10,
                vec![
                    HttpRange {
                        start: 1,
                        length: 2,
                    },
                    HttpRange {
                        start: 5,
                        length: 5,
                    },
                ],
            ),
            T(
                "bytes=-2 , 7-",
                11,
                vec![
                    HttpRange {
                        start: 9,
                        length: 2,
                    },
                    HttpRange {
                        start: 7,
                        length: 4,
                    },
                ],
            ),
            T(
                "bytes=0-0 ,2-2, 7-",
                11,
                vec![
                    HttpRange {
                        start: 0,
                        length: 1,
                    },
                    HttpRange {
                        start: 2,
                        length: 1,
                    },
                    HttpRange {
                        start: 7,
                        length: 4,
                    },
                ],
            ),
            T(
                "bytes=-5",
                10,
                vec![HttpRange {
                    start: 5,
                    length: 5,
                }],
            ),
            T(
                "bytes=-15",
                10,
                vec![HttpRange {
                    start: 0,
                    length: 10,
                }],
            ),
            T(
                "bytes=0-499",
                10000,
                vec![HttpRange {
                    start: 0,
                    length: 500,
                }],
            ),
            T(
                "bytes=500-999",
                10000,
                vec![HttpRange {
                    start: 500,
                    length: 500,
                }],
            ),
            T(
                "bytes=-500",
                10000,
                vec![HttpRange {
                    start: 9500,
                    length: 500,
                }],
            ),
            T(
                "bytes=9500-",
                10000,
                vec![HttpRange {
                    start: 9500,
                    length: 500,
                }],
            ),
            T(
                "bytes=0-0,-1",
                10000,
                vec![
                    HttpRange {
                        start: 0,
                        length: 1,
                    },
                    HttpRange {
                        start: 9999,
                        length: 1,
                    },
                ],
            ),
            T(
                "bytes=500-600,601-999",
                10000,
                vec![
                    HttpRange {
                        start: 500,
                        length: 101,
                    },
                    HttpRange {
                        start: 601,
                        length: 399,
                    },
                ],
            ),
            T(
                "bytes=500-700,601-999",
                10000,
                vec![
                    HttpRange {
                        start: 500,
                        length: 201,
                    },
                    HttpRange {
                        start: 601,
                        length: 399,
                    },
                ],
            ),
            // Match Apache laxity:
            T(
                "bytes=   1 -2   ,  4- 5, 7 - 8 , ,,",
                11,
                vec![
                    HttpRange {
                        start: 1,
                        length: 2,
                    },
                    HttpRange {
                        start: 4,
                        length: 2,
                    },
                    HttpRange {
                        start: 7,
                        length: 2,
                    },
                ],
            ),
            T(
                "bytes=50-60,2-3",
                10,
                vec![HttpRange {
                    start: 2,
                    length: 2,
                }],
            ),
            T(
                "bytes=50-60,-5",
                10,
                vec![HttpRange {
                    start: 5,
                    length: 5,
                }],
            ),
            T(
                "bytes=50-60,7-",
                10,
                vec![HttpRange {
                    start: 7,
                    length: 3,
                }],
            ),
            T("bytes=50-60,20-", 10, vec![]),
            T(
                "bytes=50-60,20-,3-4",
                10,
                vec![HttpRange {
                    start: 3,
                    length: 2,
                }],
            ),
            T(
                "bytes=9-20,-5",
                10,
                vec![
                    HttpRange {
                        start: 9,
                        length: 1,
                    },
                    HttpRange {
                        start: 5,
                        length: 5,
                    },
                ],
            ),
            T("bytes=15-20,-0", 10, vec![]),
            T(
                "bytes=15-20,-0",
                20,
                vec![HttpRange {
                    start: 15,
                    length: 5,
                }],
            ),
            T("bytes=1-2,bytes=3-4", 10, vec![]),
            T("bytes=1-2,blergh=3-4", 10, vec![]),
            T("blergh=1-2,bytes=3-4", 10, vec![]),
            T("bytes=-0", 0, vec![]),
            T("bytes=-0", 5, vec![]),
            T(
                "bytes=-1",
                0,
                vec![HttpRange {
                    start: 0,
                    length: 0,
                }],
            ),
            T(
                "bytes=0-99999999999999999999999999999999999999999999",
                10,
                vec![],
            ),
        ];

        for t in tests {
            let header = t.0;
            let size = t.1;
            let expected = t.2;

            let res = HttpRange::parse(header, size);

            if res.is_err() {
                if expected.is_empty() {
                    continue;
                } else {
                    assert!(
                        false,
                        "parse({}, {}) returned error {:?}",
                        header,
                        size,
                        res.unwrap_err()
                    );
                }
            }

            let got = res.unwrap();

            if got.len() != expected.len() {
                assert!(
                    false,
                    "len(parseRange({}, {})) = {}, want {}",
                    header,
                    size,
                    got.len(),
                    expected.len()
                );
                continue;
            }

            for i in 0..expected.len() {
                if got[i].start != expected[i].start {
                    assert!(
                        false,
                        "parseRange({}, {})[{}].start = {}, want {}",
                        header, size, i, got[i].start, expected[i].start
                    )
                }
                if got[i].length != expected[i].length {
                    assert!(
                        false,
                        "parseRange({}, {})[{}].length = {}, want {}",
                        header, size, i, got[i].length, expected[i].length
                    )
                }
            }
        }
    }
}
