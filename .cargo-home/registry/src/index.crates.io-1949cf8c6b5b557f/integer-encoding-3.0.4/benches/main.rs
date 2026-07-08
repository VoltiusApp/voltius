use bencher::Bencher;

use integer_encoding::*;

fn encode_v(b: &mut Bencher) {
    let my_u64s = [
        9494929199119074561,
        3823923198123425321,
        2595862268225688522,
        1231230009321245673,
        2909812083312547546,
        3492011001874124465,
        4848848884210156473,
        4012941340125654654,
    ] as [u64; 8];
    let my_i64s = [
        -122193043711204545,
        2446312246543212452,
        -445854216865433664,
        3242135654513135465,
        -543122132545464312,
        3613543123031434343,
        -431231254654543211,
        7854615463131234543,
    ] as [i64; 8];

    let mut dst = [0 as u8; 10];

    b.iter(|| {
        // 8x each.
        my_u64s[0].encode_var(&mut dst);
        my_u64s[1].encode_var(&mut dst);
        my_u64s[2].encode_var(&mut dst);
        my_u64s[3].encode_var(&mut dst);
        my_u64s[4].encode_var(&mut dst);
        my_u64s[5].encode_var(&mut dst);
        my_u64s[6].encode_var(&mut dst);
        my_u64s[7].encode_var(&mut dst);

        my_i64s[0].encode_var(&mut dst);
        my_i64s[1].encode_var(&mut dst);
        my_i64s[2].encode_var(&mut dst);
        my_i64s[3].encode_var(&mut dst);
        my_i64s[4].encode_var(&mut dst);
        my_i64s[5].encode_var(&mut dst);
        my_i64s[6].encode_var(&mut dst);
        my_i64s[7].encode_var(&mut dst);
    });
}

fn decode_v(b: &mut Bencher) {
    let my_u64s = [
        9494929199119074561,
        3823923198123425321,
        2595862268225688522,
        1231230009321245673,
        2909812083312547546,
        3492011001874124465,
        4848848884210156473,
        4012941340125654654,
    ] as [u64; 8];
    let my_i64s = [
        -122193043711204545,
        2446312246543212452,
        -445854216865433664,
        3242135654513135465,
        -543122132545464312,
        3613543123031434343,
        -431231254654543211,
        7854615463131234543,
    ] as [i64; 8];

    let u64_src = [
        my_u64s[0].encode_var_vec(),
        my_u64s[1].encode_var_vec(),
        my_u64s[2].encode_var_vec(),
        my_u64s[3].encode_var_vec(),
        my_u64s[4].encode_var_vec(),
        my_u64s[5].encode_var_vec(),
        my_u64s[6].encode_var_vec(),
        my_u64s[7].encode_var_vec(),
    ] as [Vec<u8>; 8];
    let i64_src = [
        my_i64s[0].encode_var_vec(),
        my_i64s[1].encode_var_vec(),
        my_i64s[2].encode_var_vec(),
        my_i64s[3].encode_var_vec(),
        my_i64s[4].encode_var_vec(),
        my_i64s[5].encode_var_vec(),
        my_i64s[6].encode_var_vec(),
        my_i64s[7].encode_var_vec(),
    ] as [Vec<u8>; 8];

    b.iter(|| {
        // 8x each.
        u64::decode_var(&u64_src[0]).unwrap();
        u64::decode_var(&u64_src[1]).unwrap();
        u64::decode_var(&u64_src[2]).unwrap();
        u64::decode_var(&u64_src[3]).unwrap();
        u64::decode_var(&u64_src[4]).unwrap();
        u64::decode_var(&u64_src[5]).unwrap();
        u64::decode_var(&u64_src[6]).unwrap();
        u64::decode_var(&u64_src[7]).unwrap();

        i64::decode_var(&i64_src[0]).unwrap();
        i64::decode_var(&i64_src[1]).unwrap();
        i64::decode_var(&i64_src[2]).unwrap();
        i64::decode_var(&i64_src[3]).unwrap();
        i64::decode_var(&i64_src[4]).unwrap();
        i64::decode_var(&i64_src[5]).unwrap();
        i64::decode_var(&i64_src[6]).unwrap();
        i64::decode_var(&i64_src[7]).unwrap();
    });
}

bencher::benchmark_group!(varint_benches, encode_v, decode_v);

fn encode_f(b: &mut Bencher) {
    let my_u64 = 94949291991190 as u64;
    let my_i64 = -12219304371120 as i64;

    let mut dst = [0 as u8; 8];

    b.iter(|| {
        // 8x each.
        my_u64.encode_fixed(&mut dst);
        my_u64.encode_fixed(&mut dst);
        my_u64.encode_fixed(&mut dst);
        my_u64.encode_fixed(&mut dst);
        my_u64.encode_fixed(&mut dst);
        my_u64.encode_fixed(&mut dst);
        my_u64.encode_fixed(&mut dst);

        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
        my_i64.encode_fixed(&mut dst);
    });
}

fn decode_f(b: &mut Bencher) {
    let my_u64 = 94949291991190 as u64;
    let my_i64 = -12219304371120 as i64;

    let u64_src = my_u64.encode_fixed_vec();
    let i64_src = my_i64.encode_fixed_vec();

    b.iter(|| {
        // 8x each.
        u64::decode_fixed(&u64_src);
        u64::decode_fixed(&u64_src);
        u64::decode_fixed(&u64_src);
        u64::decode_fixed(&u64_src);
        u64::decode_fixed(&u64_src);
        u64::decode_fixed(&u64_src);
        u64::decode_fixed(&u64_src);

        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
        i64::decode_fixed(&i64_src);
    });
}

bencher::benchmark_group!(fixedint_benches, encode_f, decode_f);

bencher::benchmark_main!(varint_benches, fixedint_benches);
