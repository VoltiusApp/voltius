use clap::{App, Arg, SubCommand};
use std::fs;
use std::path::PathBuf;

//===========================================================================//

fn main() {
    let matches = App::new("icotool")
        .version("0.1")
        .author("Matthew D. Steele <mdsteele@alum.mit.edu>")
        .about("Manipulates ICO files")
        .subcommand(
            SubCommand::with_name("create")
                .about("Creates an ICO file from PNG files")
                .arg(
                    Arg::with_name("output")
                        .takes_value(true)
                        .value_name("PATH")
                        .short("o")
                        .long("output")
                        .help("Sets output path"),
                )
                .arg(Arg::with_name("image").multiple(true)),
        )
        .subcommand(
            SubCommand::with_name("extract")
                .about("Extracts icons from an ICO file")
                .arg(
                    Arg::with_name("output")
                        .takes_value(true)
                        .value_name("PATH")
                        .short("o")
                        .long("output")
                        .help("Sets output path"),
                )
                .arg(Arg::with_name("ico").required(true))
                .arg(Arg::with_name("index").required(true)),
        )
        .subcommand(
            SubCommand::with_name("list")
                .about("Lists icons in an ICO file")
                .arg(Arg::with_name("ico").required(true)),
        )
        .get_matches();
    if let Some(submatches) = matches.subcommand_matches("create") {
        let out_path = if let Some(path) = submatches.value_of("output") {
            PathBuf::from(path)
        } else {
            let mut path = PathBuf::from("out.ico");
            let mut index: i32 = 0;
            while path.exists() {
                index += 1;
                path = PathBuf::from(format!("out{}.ico", index));
            }
            path
        };
        let mut icondir = ico::IconDir::new(ico::ResourceType::Icon);
        if let Some(paths) = submatches.values_of("image") {
            for path in paths {
                println!("Adding {:?}", path);
                let file = fs::File::open(path).unwrap();
                let image = ico::IconImage::read_png(file).unwrap();
                icondir.add_entry(ico::IconDirEntry::encode(&image).unwrap());
            }
        }
        let out_file = fs::File::create(out_path).unwrap();
        icondir.write(out_file).unwrap();
    } else if let Some(submatches) = matches.subcommand_matches("extract") {
        let path = submatches.value_of("ico").unwrap();
        let file = fs::File::open(path).unwrap();
        let icondir = ico::IconDir::read(file).unwrap();
        let index = submatches.value_of("index").unwrap();
        let index = index.parse::<usize>().unwrap();
        let image = icondir.entries()[index].decode().unwrap();
        let out_path = if let Some(path) = submatches.value_of("output") {
            PathBuf::from(path)
        } else {
            PathBuf::from(format!("{}.{}.png", path, index))
        };
        let out_file = fs::File::create(out_path).unwrap();
        image.write_png(out_file).unwrap();
    } else if let Some(submatches) = matches.subcommand_matches("list") {
        let path = submatches.value_of("ico").unwrap();
        let file = fs::File::open(path).unwrap();
        let icondir = ico::IconDir::read(file).unwrap();
        println!("Resource type: {:?}", icondir.resource_type());
        for (index, entry) in icondir.entries().iter().enumerate() {
            let kind = if entry.is_png() { "PNG" } else { "BMP" };
            let suffix = if let Some((x, y)) = entry.cursor_hotspot() {
                format!("hotspot at ({}, {})", x, y)
            } else {
                format!("{} bpp", entry.bits_per_pixel())
            };
            println!(
                "{:5}: {}x{} {}, {}",
                index,
                entry.width(),
                entry.height(),
                kind,
                suffix
            );
        }
    }
}

//===========================================================================//
