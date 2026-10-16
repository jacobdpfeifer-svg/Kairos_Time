//! Mission Control: read-only surface over the local brief projection
//! (`inbox/briefs/v1/`, written by browser/scripts/lib/briefs/), plus the
//! operations islands (calendar proposals, email context and drafts) and the
//! student's brief preferences / one-tap feedback.
//!
//! Nothing here writes to Canvas, a calendar, or a mailbox. Every id that
//! reaches a path is validated; every string handed to the webview is bounded.
//! See docs/handoff/mission-control-assignment-briefs-architecture-2026-10-15.md.

use crate::calendar;
use crate::canvas::valid_course_id;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_ISLANDS: usize = 6;
const MAX_EMAIL_CONTEXT: usize = 3;
const MAX_DRAFTS: usize = 5;

pub fn briefs_dir(user_root: &Path) -> PathBuf {
    user_root.join("inbox").join("briefs").join("v1")
}

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok())
}

/// Missing file and unreadable file are `not_found`. Bytes that are not JSON are `malformed`.
fn read_brief_file(path: &Path) -> Result<Value, &'static str> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).map_err(|_| "malformed"),
        Err(_) => Err("not_found"),
    }
}

/// Ids that point at evidence. Count and length are capped; non-strings are dropped.
fn evidence_ids(v: &Value) -> Value {
    let ids: Vec<String> = v
        .get("evidence_ids")
        .and_then(|x| x.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|x| x.as_str())
                .take(12)
                .map(|s| bound(s, 128))
                .collect()
        })
        .unwrap_or_default();
    json!(ids)
}

/// Truncate on a char boundary.
fn bound(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

fn str_of(v: &Value, key: &str, max: usize) -> String {
    bound(v.get(key).and_then(|x| x.as_str()).unwrap_or(""), max)
}

fn opt_str(v: &Value, key: &str, max: usize) -> Value {
    match v.get(key).and_then(|x| x.as_str()) {
        Some(s) => json!(bound(s, max)),
        None => Value::Null,
    }
}

fn hex_color(v: &Value, key: &str) -> String {
    let raw = v.get(key).and_then(|x| x.as_str()).unwrap_or("");
    let body = raw.strip_prefix('#').unwrap_or("");
    if body.len() == 6 && body.chars().all(|c| c.is_ascii_hexdigit()) {
        raw.to_string()
    } else {
        "#2E86AB".into()
    }
}

fn one_of(v: &Value, key: &str, allowed: &[&str], fallback: &str) -> String {
    let raw = v.get(key).and_then(|x| x.as_str()).unwrap_or("");
    if allowed.contains(&raw) { raw.to_string() } else { fallback.to_string() }
}

const BRIEF_STATES: &[&str] = &["ready", "partial", "needs_source", "stale"];
const BRIEF_KINDS: &[&str] = &["exam", "quiz", "math", "writing", "project", "lab", "reading", "discussion", "assignment", "unknown"];
const ISLAND_STATES: &[&str] = &["normal", "changed", "stale", "needs_attention"];
const ACTION_KINDS: &[&str] = &["study", "open_canvas", "open_source", "ask", "calendar_preview", "email_draft"];

/// One index row, re-validated: the webview never sees an unchecked id.
fn island_from(raw: &Value) -> Option<Value> {
    let course_id = raw.get("course_id")?.as_str()?;
    let assignment_id = raw.get("assignment_id")?.as_str()?;
    if !valid_course_id(course_id) || !valid_course_id(assignment_id) {
        return None;
    }
    Some(json!({
        "kind": "assignment",
        "island_id": format!("island-{course_id}--{assignment_id}"),
        "assignment_id": assignment_id,
        "course_id": course_id,
        "title": str_of(raw, "title", 300),
        "course_label": str_of(raw, "course_label", 200),
        "course_color": hex_color(raw, "course_color"),
        "due_at": opt_str(raw, "due_at", 64),
        "assignment_kind": one_of(raw, "assignment_kind", BRIEF_KINDS, "unknown"),
        "brief_state": one_of(raw, "brief_state", BRIEF_STATES, "partial"),
        "state": one_of(raw, "state", ISLAND_STATES, "normal"),
        "priority_reason": str_of(raw, "priority_reason", 160),
        "rank": raw.get("rank").and_then(|r| r.as_u64()).unwrap_or(0),
        "source_fingerprint": str_of(raw, "source_fingerprint", 128),
        "focus": raw.get("focus").and_then(|f| f.as_bool()).unwrap_or(false),
    }))
}

/// Connector state from the registry Python owns (`auth/connectors.json`); state only, never tokens.
fn connector_state(user_root: &Path, name: &str) -> String {
    read_json(&user_root.join("auth").join("connectors.json"))
        .and_then(|r| r.get(name).and_then(|c| c.get("state")).and_then(|s| s.as_str()).map(str::to_string))
        .unwrap_or_else(|| "disconnected".into())
}

fn dismissed_ids(user_root: &Path) -> Vec<String> {
    read_json(&calendar::dismissed_path(user_root))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Calendar proposals: email-derived suggestions plus the freshness
/// dashboard's "agent can do" study blocks, minus anything dismissed.
pub fn calendar_proposals(user_root: &Path, course_colors: &Map<String, Value>) -> Vec<Value> {
    let dismissed = dismissed_ids(user_root);
    let mut out = Vec::new();
    let dash = read_json(&user_root.join("inbox").join("freshness").join("dashboard.json")).unwrap_or(Value::Null);
    if let Some(rows) = dash.get("agent_can_do").and_then(|v| v.as_array()) {
        for row in rows {
            if row.get("kind").and_then(|k| k.as_str()) != Some("calendar_block") {
                continue;
            }
            let id = str_of(row, "id", 300);
            let Some(s) = row.get("suggestion") else { continue };
            if id.is_empty() || dismissed.contains(&id) {
                continue;
            }
            // `block:<course>:<assignment>` → that course's pip.
            let course = id.split(':').nth(1).unwrap_or("");
            out.push(json!({
                "suggestion_id": id,
                "summary": str_of(s, "title", 200),
                "start": str_of(s, "start", 64),
                "end": str_of(s, "end", 64),
                "why": str_of(row, "why", 300),
                "course_color": course_colors.get(course).cloned().unwrap_or(Value::Null),
            }));
        }
    }
    for s in calendar::read_suggestions(user_root) {
        if s.dismissed {
            continue;
        }
        out.push(json!({
            "suggestion_id": bound(&s.source_message_id, 300),
            "summary": bound(&s.title, 200),
            "start": bound(&s.start, 64),
            "end": bound(&s.end, 64),
            "why": bound(&s.why, 300),
            "course_color": Value::Null,
        }));
    }
    out
}

pub fn drafts_dir(user_root: &Path) -> PathBuf {
    user_root.join("inbox").join("email").join("drafts")
}

fn draft_summaries(user_root: &Path) -> Vec<Value> {
    let Ok(entries) = fs::read_dir(drafts_dir(user_root)) else { return Vec::new() };
    let mut rows: Vec<Value> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".json"))
        .filter_map(|e| read_json(&e.path()))
        .filter(|d| d.get("status").and_then(|s| s.as_str()) != Some("discarded"))
        .filter_map(|d| {
            let id = d.get("draft_id")?.as_str()?;
            if !valid_course_id(id) {
                return None;
            }
            // email_drafts.py stores recipients as a list.
            let to = match d.get("to") {
                Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "),
                Some(Value::String(s)) => s.clone(),
                _ => String::new(),
            };
            Some(json!({
                "draft_id": id,
                "to": bound(&to, 200),
                "subject": str_of(&d, "subject", 200),
                "updated_at": str_of(&d, "updated_at", 64),
                "status": one_of(&d, "status", &["draft", "reviewed"], "draft"),
            }))
        })
        .collect();
    rows.sort_by(|a, b| b["updated_at"].as_str().cmp(&a["updated_at"].as_str()));
    rows.truncate(MAX_DRAFTS);
    rows
}

/// Unread Outlook messages whose subject names one of today's courses. Subject
/// and sender only — bodies are never read here, and never rank anything.
fn email_context(user_root: &Path, course_terms: &[String]) -> Vec<Value> {
    if connector_state(user_root, "outlook") != "connected" || course_terms.is_empty() {
        return Vec::new();
    }
    let record = read_json(&user_root.join("inbox").join("connectors").join("outlook.json")).unwrap_or(Value::Null);
    let Some(items) = record.get("items").and_then(|v| v.as_array()) else { return Vec::new() };
    items
        .iter()
        .filter(|m| !m.get("is_read").and_then(|r| r.as_bool()).unwrap_or(true))
        .filter(|m| {
            let subject = m.get("subject").and_then(|s| s.as_str()).unwrap_or("").to_lowercase().replace(' ', "");
            course_terms.iter().any(|t| subject.contains(t))
        })
        .take(MAX_EMAIL_CONTEXT)
        .map(|m| {
            json!({
                "id": str_of(m, "id", 200),
                "subject": str_of(m, "subject", 200),
                "from": str_of(m, "from", 200),
                "received": opt_str(m, "received", 64),
            })
        })
        .collect()
}

/// The desktop app cannot send mail yet: Outlook is read-only (Mail.Read) and
/// guarded Gmail send lives outside this UI. Until a provider bridge exists
/// this stays false, and the UI renders no Send button at all.
pub fn email_send_capability() -> Value {
    json!({ "available": false, "reason": "Sending is not connected on this device" })
}

fn course_terms(islands: &[Value]) -> Vec<String> {
    let mut terms: Vec<String> = Vec::new();
    for i in islands {
        let label = i["course_label"].as_str().unwrap_or("");
        // "MATH 1300 — Calculus 1" → "math1300"
        let code = label.split('—').next().unwrap_or("").trim().to_lowercase().replace(' ', "");
        if code.len() >= 4 && !terms.contains(&code) {
            terms.push(code);
        }
    }
    terms
}

fn operations(user_root: &Path, islands: &[Value]) -> Vec<Value> {
    let mut ops = Vec::new();
    let mut colors = Map::new();
    for i in islands {
        if let (Some(c), Some(col)) = (i["course_id"].as_str(), i["course_color"].as_str()) {
            colors.insert(c.to_string(), json!(col));
        }
    }
    let proposals = calendar_proposals(user_root, &colors);
    if let Some(first) = proposals.first() {
        let gcal = connector_state(user_root, "gcal");
        let n = proposals.len();
        let (availability, reason) = if gcal == "connected" {
            ("available", "")
        } else {
            ("requires_connection", "Connect Google Calendar in Settings to add blocks")
        };
        ops.push(json!({
            "kind": "calendar",
            "island_id": "ops-calendar",
            "title": "Calendar",
            "summary": if n == 1 { "1 study block ready to review".to_string() } else { format!("{n} study blocks ready to review") },
            "state": if gcal == "connected" { "ready" } else { "attention" },
            "action": { "id": "review-block", "label": "Review block", "kind": "calendar_preview", "availability": availability, "reason": reason },
            "calendar": first,
        }));
    }
    let context = email_context(user_root, &course_terms(islands));
    let drafts = draft_summaries(user_root);
    if !context.is_empty() || !drafts.is_empty() {
        let summary = if !drafts.is_empty() { "Draft ready to review" } else { "Message may need you" };
        ops.push(json!({
            "kind": "email",
            "island_id": "ops-email",
            "title": "Email",
            "summary": summary,
            "state": "attention",
            "action": {
                "id": "review-draft",
                "label": if drafts.is_empty() { "Start a draft" } else { "Review draft" },
                "kind": "email_draft",
                "availability": "available",
            },
            "email": { "context": context, "drafts": drafts, "send": email_send_capability() },
        }));
    }
    ops
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct DaySelection {
    #[serde(default)]
    day: String,
    #[serde(default)]
    assignment_id: Option<String>,
}

fn selection_path(user_root: &Path) -> PathBuf {
    user_root.join("calibration").join("mission-control-day.json")
}

fn valid_day(day: &str) -> bool {
    day.len() == 10 && day.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() })
}

/// The student's open island, remembered only for the current local day.
fn selection_for(user_root: &Path, today: &str) -> Value {
    let sel: DaySelection = read_json(&selection_path(user_root))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    match sel.assignment_id {
        Some(id) if sel.day == today && valid_course_id(&id) => json!(id),
        _ => Value::Null,
    }
}

fn write_atomic(target: &Path, body: &str) -> Result<(), String> {
    if let Some(dir) = target.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, target).map_err(|e| e.to_string())
}

/// `selected` is an island's `assignment_id`; None clears it (all collapsed).
pub fn set_selection(user_root: &Path, today: &str, selected: Option<&str>) -> Result<(), String> {
    if !valid_day(today) {
        return Err("invalid day".into());
    }
    if let Some(id) = selected {
        if !valid_course_id(id) {
            return Err("invalid assignment id".into());
        }
    }
    let sel = DaySelection { day: today.to_string(), assignment_id: selected.map(str::to_string) };
    write_atomic(&selection_path(user_root), &serde_json::to_string(&sel).map_err(|e| e.to_string())?)
}

pub fn read_surface(user_root: &Path, today: &str) -> Value {
    let today = if valid_day(today) { today } else { "" };
    let index = read_json(&briefs_dir(user_root).join("index.json"));
    let prepared = index.is_some();
    let index = index.unwrap_or(Value::Null);
    let islands: Vec<Value> = index
        .get("assignments")
        .and_then(|v| v.as_array())
        .map(|rows| rows.iter().filter_map(island_from).take(MAX_ISLANDS).collect())
        .unwrap_or_default();
    let ops = operations(user_root, &islands);
    json!({
        "schema_version": 1,
        "generated_at": opt_str(&index, "generated_at", 64),
        "today": today,
        "assignments": islands,
        "operations": ops,
        "rest_count": index.get("rest_count").and_then(|v| v.as_u64()).unwrap_or(0),
        "selected_assignment_id": selection_for(user_root, today),
        "prepared": prepared,
        "briefs_error": briefs_error(user_root),
    })
}

fn briefs_error(user_root: &Path) -> Value {
    match read_json(&briefs_dir(user_root).join("error.json")) {
        Some(v) => {
            let msg = v.get("message").and_then(|m| m.as_str()).unwrap_or("");
            if msg.is_empty() { Value::Null } else { json!(bound(msg, 200)) }
        }
        None => Value::Null,
    }
}

fn bound_section(s: &Value) -> Value {
    json!({
        "id": str_of(s, "id", 64),
        "title": str_of(s, "title", 120),
        "body": str_of(s, "body", 4000),
        "evidence_ids": evidence_ids(s),
        "proposal": s.get("proposal").and_then(|p| p.as_bool()).unwrap_or(false),
    })
}

fn https_or_null(v: &Value, key: &str) -> Value {
    match v.get(key).and_then(|x| x.as_str()) {
        Some(u) if u.starts_with("https://") && u.len() <= 2048 => json!(u),
        _ => Value::Null,
    }
}

/// Re-bound a stored brief before it reaches the webview. Unknown action
/// kinds are dropped: a brief can never surface a Canvas submit/comment/post.
fn bound_brief(b: &Value) -> Value {
    let arr = |key: &str| b.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let actions: Vec<Value> = arr("actions")
        .iter()
        .filter(|a| ACTION_KINDS.contains(&a.get("kind").and_then(|k| k.as_str()).unwrap_or("")))
        .map(|a| {
            let kind = a["kind"].as_str().unwrap_or("");
            let target = if kind == "study" { opt_str(a, "target", 200) } else { https_or_null(a, "target") };
            json!({
                "id": str_of(a, "id", 128),
                "label": str_of(a, "label", 120),
                "kind": kind,
                "primary": a.get("primary").and_then(|p| p.as_bool()).unwrap_or(false),
                "availability": one_of(a, "availability", &["available", "unavailable", "requires_connection"], "unavailable"),
                "reason": opt_str(a, "reason", 400),
                "target": target,
            })
        })
        .collect();
    let evidence: Vec<Value> = arr("evidence")
        .iter()
        .take(12)
        .map(|e| {
            json!({
                "id": str_of(e, "id", 128),
                "label": str_of(e, "label", 300),
                "kind": one_of(e, "kind", &["canvas", "course_source", "library", "student", "connector", "general_recommendation"], "general_recommendation"),
                "locator": https_or_null(e, "locator"),
                "retrieved_at": opt_str(e, "retrieved_at", 64),
                "excerpt": opt_str(e, "excerpt", 600),
                "fingerprint": opt_str(e, "fingerprint", 64),
            })
        })
        .collect();
    let checklist: Vec<Value> = arr("checklist")
        .iter()
        .take(7)
        .map(|c| {
            json!({
                "id": str_of(c, "id", 64),
                "text": str_of(c, "text", 400),
                "kind": one_of(c, "kind", &["source_backed", "student_setting", "agent_proposal"], "agent_proposal"),
                "evidence_ids": evidence_ids(c),
            })
        })
        .collect();
    let module = b.get("module").cloned().unwrap_or(Value::Null);
    let sections: Vec<Value> = module.get("sections").and_then(|v| v.as_array()).map(|s| s.iter().take(12).map(bound_section).collect()).unwrap_or_default();
    let strings = |key: &str, n: usize, max: usize| -> Vec<String> {
        arr(key).iter().filter_map(|v| v.as_str()).take(n).map(|s| bound(s, max)).collect()
    };
    json!({
        "schema_version": 1,
        "id": str_of(b, "id", 140),
        "assignment_id": str_of(b, "assignment_id", 64),
        "course_id": str_of(b, "course_id", 64),
        "course_label": str_of(b, "course_label", 200),
        "course_color": hex_color(b, "course_color"),
        "title": str_of(b, "title", 300),
        "kind": one_of(b, "kind", BRIEF_KINDS, "unknown"),
        "due_at": opt_str(b, "due_at", 64),
        "points_possible": b.get("points_possible").filter(|p| p.is_number()).cloned().unwrap_or(Value::Null),
        "state": one_of(b, "state", BRIEF_STATES, "partial"),
        "gaps": strings("gaps", 6, 160),
        "prepared_at": str_of(b, "prepared_at", 64),
        "expires_at": opt_str(b, "expires_at", 64),
        "source_fingerprint": str_of(b, "source_fingerprint", 128),
        "next_step": str_of(b, "next_step", 400),
        "priority_reason": str_of(b, "priority_reason", 160),
        "requirements": strings("requirements", 12, 400),
        "checklist": checklist,
        "why_it_matters": opt_str(b, "why_it_matters", 4000),
        "why_is_general": b.get("why_is_general").and_then(|v| v.as_bool()).unwrap_or(false),
        "evidence": evidence,
        "module": {
            "kind": one_of(&module, "kind", BRIEF_KINDS, "unknown"),
            "title": str_of(&module, "title", 120),
            "sections": sections,
        },
        "actions": actions,
        "section_order": strings("section_order", 6, 16),
        "enrichment": Value::Null,
    })
}

fn bound_enrichment(e: &Value) -> Value {
    // Writer cap: validate_overlay keeps 5 sections and 1500-character bodies.
    let sections: Vec<Value> = e
        .get("sections")
        .and_then(|v| v.as_array())
        .map(|s| s.iter().take(5).map(|x| {
            let mut sec = bound_section(x);
            sec["body"] = json!(bound(x.get("body").and_then(|b| b.as_str()).unwrap_or(""), 1500));
            // AI text is always a proposal, whatever the file says.
            sec["proposal"] = json!(true);
            sec
        }).collect())
        .unwrap_or_default();
    json!({
        "prepared_at": str_of(e, "prepared_at", 64),
        "source_fingerprint": str_of(e, "source_fingerprint", 128),
        "state": one_of(e, "state", &["partial", "ready"], "partial"),
        "sections": sections,
        "gaps": e.get("gaps").and_then(|v| v.as_array()).map(|g| g.iter().filter_map(|x| x.as_str()).take(6).map(|s| bound(s, 160)).collect::<Vec<_>>()).unwrap_or_default(),
    })
}

pub fn read_brief(user_root: &Path, course_id: &str, assignment_id: &str) -> Value {
    if !valid_course_id(course_id) || !valid_course_id(assignment_id) {
        return json!({ "error": "invalid id" });
    }
    let dir = briefs_dir(user_root);
    let raw = match read_brief_file(&dir.join(format!("{course_id}--{assignment_id}.json"))) {
        Ok(v) => v,
        Err(code) => return json!({ "error": code }),
    };
    let mut brief = bound_brief(&raw);
    if let Some(enr) = read_json(&dir.join(format!("{course_id}--{assignment_id}--enriched.json"))) {
        // An overlay prepared from older sources is not shown as current.
        if enr.get("source_fingerprint") == raw.get("source_fingerprint") {
            brief["enrichment"] = bound_enrichment(&enr);
        }
    }
    brief
}

// --- Brief preferences (calibration/brief-preferences.json) --------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BriefPrefs {
    #[serde(default = "one")]
    pub schema_version: u8,
    #[serde(default = "d_paper")]
    pub paper_first: String,
    #[serde(default = "d_pset")]
    pub problem_set_first: String,
    #[serde(default = "d_order")]
    pub default_order: String,
    #[serde(default)]
    pub beta_opt_in: bool,
    #[serde(default)]
    pub beta_arm: Option<String>,
    #[serde(default)]
    pub calibrated: bool,
    #[serde(default)]
    pub updated_at: String,
}

fn one() -> u8 { 1 }
fn d_paper() -> String { "requirements".into() }
fn d_pset() -> String { "next_step".into() }
fn d_order() -> String { "next_step_first".into() }

impl Default for BriefPrefs {
    fn default() -> Self {
        BriefPrefs {
            schema_version: 1,
            paper_first: d_paper(),
            problem_set_first: d_pset(),
            default_order: d_order(),
            beta_opt_in: false,
            beta_arm: None,
            calibrated: false,
            updated_at: String::new(),
        }
    }
}

pub fn prefs_path(user_root: &Path) -> PathBuf {
    user_root.join("calibration").join("brief-preferences.json")
}

pub fn read_prefs(user_root: &Path) -> BriefPrefs {
    read_json(&prefs_path(user_root))
        .and_then(|v| serde_json::from_value(v).ok())
        .filter(|p| validate_prefs(p).is_ok())
        .unwrap_or_default()
}

const ORDERS: &[&str] = &["next_step_first", "requirements_first"];

fn validate_prefs(p: &BriefPrefs) -> Result<(), String> {
    if p.schema_version != 1 {
        return Err("unsupported schema".into());
    }
    if !["outline", "requirements", "next_step"].contains(&p.paper_first.as_str()) {
        return Err("invalid paper_first".into());
    }
    if !["concept_map", "worked_example_link", "next_step"].contains(&p.problem_set_first.as_str()) {
        return Err("invalid problem_set_first".into());
    }
    if !ORDERS.contains(&p.default_order.as_str()) {
        return Err("invalid default_order".into());
    }
    if p.beta_arm.as_deref().is_some_and(|a| !ORDERS.contains(&a)) {
        return Err("invalid beta_arm".into());
    }
    if p.updated_at.len() > 64 {
        return Err("invalid updated_at".into());
    }
    Ok(())
}

/// The beta arm is chosen here, locally and at random, only on opt-in; it is
/// dropped on opt-out. The webview cannot pick its own arm.
pub fn write_prefs(user_root: &Path, mut next: BriefPrefs, now_iso: &str) -> Result<BriefPrefs, String> {
    validate_prefs(&next)?;
    let prior = read_prefs(user_root);
    next.beta_arm = if next.beta_opt_in {
        prior.beta_arm.clone().or_else(|| Some(random_arm()))
    } else {
        None
    };
    next.updated_at = bound(now_iso, 64);
    write_atomic(&prefs_path(user_root), &serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?)?;
    Ok(next)
}

fn random_arm() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() ^ (std::process::id().rotate_left(7)))
        .unwrap_or(0);
    ORDERS[(nanos as usize) % 2].to_string()
}

// --- One-tap feedback (calibration/brief-feedback.jsonl) ------------------------

pub fn feedback_path(user_root: &Path) -> PathBuf {
    user_root.join("calibration").join("brief-feedback.jsonl")
}

/// Stores only the outcome, the brief kind, the arm, and a day: no title, no
/// course, no assignment text. Local; leaves only when the student exports it.
pub fn record_feedback(user_root: &Path, kind: &str, outcome: &str, day: &str) -> Result<(), String> {
    if !["helpful", "not_specific_enough", "wrong_context"].contains(&outcome) {
        return Err("invalid outcome".into());
    }
    if !BRIEF_KINDS.contains(&kind) || !valid_day(day) {
        return Err("invalid feedback".into());
    }
    let prefs = read_prefs(user_root);
    let row = json!({
        "day": day,
        "kind": kind,
        "outcome": outcome,
        "arm": if prefs.beta_opt_in { prefs.beta_arm.clone() } else { None },
    });
    let path = feedback_path(user_root);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        }
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    writeln!(file, "{row}").map_err(|e| e.to_string())
}

/// Anonymized export: counts per arm × kind × outcome. Nothing per-assignment.
pub fn export_feedback(user_root: &Path) -> Value {
    let text = fs::read_to_string(feedback_path(user_root)).unwrap_or_default();
    let mut counts: std::collections::BTreeMap<String, u64> = std::collections::BTreeMap::new();
    for line in text.lines() {
        let Ok(row) = serde_json::from_str::<Value>(line) else { continue };
        let key = format!(
            "{}|{}|{}",
            row["arm"].as_str().unwrap_or("none"),
            row["kind"].as_str().unwrap_or("unknown"),
            row["outcome"].as_str().unwrap_or("unknown"),
        );
        *counts.entry(key).or_insert(0) += 1;
    }
    let rows: Vec<Value> = counts
        .into_iter()
        .map(|(k, n)| {
            let mut parts = k.split('|');
            json!({ "arm": parts.next(), "kind": parts.next(), "outcome": parts.next(), "count": n })
        })
        .collect();
    json!({ "schema_version": 1, "kind": "kairos-brief-feedback", "rows": rows })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kairos-briefs-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, v: Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_string(&v).unwrap()).unwrap();
    }

    fn island(cid: &str, aid: &str) -> Value {
        json!({ "kind": "assignment", "course_id": cid, "assignment_id": aid, "title": "PS4", "course_label": "MATH 1300 — Calculus", "course_color": "#2E86AB", "assignment_kind": "math", "brief_state": "ready", "state": "normal", "priority_reason": "Due tomorrow", "rank": 1, "source_fingerprint": "abc" })
    }

    #[test]
    fn surface_before_first_sync_is_empty_and_unprepared() {
        let r = root("empty");
        let s = read_surface(&r, "2026-10-15");
        assert_eq!(s["prepared"], json!(false));
        assert_eq!(s["assignments"], json!([]));
        assert_eq!(s["operations"], json!([]));
    }

    #[test]
    fn surface_drops_unsafe_ids_and_caps_at_six() {
        let r = root("cap");
        let mut rows: Vec<Value> = (0..8).map(|i| island("101", &format!("a{i}"))).collect();
        rows.push(island("../etc", "a1"));
        write(&briefs_dir(&r).join("index.json"), json!({ "schema_version": 1, "assignments": rows, "rest_count": 2 }));
        let s = read_surface(&r, "2026-10-15");
        let a = s["assignments"].as_array().unwrap();
        assert_eq!(a.len(), MAX_ISLANDS);
        assert!(a.iter().all(|i| i["course_id"] == "101"));
        assert_eq!(s["prepared"], json!(true));
    }

    #[test]
    fn selection_is_remembered_for_today_only() {
        let r = root("sel");
        set_selection(&r, "2026-10-15", Some("a11")).unwrap();
        assert_eq!(selection_for(&r, "2026-10-15"), json!("a11"));
        assert_eq!(selection_for(&r, "2026-10-16"), Value::Null);
        assert!(set_selection(&r, "2026-10-15", Some("../x")).is_err());
        assert!(set_selection(&r, "tomorrow", None).is_err());
    }

    #[test]
    fn brief_read_rejects_traversal_and_drops_unknown_actions() {
        let r = root("brief");
        assert_eq!(read_brief(&r, "../a", "b")["error"], "invalid id");
        write(
            &briefs_dir(&r).join("101--a11.json"),
            json!({
                "id": "101--a11", "course_id": "101", "assignment_id": "a11", "title": "PS4", "kind": "math", "state": "ready",
                "source_fingerprint": "f1", "course_color": "javascript:alert(1)",
                "actions": [
                    { "id": "c", "label": "Open", "kind": "open_canvas", "availability": "available", "primary": true, "target": "https://canvas.example.edu/x" },
                    { "id": "s", "label": "Submit", "kind": "submit_assignment", "availability": "available" },
                    { "id": "j", "label": "Bad", "kind": "open_source", "availability": "available", "target": "javascript:alert(1)" }
                ],
                "module": { "kind": "math", "title": "Problem set", "sections": [] }
            }),
        );
        write(&briefs_dir(&r).join("101--a11--enriched.json"), json!({ "source_fingerprint": "old", "sections": [] }));
        let b = read_brief(&r, "101", "a11");
        let kinds: Vec<&str> = b["actions"].as_array().unwrap().iter().map(|a| a["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, vec!["open_canvas", "open_source"]);
        assert_eq!(b["actions"][1]["target"], Value::Null);
        assert_eq!(b["course_color"], "#2E86AB");
        assert_eq!(b["enrichment"], Value::Null, "an overlay from older sources is not shown");
    }

    #[test]
    fn brief_read_caps_evidence_and_enrichment_and_separates_malformed() {
        let r = root("bounds");
        let long = "x".repeat(2000);
        let ids: Vec<String> = (0..20).map(|i| format!("{long}{i}")).collect();
        write(
            &briefs_dir(&r).join("101--a11.json"),
            json!({
                "id": "101--a11", "course_id": "101", "assignment_id": "a11", "title": "PS4", "kind": "math", "state": "ready",
                "source_fingerprint": "f1",
                "checklist": [{ "id": "c", "text": "Check", "kind": "source_backed", "evidence_ids": ids }],
                "module": { "kind": "math", "title": "Problem set", "sections": [{ "id": "s", "title": "Map", "body": "ok", "evidence_ids": ids }] }
            }),
        );
        let sections: Vec<Value> = (0..8).map(|i| json!({ "id": format!("ai-{i}"), "title": "More", "body": long, "proposal": false })).collect();
        write(
            &briefs_dir(&r).join("101--a11--enriched.json"),
            json!({ "source_fingerprint": "f1", "sections": sections, "state": "partial" }),
        );
        let b = read_brief(&r, "101", "a11");
        let check_ids = b["checklist"][0]["evidence_ids"].as_array().unwrap();
        assert_eq!(check_ids.len(), 12);
        assert!(check_ids.iter().all(|id| id.as_str().unwrap().chars().count() <= 128));
        let section_ids = b["module"]["sections"][0]["evidence_ids"].as_array().unwrap();
        assert_eq!(section_ids.len(), 12);
        let enriched = b["enrichment"]["sections"].as_array().unwrap();
        assert_eq!(enriched.len(), 5);
        assert!(enriched.iter().all(|s| s["proposal"] == json!(true) && s["body"].as_str().unwrap().chars().count() <= 1500));
        fs::write(briefs_dir(&r).join("101--a12.json"), b"{").unwrap();
        assert_eq!(read_brief(&r, "101", "a12")["error"], "malformed");
        assert_eq!(read_brief(&r, "101", "missing")["error"], "not_found");
        write(&briefs_dir(&r).join("error.json"), json!({ "message": "Briefs couldn't be rebuilt. They'll try again on the next sync." }));
        assert_eq!(
            read_surface(&r, "2026-10-15")["briefs_error"],
            json!("Briefs couldn't be rebuilt. They'll try again on the next sync.")
        );
    }

    #[test]
    fn calendar_island_needs_a_proposal_and_says_when_gcal_is_not_connected() {
        let r = root("cal");
        write(&briefs_dir(&r).join("index.json"), json!({ "schema_version": 1, "assignments": [island("101", "a11")], "rest_count": 0 }));
        assert_eq!(read_surface(&r, "2026-10-15")["operations"], json!([]));
        write(
            &r.join("inbox").join("freshness").join("dashboard.json"),
            json!({ "agent_can_do": [{ "id": "block:101:11", "kind": "calendar_block", "why": "Due in the next few days", "suggestion": { "title": "Work on PS4", "start": "2026-10-15T20:00:00Z", "end": "2026-10-15T21:30:00Z" } }] }),
        );
        let ops = read_surface(&r, "2026-10-15")["operations"].clone();
        assert_eq!(ops[0]["kind"], "calendar");
        assert_eq!(ops[0]["action"]["availability"], "requires_connection");
        assert_eq!(ops[0]["calendar"]["course_color"], "#2E86AB");
        calendar::dismiss_suggestion(&r, "block:101:11").unwrap();
        assert_eq!(read_surface(&r, "2026-10-15")["operations"], json!([]));
    }

    #[test]
    fn email_island_shows_relevant_unread_and_drafts_and_never_offers_send() {
        let r = root("mail");
        write(&briefs_dir(&r).join("index.json"), json!({ "schema_version": 1, "assignments": [island("101", "a11")], "rest_count": 0 }));
        write(&r.join("auth").join("connectors.json"), json!({ "outlook": { "state": "connected" } }));
        write(
            &r.join("inbox").join("connectors").join("outlook.json"),
            json!({ "items": [
                { "id": "m1", "subject": "MATH 1300 office hours moved", "from": "prof@example.edu", "is_read": false },
                { "id": "m2", "subject": "Pizza night", "from": "club@example.edu", "is_read": false },
                { "id": "m3", "subject": "MATH 1300 old", "from": "prof@example.edu", "is_read": true }
            ] }),
        );
        let ops = read_surface(&r, "2026-10-15")["operations"].clone();
        assert_eq!(ops[0]["kind"], "email");
        assert_eq!(ops[0]["summary"], "Message may need you");
        assert_eq!(ops[0]["email"]["context"].as_array().unwrap().len(), 1);
        assert_eq!(ops[0]["email"]["send"]["available"], json!(false));
        write(&drafts_dir(&r).join("d1.json"), json!({ "draft_id": "d1", "to": ["prof@example.edu"], "subject": "Question", "updated_at": "2026-10-15T10:00:00Z", "status": "draft" }));
        let ops = read_surface(&r, "2026-10-15")["operations"].clone();
        assert_eq!(ops[0]["summary"], "Draft ready to review");
        assert_eq!(ops[0]["email"]["drafts"][0]["draft_id"], "d1");
    }

    #[test]
    fn prefs_validate_and_beta_arm_is_assigned_only_on_opt_in() {
        let r = root("prefs");
        assert_eq!(read_prefs(&r), BriefPrefs::default());
        let mut p = BriefPrefs { paper_first: "outline".into(), ..Default::default() };
        let saved = write_prefs(&r, p.clone(), "2026-10-15T00:00:00Z").unwrap();
        assert_eq!(saved.beta_arm, None);
        p.beta_opt_in = true;
        p.beta_arm = Some("requirements_first".into());
        let arm = write_prefs(&r, p.clone(), "2026-10-15T00:00:00Z").unwrap().beta_arm.unwrap();
        assert!(ORDERS.contains(&arm.as_str()));
        assert_eq!(write_prefs(&r, p.clone(), "x").unwrap().beta_arm.unwrap(), arm, "arm is sticky");
        p.beta_opt_in = false;
        assert_eq!(write_prefs(&r, p, "x").unwrap().beta_arm, None);
        let bad = BriefPrefs { paper_first: "everything".into(), ..Default::default() };
        assert!(write_prefs(&r, bad, "x").is_err());
    }

    #[test]
    fn feedback_is_anonymous_and_exports_counts_only() {
        let r = root("fb");
        record_feedback(&r, "math", "helpful", "2026-10-15").unwrap();
        record_feedback(&r, "math", "helpful", "2026-10-15").unwrap();
        record_feedback(&r, "writing", "wrong_context", "2026-10-15").unwrap();
        assert!(record_feedback(&r, "math", "love it", "2026-10-15").is_err());
        let raw = fs::read_to_string(feedback_path(&r)).unwrap();
        assert!(!raw.contains("101") && !raw.contains("PS4"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(feedback_path(&r)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let out = export_feedback(&r);
        let rows = out["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|x| x["kind"] == "math" && x["count"] == 2));
    }

    #[test]
    fn two_profiles_never_see_each_other() {
        let a = root("iso-a");
        let b = root("iso-b");
        write(&briefs_dir(&a).join("index.json"), json!({ "schema_version": 1, "assignments": [island("101", "a11")], "rest_count": 0 }));
        write_prefs(&a, BriefPrefs { paper_first: "outline".into(), ..Default::default() }, "x").unwrap();
        set_selection(&a, "2026-10-15", Some("a11")).unwrap();
        let sb = read_surface(&b, "2026-10-15");
        assert_eq!(sb["assignments"], json!([]));
        assert_eq!(sb["selected_assignment_id"], Value::Null);
        assert_eq!(read_prefs(&b), BriefPrefs::default());
        assert_eq!(read_brief(&b, "101", "a11")["error"], "not_found");
    }
}
