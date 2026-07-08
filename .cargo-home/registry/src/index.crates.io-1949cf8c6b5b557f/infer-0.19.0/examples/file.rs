use std::env::args;
use std::process::exit;

fn main() {
    let mut args = args();
    let path = match args.nth(1) {
        Some(path) => path,
        None => {
            eprintln!("Please specify the file path");
            exit(1);
        }
    };

    match infer::get_from_path(path) {
        Ok(Some(info)) => {
            println!("Through the arcane magic of this crate we determined the file type to be");
            println!("mime type: {}", info.mime_type());
            println!("extension: {}", info.extension());
        }
        Ok(None) => {
            eprintln!("Unknown file type 😞");
            eprintln!("If you think infer should be able to recognize this file type open an issue on GitHub!");
            exit(1);
        }
        Err(e) => {
            eprintln!("Looks like something went wrong 😔");
            eprintln!("{}", e);
            exit(1);
        }
    }
}
