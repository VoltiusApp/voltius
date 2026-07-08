use criterion::{black_box, criterion_group, criterion_main, Criterion};

use http_range::HttpRange;

pub fn criterion_benchmark(c: &mut Criterion) {
    c.bench_function("bytes=7", |b| {
        b.iter(|| HttpRange::parse(black_box("bytes=7"), black_box(10)))
    });
    c.bench_function("bytes=-7", |b| {
        b.iter(|| HttpRange::parse(black_box("bytes=-7"), black_box(10)))
    });
    c.bench_function("bytes=500-700,601-999", |b| {
        b.iter(|| HttpRange::parse(black_box("bytes=500-700,601-999"), black_box(10000)))
    });
    c.bench_function("bytes=9500-", |b| {
        b.iter(|| HttpRange::parse(black_box("bytes=9500-"), black_box(10000)))
    });
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
