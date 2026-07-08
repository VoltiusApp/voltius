//! Request Key Implementation (replacement for /sbin/request-key)
//!
//! https://www.kernel.org/doc/html/v4.15/security/keys/request-key.html
use clap::Parser;
use linux_keyutils::{Key, KeyRingIdentifier, KeySerialId};
use std::error::Error;
use zeroize::Zeroizing;

#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
#[command(arg_required_else_help(true))]
#[command(subcommand_required(true))]
struct Args {
    #[clap(subcommand)]
    subcommand: Command,
}

#[derive(clap::Subcommand, Debug, PartialEq)]
#[command(arg_required_else_help(true))]
enum Command {
    /// Kernel invokes this program with the following parameters
    ///
    /// https://github.com/torvalds/linux/blob/7d06015d936c861160803e020f68f413b5c3cd9d/security/keys/request_key.c#L116
    ///
    /// Path is hard coded to /sbin/request-key
    Create {
        key_id: i32,
        uid: u32,
        gid: u32,
        thread_ring: i32,
        process_ring: i32,
        session_ring: i32,
    },
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = Args::parse();
    _ = match args.subcommand {
        // Add a new key to the keyring
        Command::Create {
            key_id,
            uid,
            gid,
            thread_ring: _,
            process_ring: _,
            session_ring,
        } => {
            // Assume authority over the temporary key
            let key = Key::from_id(KeySerialId(key_id));
            key.assume_authority()?;

            // Ensure the ownership is correct
            key.chown(Some(uid), Some(gid))?;

            // Read payload from special key KeyRingIdentifier::ReqKeyAuthKey
            let reqkey = Key::from_id(KeySerialId(KeyRingIdentifier::ReqKeyAuthKey as i32));
            let mut buf = Zeroizing::new([0u8; 2048]);
            let len = reqkey.read(&mut buf)?;

            // Instantiate key
            key.instantiate(&buf[..len], KeySerialId(session_ring))?;
        }
    };
    Ok(())
}
