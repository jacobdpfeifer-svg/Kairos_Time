//! Starts the local voice interviewer and leaves it bound to loopback.
//! The Gemini key stays in the voice server. This process never sees a transcript.

use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use crate::runtime::Runtime;

const APP_VOICE_PORT: &str = "8791";

struct VoiceProc {
    child: Child,
    port: u16,
}

static VOICE: Mutex<Option<VoiceProc>> = Mutex::new(None);

pub fn ready_port(line: &str) -> Option<u16> {
    let rest = line.split("http://").nth(1)?;
    let host = rest.split(['/', ' ', '\r']).next()?;
    let port = host.rsplit(':').next()?.trim();
    let port: u16 = port.parse().ok()?;
    if port == 0 { None } else { Some(port) }
}

pub fn voice_failure_reason(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("gemini_api_key") || lower.contains("missing gemini") {
        "Voice needs a Gemini key on this Mac. You can type the same answers.".into()
    } else {
        "Voice didn't start. You can type the same answers.".into()
    }
}

fn wait_ready(stdout: ChildStdout, stderr: ChildStderr) -> Result<u16, String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let n = reader.read_line(&mut line).unwrap_or(0);
            if n == 0 {
                break;
            }
            if let Some(port) = ready_port(&line) {
                let _ = tx.send(Ok(port));
                let mut sink = String::new();
                while reader.read_line(&mut sink).unwrap_or(0) > 0 {
                    sink.clear();
                }
                return;
            }
        }
        let err = BufReader::new(stderr).lines().map_while(Result::ok).collect::<Vec<_>>().join(" ");
        let _ = tx.send(Err(voice_failure_reason(&err)));
    });
    match rx.recv_timeout(Duration::from_secs(8)) {
        Ok(result) => result,
        Err(_) => Err("Voice didn't start. You can type the same answers.".into()),
    }
}

pub fn start(rt: &Runtime) -> Result<serde_json::Value, String> {
    let mut slot = VOICE.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(proc) = slot.as_mut() {
        if proc.child.try_wait().ok().flatten().is_none() {
            return Ok(serde_json::json!({ "ok": true, "port": proc.port }));
        }
    }
    if let Some(mut proc) = slot.take() {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }

    let mut cmd: Command = rt.browser_script("voice-server").map_err(|_| {
        "Voice isn't available in this copy of Kairos. You can type the same answers.".to_string()
    })?;
    cmd.env("VOICE_PORT", APP_VOICE_PORT);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|_| "Voice didn't start. You can type the same answers.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Voice didn't start. You can type the same answers.".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Voice didn't start. You can type the same answers.".to_string())?;
    match wait_ready(stdout, stderr) {
        Ok(port) => {
            *slot = Some(VoiceProc { child, port });
            Ok(serde_json::json!({ "ok": true, "port": port }))
        }
        Err(reason) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(reason)
        }
    }
}

pub fn stop() {
    let mut slot = VOICE.lock().unwrap_or_else(|err| err.into_inner());
    if let Some(mut proc) = slot.take() {
        let _ = proc.child.kill();
        let _ = proc.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_ready_line_port() {
        assert_eq!(ready_port("Voice intake ready → http://localhost:8791"), Some(8791));
        assert_eq!(ready_port("nothing to see"), None);
    }

    #[test]
    fn a_missing_key_is_a_typed_fallback() {
        let reason = voice_failure_reason("Missing GEMINI_API_KEY. Create a key");
        assert!(reason.contains("Gemini key"));
        assert!(reason.contains("type the same answers"));
        assert!(!reason.contains("http"));
    }
}
