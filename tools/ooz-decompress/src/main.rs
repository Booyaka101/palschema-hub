//! Decompress Oodle-compressed blocks straight out of a UE .pak.
//!
//! Palworld statically links Oodle and ships no redistributable oo2core, so the
//! decompressor is the pure-Rust `oozextract` crate rather than a proprietary
//! DLL. This is the only non-JavaScript piece of the extraction pipeline, and it
//! is maintainer-only tooling: the registry ships the extracted JSON, so nobody
//! installing palschema-validate needs Rust.
//!
//! Usage: ooz-decompress <pak> <jobfile>
//!
//! Job file is line based, so no serde dependency:
//!   FILE <output path>
//!   <absolute block offset> <compressed size> <uncompressed size>
//!   ...repeated, and repeated per FILE

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: ooz-decompress <pak> <jobfile>");
        std::process::exit(2);
    }
    let mut pak = File::open(&args[1])?;
    let jobs = BufReader::new(File::open(&args[2])?);

    let mut out: Option<File> = None;
    let mut path = String::new();
    let mut files = 0usize;
    let mut bytes = 0usize;
    let mut extractor = oozextract::Extractor::new();

    for line in jobs.lines() {
        let line = line?;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("FILE ") {
            path = rest.to_string();
            out = Some(File::create(&path)?);
            files += 1;
            continue;
        }
        let p: Vec<u64> = line
            .split_whitespace()
            .map(|x| x.parse::<u64>())
            .collect::<Result<_, _>>()?;
        if p.len() != 3 {
            return Err(format!("bad block line: {line}").into());
        }
        let (off, csize, usize_) = (p[0], p[1] as usize, p[2] as usize);

        let mut comp = vec![0u8; csize];
        pak.seek(SeekFrom::Start(off))?;
        pak.read_exact(&mut comp)?;

        let mut dec = vec![0u8; usize_];
        extractor
            .read_from_slice(&comp, &mut dec)
            .map_err(|e| format!("{path}: block at {off} ({csize} -> {usize_}): {e:?}"))?;

        out.as_mut()
            .ok_or("block line before any FILE line")?
            .write_all(&dec)?;
        bytes += dec.len();
    }
    eprintln!("ooz-decompress: {files} file(s), {bytes} bytes");
    Ok(())
}
