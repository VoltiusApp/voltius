use integer_encoding::VarInt;

use std::io::{self, BufRead};
use std::str::FromStr;

fn binencode(b: &[u8]) -> String {
    let mut s = String::new();
    for byte in b {
        s.push_str(&format!("{:08b} ", byte));
    }
    s
}

fn main() {
    let stdin = io::BufReader::new(io::stdin());

    println!("Enter decimal numbers here:\n");
    for l in stdin.lines() {
        if l.is_err() {
            break;
        }
        let l = l.unwrap();
        match i64::from_str(&l) {
            Ok(i) => println!(
                "fixed: {:b} encoded (unsigned): {} encoded (signed): {}",
                i,
                if i >= 0 {
                    binencode(&(i as u64).encode_var_vec())
                } else {
                    "-".to_string()
                },
                binencode(&i.encode_var_vec())
            ),
            Err(e) => println!("{:?}", e),
        }
    }
}
