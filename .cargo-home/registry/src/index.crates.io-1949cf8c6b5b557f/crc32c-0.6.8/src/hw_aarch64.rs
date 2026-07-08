use crate::hw_tables;
use crate::util::{self, U64Le};
use std::arch::aarch64 as simd;

pub unsafe fn crc32c(crci: u32, buffer: &[u8]) -> u32 {
    let mut crc0 = !crci;
    let (begin, middle, end) = util::split(buffer);

    // We're effectively cheating by using the software implementation
    // for now. The bit-flips simulate going back-and-forth between
    // the inner computations of the software implementation
    //
    // This needs a little more optimization, and to use the typical
    // crc32cb instruction rather than using the software implementation.
    crc0 = crc_u8(crc0, begin);

    // Most CPUs have a latency of 3 on these instructions,
    // meaning we must use 3 of them at a time, to leverage
    // hardware parallelism.
    //
    // TODO: validate that this is true on ARM
    //
    // First do chunks of size LONG * 3.
    let chunk_size = (hw_tables::LONG * 3) / 8;
    let last_chunk = middle.len() / chunk_size * chunk_size;

    let (middle_first, middle_last) = middle.split_at(last_chunk);

    crc0 = crc_u64_parallel3(crc0, chunk_size, &hw_tables::LONG_TABLE, middle_first);

    // Now do chunks of size SHORT * 3.
    let chunk_size = (hw_tables::SHORT * 3) / 8;
    let last_chunk = middle_last.len() / chunk_size * chunk_size;

    let (middle_last_first, middle_last_last) = middle_last.split_at(last_chunk);

    crc0 = crc_u64_parallel3(crc0, chunk_size, &hw_tables::SHORT_TABLE, middle_last_first);

    // Now the last part, less than SHORT * 3 but still a multiple of 8-bytes.
    crc0 = crc_u64(crc0, middle_last_last);

    !crc_u8(crc0, end)
}

#[inline]
#[target_feature(enable = "crc")]
unsafe fn crc_u8(crc: u32, buffer: &[u8]) -> u32 {
    buffer
        .iter()
        .fold(crc, |crc, &next| simd::__crc32cb(crc, next))
}

#[inline(always)]
unsafe fn crc_u64(crc: u32, words: &[U64Le]) -> u32 {
    words
        .iter()
        .fold(crc, |crc, &next| crc_u64_append(crc, next.get()))
}

#[inline(always)]
unsafe fn crc_u64_append(crc: u32, next: u64) -> u32 {
    simd::__crc32cd(crc, next)
}

#[inline(always)]
unsafe fn crc_u64_parallel3(
    crc: u32,
    chunk_size: usize,
    table: &hw_tables::CrcTable,
    buffer: &[U64Le],
) -> u32 {
    buffer.chunks(chunk_size).fold(crc, |mut crc0, chunk| {
        let mut crc1 = 0;
        let mut crc2 = 0;

        // Divide it in three.
        let block_size = chunk_size / 3;

        let mut blocks = chunk.chunks(block_size);
        let a = blocks.next().unwrap();
        let b = blocks.next().unwrap();
        let c = blocks.next().unwrap();

        for i in 0..block_size {
            crc0 = crc_u64_append(crc0, a[i].get());
            crc1 = crc_u64_append(crc1, b[i].get());
            crc2 = crc_u64_append(crc2, c[i].get());
        }

        crc0 = table.shift_u32(crc0) ^ crc1;
        crc0 = table.shift_u32(crc0) ^ crc2;

        crc0
    })
}
