#![allow(clippy::uninit_assumed_init)]
extern crate rustc_version;

use rustc_version::{version, Version};
use std::io::Write;
use std::path::Path;
use std::{io, ops};

/// CRC-32-Castagnoli polynomial in reversed bit order.
pub const POLYNOMIAL: u32 = 0x82_F6_3B_78;

/// Table for a quadword-at-a-time software CRC.
fn sw_table() -> [[u32; 256]; 8] {
    let mut table: [[u32; 256]; 8] = [[0u32; 256]; 8];

    for n in 0..256_u32 {
        let mut crc = n;

        for _ in 0..8 {
            if crc % 2 == 0 {
                crc /= 2;
            } else {
                crc /= 2;
                crc ^= POLYNOMIAL;
            }
        }

        table[0][n as usize] = crc;
    }

    for n in 0..256 {
        let mut crc = table[0][n as usize];
        for k in 1..8 {
            crc = table[0][(crc as u8) as usize] ^ (crc >> 8);
            table[k as usize][n as usize] = crc;
        }
    }

    table
}

/// A matrix over the Galois field of two elements (0 and 1).
/// In this field, multiplication is equivalent to the (very fast) bitwise XOR.
#[derive(Debug, Copy, Clone)]
pub struct Matrix([u32; 32]);

impl Matrix {
    /// Allocates space for a new matrix.
    const fn new() -> Self {
        Self([0u32; 32])
    }

    /// Multiplies a matrix by itself.
    fn square(self) -> Self {
        let mut result = Self::new();

        for i in 0..32 {
            result[i] = self * self[i];
        }

        result
    }
}

impl ops::Index<u8> for Matrix {
    type Output = u32;

    #[inline]
    fn index(&self, i: u8) -> &Self::Output {
        &self.0[i as usize]
    }
}

impl ops::IndexMut<u8> for Matrix {
    #[inline]
    fn index_mut(&mut self, i: u8) -> &mut Self::Output {
        &mut self.0[i as usize]
    }
}

impl ops::Mul<u32> for Matrix {
    type Output = u32;

    /// Multiplies the matrix with a vector.
    fn mul(self, mut vec: u32) -> Self::Output {
        let mut sum = 0;
        let mut i = 0;

        while vec != 0 {
            if vec % 2 != 0 {
                sum ^= self[i];
            }

            vec /= 2;

            i += 1;
        }

        sum
    }
}

fn create_zero_operator(mut len: usize) -> Matrix {
    // Operator for odd powers-of-two.
    let mut odd = Matrix::new();

    odd[0] = POLYNOMIAL;

    for i in 1..32 {
        odd[i] = 1 << (i - 1);
    }

    let mut even = odd.square();

    let mut odd = even.square();

    loop {
        even = odd.square();

        len /= 2;

        if len == 0 {
            return even;
        }

        odd = even.square();

        len /= 2;

        if len == 0 {
            return odd;
        }
    }
}

fn hw_table(len: usize) -> [[u32; 256]; 4] {
    let mut zeroes: [[u32; 256]; 4] = [[0u32; 256]; 4];
    let op = create_zero_operator(len);

    for n in 0..256_u32 {
        for i in 0..4_u32 {
            let shift = i * 8;
            zeroes[i as usize][n as usize] = op * (n << shift);
        }
    }

    zeroes
}

// LONG/SHORT VALUES MUST BE SYNCHRONIZED WITH src/tables.rs
pub const LONG: usize = 8192;
pub const SHORT: usize = 256;

fn write_table(table: &[[u32; 256]], path: &Path) -> io::Result<()> {
    let mut file = {
        let file = std::fs::File::create(path)?;
        io::BufWriter::new(file)
    };

    write!(file, "[")?;

    for row in table {
        write!(file, "[")?;
        for element in row {
            write!(file, "{element}, ")?;
        }
        write!(file, "],")?;
    }

    write!(file, "]")?;

    Ok(())
}

fn write_tables() -> io::Result<()> {
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let out_dir = std::path::Path::new(&out_dir);

    write_table(&sw_table(), &out_dir.join("sw.table"))?;

    write_table(&hw_table(LONG), &out_dir.join("hw.long.table"))?;
    write_table(&hw_table(SHORT), &out_dir.join("hw.short.table"))
}

fn main() {
    write_tables().expect("Failed to write CRC tables");
    let min_version = Version::new(1, 80, 0);

    let current_version = {
        // remove prerelease tag for now, if it exists.
        let vers = version().unwrap();
        Version::new(vers.major, vers.minor, vers.patch)
    };

    if current_version >= min_version {
        println!("cargo::rustc-check-cfg=cfg(armsimd)");
        println!("cargo::rustc-cfg=armsimd");
    }
}
