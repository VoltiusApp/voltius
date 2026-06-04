// ─── V8 SSV decoder ───────────────────────────────────────────────────────────
//
// Chromium serializes IndexedDB values with V8's structured-clone format. Only
// the subset of tags Termius actually emits is handled here. Unknown tags abort
// the current container — preferable to silently producing wrong data.

use serde_json::{Map, Number, Value};

pub(super) fn decode_envelope(bytes: &[u8]) -> Option<Value> {
    let mut p = Parser { bytes, pos: 0 };
    // Skip leading version/header bytes until the first 'o' (object start).
    while p.pos < p.bytes.len() && p.bytes[p.pos] != b'o' {
        p.pos += 1;
    }
    if p.pos >= p.bytes.len() {
        return None;
    }
    p.pos += 1; // consume 'o'
    p.read_object()
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn advance(&mut self) -> Option<u8> {
        let b = self.peek()?;
        self.pos += 1;
        Some(b)
    }

    fn varint(&mut self) -> Option<u64> {
        let mut v = 0u64;
        let mut s = 0u32;
        while s < 64 {
            let b = self.advance()?;
            v |= ((b & 0x7f) as u64) << s;
            if b & 0x80 == 0 {
                return Some(v);
            }
            s += 7;
        }
        None
    }

    /// Skip alignment padding (V8 aligns 2-byte strings to even byte
    /// offsets with 0x00 padding bytes) and stray header markers.
    fn skip_padding(&mut self) {
        while let Some(b) = self.peek() {
            if b == 0x00 || b == 0xff {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn read_string(&mut self, tag: u8) -> Option<String> {
        let len = self.varint()? as usize;
        if self.pos + len > self.bytes.len() {
            return None;
        }
        let bytes = &self.bytes[self.pos..self.pos + len];
        self.pos += len;
        match tag {
            b'"' => {
                // V8 "OneByteString": each byte is a Latin-1 code point. For
                // ASCII data (the common case) this is identical to UTF-8.
                Some(bytes.iter().map(|&b| b as char).collect())
            }
            b'c' => {
                if !len.is_multiple_of(2) {
                    return None;
                }
                let u16s: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect();
                Some(String::from_utf16_lossy(&u16s))
            }
            b'S' => Some(String::from_utf8_lossy(bytes).into_owned()),
            _ => None,
        }
    }

    fn read_value(&mut self) -> Option<Value> {
        self.skip_padding();
        let tag = self.advance()?;
        match tag {
            b'"' | b'c' | b'S' => self.read_string(tag).map(Value::String),
            b'I' => {
                let v = self.varint()?;
                let zz = ((v >> 1) as i64) ^ -((v & 1) as i64);
                Some(Value::Number(zz.into()))
            }
            b'U' => {
                let v = self.varint()?;
                Some(Value::Number(v.into()))
            }
            b'N' => {
                if self.pos + 8 > self.bytes.len() {
                    return None;
                }
                let mut buf = [0u8; 8];
                buf.copy_from_slice(&self.bytes[self.pos..self.pos + 8]);
                self.pos += 8;
                let d = f64::from_le_bytes(buf);
                Number::from_f64(d).map(Value::Number).or(Some(Value::Null))
            }
            b'0' | b'_' => Some(Value::Null),
            b'T' => Some(Value::Bool(true)),
            b'F' => Some(Value::Bool(false)),
            b'o' => self.read_object(),
            b'A' => self.read_array(b'$'),
            b'a' => self.read_array(b'@'),
            _ => None,
        }
    }

    fn read_object(&mut self) -> Option<Value> {
        let mut map = Map::new();
        loop {
            self.skip_padding();
            if self.peek()? == b'{' {
                self.pos += 1;
                let _properties = self.varint()?;
                return Some(Value::Object(map));
            }
            let key_tag = self.advance()?;
            let key = match key_tag {
                b'"' | b'c' | b'S' => self.read_string(key_tag)?,
                _ => {
                    // Unexpected — bail out, returning what we've got.
                    return Some(Value::Object(map));
                }
            };
            let value = self.read_value()?;
            map.insert(key, value);
        }
    }

    fn read_array(&mut self, terminator: u8) -> Option<Value> {
        let _length = self.varint()?;
        let mut arr = Vec::new();
        loop {
            self.skip_padding();
            if self.peek()? == terminator {
                self.pos += 1;
                let _length2 = self.varint()?;
                let _props = self.varint()?;
                return Some(Value::Array(arr));
            }
            arr.push(self.read_value()?);
        }
    }
}

// V8 SSV builders — construct envelope bytes the way Chromium does. Shared by
// the decoder tests here and the record-extraction tests in `extract`.
#[cfg(test)]
pub(crate) mod build {
    pub fn push_varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let mut b = (v & 0x7f) as u8;
            v >>= 7;
            if v != 0 {
                b |= 0x80;
            }
            out.push(b);
            if v == 0 {
                break;
            }
        }
    }

    pub fn push_str(s: &str, out: &mut Vec<u8>) {
        out.push(b'"');
        push_varint(s.len() as u64, out);
        out.extend_from_slice(s.as_bytes());
    }

    pub fn push_int(value: i64, out: &mut Vec<u8>) {
        out.push(b'I');
        let zz = ((value << 1) ^ (value >> 63)) as u64;
        push_varint(zz, out);
    }

    pub fn push_key_int(key: &str, value: i64, out: &mut Vec<u8>) {
        push_str(key, out);
        push_int(value, out);
    }

    pub fn push_key_str(key: &str, value: &str, out: &mut Vec<u8>) {
        push_str(key, out);
        push_str(value, out);
    }

    pub fn push_key_null(key: &str, out: &mut Vec<u8>) {
        push_str(key, out);
        out.push(b'0');
    }

    pub fn push_key_obj_id(key: &str, id: i64, out: &mut Vec<u8>) {
        push_str(key, out);
        out.push(b'o');
        push_key_int("id", id, out);
        out.push(b'{');
        push_varint(1, out);
    }

    pub fn close_obj(props: u64, out: &mut Vec<u8>) {
        out.push(b'{');
        push_varint(props, out);
    }
}

#[cfg(test)]
mod tests {
    use super::build::*;
    use super::decode_envelope;

    #[test]
    fn v8_decodes_flat_object() {
        let mut bytes = vec![b'o'];
        push_key_int("id", 7347589, &mut bytes);
        push_key_str("updated_at", "2026-04-08T16:37:59", &mut bytes);
        push_key_str("status", "SYNCHRONIZED", &mut bytes);
        close_obj(3, &mut bytes);
        let v = decode_envelope(&bytes).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.get("id").and_then(|v| v.as_i64()), Some(7347589));
        assert_eq!(
            obj.get("updated_at").and_then(|v| v.as_str()),
            Some("2026-04-08T16:37:59")
        );
        assert_eq!(
            obj.get("status").and_then(|v| v.as_str()),
            Some("SYNCHRONIZED")
        );
    }

    #[test]
    fn v8_decodes_nested_object_for_foreign_keys() {
        let mut bytes = vec![b'o'];
        push_key_int("id", 45716684, &mut bytes);
        push_key_obj_id("ssh_config", 45672876, &mut bytes);
        push_key_null("group", &mut bytes);
        close_obj(3, &mut bytes);
        let v = decode_envelope(&bytes).unwrap();
        let obj = v.as_object().unwrap();
        assert_eq!(obj.get("id").and_then(|v| v.as_i64()), Some(45716684));
        let sc = obj.get("ssh_config").and_then(|v| v.as_object()).unwrap();
        assert_eq!(sc.get("id").and_then(|v| v.as_i64()), Some(45672876));
        assert!(obj.get("group").map(|v| v.is_null()).unwrap_or(false));
    }
}
