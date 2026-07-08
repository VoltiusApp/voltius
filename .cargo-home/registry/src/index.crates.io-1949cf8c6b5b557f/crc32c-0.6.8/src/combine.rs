//! Implements the CRC32c "combine" function, which calculates the CRC32c of two byte streams
//! concatenated together using their individual CRC32c values (plus the length of the second byte
//! stream).
//!
//! This module is essentially a line-by-line translation of ZLIB's CRC "combine" function
//! implementation from C to Rust, except for the CRC polynomial used (original uses the CRC32
//! polynomial 0xedb88320UL, we use the CRC32c polynomial 0x82F63B78).
//!
//! Link to original implementation: https://github.com/madler/zlib/blob/master/crc32.c
//!
//! This file is based on the Zlib project, located at: https://github.com/madler/zlib,
//! which includes the following notice:
//!
//! crc32.c -- compute the CRC-32 of a data stream
//! Copyright (C) 1995-2006, 2010, 2011, 2012, 2016 Mark Adler
//! For conditions of distribution and use, see copyright notice in zlib.h
//!
//! Thanks to Rodney Brown <rbrown64@csc.com.au> for his contribution of faster
//! CRC methods: exclusive-oring 32 bits of data at a time, and pre-computing
//! tables for updating the shift register in one step with three exclusive-ors
//! instead of four steps with four exclusive-ors.  This results in about a
//! factor of two increase in speed on a Power PC G4 (PPC7455) using gcc -O3.

const GF2_DIM: usize = 32;

fn gf2_matrix_times(mat: &[u32; GF2_DIM], mut vec: u32) -> u32 {
    let mut sum = 0;
    let mut idx = 0;
    while vec > 0 {
        if vec & 1 == 1 {
            sum ^= mat[idx];
        }
        vec >>= 1;
        idx += 1;
    }
    sum
}

fn gf2_matrix_square(square: &mut [u32; GF2_DIM], mat: &[u32; GF2_DIM]) {
    for n in 0..GF2_DIM {
        square[n] = gf2_matrix_times(mat, mat[n]);
    }
}

pub(crate) fn crc32c_combine(mut crc1: u32, crc2: u32, mut len2: usize) -> u32 {
    let mut row: u32 = 1;
    let mut even = [0u32; GF2_DIM]; /* even-power-of-two zeros operator */
    let mut odd = [0u32; GF2_DIM]; /* odd-power-of-two zeros operator */

    /* degenerate case (also disallow negative lengths) */
    if len2 == 0 {
        return crc1;
    }

    /* put operator for one zero bit in odd */
    odd[0] = 0x82F63B78; /* CRC-32c polynomial */
    #[allow(clippy::needless_range_loop)]
    for n in 1..GF2_DIM {
        odd[n] = row;
        row <<= 1;
    }

    /* put operator for two zero bits in even */
    gf2_matrix_square(&mut even, &odd);

    /* put operator for four zero bits in odd */
    gf2_matrix_square(&mut odd, &even);

    /* apply len2 zeros to crc1 (first square will put the operator for one
    zero byte, eight zero bits, in even) */
    loop {
        /* apply zeros operator for this bit of len2 */
        gf2_matrix_square(&mut even, &odd);
        if len2 & 1 == 1 {
            crc1 = gf2_matrix_times(&even, crc1);
        }
        len2 >>= 1;

        /* if no more bits set, then done */
        if len2 == 0 {
            break;
        }

        /* another iteration of the loop with odd and even swapped */
        gf2_matrix_square(&mut odd, &even);
        if len2 & 1 == 1 {
            crc1 = gf2_matrix_times(&odd, crc1);
        }
        len2 >>= 1;

        /* if no more bits set, then done */
        if len2 == 0 {
            break;
        }
    }

    /* return combined crc */
    crc1 ^= crc2;
    crc1
}
