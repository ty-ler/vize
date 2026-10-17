//! A single Node child pauses before each actual configuration load phase.
//!
//! Only phase path lists are bounded. The final native JSON payload retains
//! the ordinary loader's size semantics. This blocking transport runs solely
//! on the caller's configuration worker, never on an async executor thread.

use std::{
    io::{self, BufReader, ErrorKind, Read, Write},
    path::PathBuf,
    process::{Child, Command, Output, Stdio},
    thread::{self, JoinHandle},
};

const MAX_PHASE_BYTES: usize = 64 * 1024;

struct ObservedChild {
    child: Child,
    stderr: Option<JoinHandle<io::Result<Vec<u8>>>>,
}

impl Drop for ObservedChild {
    fn drop(&mut self) {
        // Also covers malformed framing, EOF, callback unwinding, and IO errors.
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(stderr) = self.stderr.take() {
            let _ = stderr.join();
        }
    }
}

pub(super) fn evaluate_observed(
    command: &mut Command,
    before_read: &mut dyn FnMut(&[PathBuf]),
) -> io::Result<Output> {
    let child = command
        .arg("--observe-config-inputs")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut process = ObservedChild {
        child,
        stderr: None,
    };
    let mut stderr = process.child.stderr.take().expect("piped config stderr");
    process.stderr = Some(thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes)?;
        Ok(bytes)
    }));
    let mut stdout = BufReader::new(process.child.stdout.take().expect("piped config stdout"));
    let mut stdin = process.child.stdin.take().expect("piped config stdin");
    loop {
        let mut header = Vec::with_capacity(16);
        loop {
            let mut byte = [0];
            stdout.read_exact(&mut byte)?;
            if byte[0] == b'\n' {
                break;
            }
            if header.len() == 16 {
                return Err(io::Error::new(
                    ErrorKind::InvalidData,
                    "Invalid config phase header",
                ));
            }
            header.push(byte[0]);
        }
        if header == b"R" {
            break;
        }
        let length = header
            .strip_prefix(b"B")
            .and_then(|value| std::str::from_utf8(value).ok())
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|length| *length <= MAX_PHASE_BYTES)
            .ok_or_else(|| io::Error::new(ErrorKind::InvalidData, "Invalid config phase length"))?;
        let mut bytes = vec![0; length];
        stdout.read_exact(&mut bytes)?;
        let paths: Vec<PathBuf> = serde_json::from_slice(&bytes)
            .map_err(|error| io::Error::new(ErrorKind::InvalidData, error))?;
        if paths.iter().any(|path| !path.is_absolute()) {
            return Err(io::Error::new(
                ErrorKind::InvalidData,
                "Config phase path must be absolute",
            ));
        }
        before_read(&paths);
        stdin.write_all(&[6])?;
        stdin.flush()?;
    }
    drop(stdin);
    let mut payload = Vec::new();
    stdout.read_to_end(&mut payload)?;
    let status = process.child.wait()?;
    let stderr = process
        .stderr
        .take()
        .expect("config stderr drain")
        .join()
        .map_err(|_| io::Error::other("Config stderr drain panicked"))??;
    Ok(Output {
        status,
        stdout: payload,
        stderr,
    })
}

#[cfg(test)]
mod tests {
    use super::evaluate_observed;
    use std::{path::PathBuf, process::Command};

    #[test]
    fn drains_stderr_while_waiting_for_the_phase_ack_and_preserves_large_final_payload() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("policy.mjs");
        let encoded = serde_json::to_string(&[&path]).unwrap();
        let script = format!(
            r#"
const frame = Buffer.from({encoded:?});
process.stderr.write('e'.repeat(100000));
process.stdout.write(`B${{frame.length}}\n`);
process.stdout.write(frame);
process.stdin.once('data', ack => {{
  if (ack.length !== 1 || ack[0] !== 6) process.exit(2);
  process.stdout.end('R\n' + 'x'.repeat(100000));
  process.stdin.destroy();
}});
"#
        );
        let mut command = Command::new("node");
        command
            .arg("-e")
            .arg(script)
            .arg("--")
            .arg("config-fixture");
        let mut observed = Vec::new();
        let output = evaluate_observed(&mut command, &mut |paths| {
            observed.extend_from_slice(paths);
        })
        .unwrap();
        assert!(output.status.success());
        assert_eq!(observed, vec![path]);
        assert_eq!(output.stdout, vec![b'x'; 100000]);
        assert_eq!(output.stderr, vec![b'e'; 100000]);
    }

    #[test]
    fn rejects_truncated_or_oversized_phases_and_reaps_the_child() {
        for frame in [
            "B65537\n",
            "B-1\n",
            "Bwat\n",
            "B10\n[]",
            "B1",
            "",
            "B5\n[\".\"]",
        ] {
            let mut command = Command::new("node");
            command
                .arg("-e")
                .arg(format!("process.stdout.write({frame:?});"))
                .arg("--")
                .arg("config-fixture");
            let mut observed: Vec<PathBuf> = Vec::new();
            assert!(
                evaluate_observed(&mut command, &mut |paths| {
                    observed.extend_from_slice(paths);
                })
                .is_err(),
                "accepted invalid frame {frame:?}"
            );
            assert!(observed.is_empty());
        }
    }
}
