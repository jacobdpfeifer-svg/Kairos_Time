//! Accepted workspace spec: bounds, atomic write, and revert history.
//!
//! The webview is not trusted. The accepted spec is stored only when `status`
//! is `accepted` and `accepted_by` is `student`, and only after the same bounds
//! as browser/scripts/lib/workspace/spec.mjs. A proposal is a separate file and
//! can never be loaded as the workspace. Files are owner-readable and live
//! under `{user_root}/workspace/`, so they follow the profile rather than the
//! shared webview storage.

use serde::Deserialize;
use crate::userfile::{ensure_dir, write_atomic};
use serde_json::{Map, Value};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCHEMA_VERSION: u64 = 1;
const MAX_BLOCKS_PER_SURFACE: usize = 6;
const MAX_BLOCKS_TOTAL: usize = 24;
const MAX_HISTORY: usize = 10;
const MAX_NAME: usize = 80;
const SURFACES: [&str; 5] = ["today", "week", "courses", "study", "advisor"];
const STATUSES: [&str; 3] = ["draft", "proposed", "accepted"];
const ORIGINS: [&str; 4] = ["interview", "template", "edit", "amendment"];
const SIZES: [&str; 2] = ["full", "half"];
const DENSITIES: [&str; 2] = ["comfortable", "compact"];
const PREDICATES: [&str; 8] = [
    "always",
    "has_changes",
    "due_within_48h",
    "has_exam_within_7d",
    "has_unread_announcements",
    "missing_course_sources",
    "weekend",
    "weekday",
];
const INTERRUPTS: [&str; 3] = ["due_moved", "high_stakes_48h", "sync_broken"];
const REQUESTED: [&str; 2] = ["requested", "not_available"];

pub const FALLBACK_NOTICE: &str = "Kairos kept your previous workspace because the new one didn't check out.";

#[derive(Deserialize)]
struct CatalogFile {
    capabilities: Vec<Capability>,
}

#[derive(Deserialize)]
struct Capability {
    id: String,
    surfaces: Vec<String>,
    sizes: Vec<String>,
    #[serde(default)]
    max_instances: Option<usize>,
    #[serde(default)]
    requires: Vec<String>,
    #[serde(default)]
    props: BTreeMap<String, PropField>,
}

#[derive(Deserialize)]
struct PropField {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    default: Option<Value>,
}

fn catalog() -> &'static [Capability] {
    use std::sync::OnceLock;
    static CATALOG: OnceLock<Vec<Capability>> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let file: CatalogFile = serde_json::from_str(include_str!("../../src/workspace/catalog.json")).expect("workspace catalog json");
        file.capabilities
    })
}

fn workspace_dir(root: &Path) -> PathBuf {
    root.join("workspace")
}
fn accepted_path(root: &Path) -> PathBuf {
    workspace_dir(root).join("workspace.json")
}
fn proposed_path(root: &Path) -> PathBuf {
    workspace_dir(root).join("proposed.json")
}
fn history_dir(root: &Path) -> PathBuf {
    workspace_dir(root).join("history")
}
fn usage_path(root: &Path) -> PathBuf {
    workspace_dir(root).join("usage.json")
}
fn amendments_path(root: &Path) -> PathBuf {
    workspace_dir(root).join("amendments.json")
}
fn draft_path(root: &Path) -> PathBuf {
    workspace_dir(root).join("onboarding-draft.json")
}
fn tool_gaps_path(root: &Path) -> PathBuf {
    root.join("inbox").join("tool-gaps.md")
}

/// Row text shared with browser/scripts/lib/tool-request-state.mjs. Keep them identical.
const ASKED_HEADING: &str = "## Asked for on this Mac";
const ASKED_INTRO: &str = "Tools the student named on this Mac. Flag only; do not auto-build.";
const GAP_NOTE: &str = "No connector in registry — flag only; do not auto-build";
const GAP_COURSES: &str = "—";

fn esc_gap_cell(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        match ch {
            '|' => out.push('/'),
            '\n' | '\r' | '\u{000b}' | '\u{000c}' | '\u{001c}' | '\u{001d}' | '\u{001e}' | '\u{0085}' | '\u{2028}' | '\u{2029}' => out.push(' '),
            _ => out.push(ch),
        }
    }
    out.trim().to_string()
}

fn clip_request_name(raw: &str) -> String {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    text.chars().take(120).collect()
}

fn push_request_name(names: &mut Vec<String>, seen: &mut BTreeSet<String>, raw: &str) {
    let name = clip_request_name(raw);
    if name.is_empty() || names.len() >= 20 {
        return;
    }
    let key = name.to_lowercase();
    if seen.contains(&key) {
        return;
    }
    seen.insert(key);
    names.push(name);
}

fn collect_request_names(value: &Value, names: &mut Vec<String>, seen: &mut BTreeSet<String>) {
    let Some(list) = value.get("requested_integrations").and_then(|v| v.as_array()) else {
        return;
    };
    for item in list {
        if let Some(text) = item.as_str() {
            push_request_name(names, seen, text);
        } else if let Some(text) = item.get("name").and_then(|v| v.as_str()) {
            push_request_name(names, seen, text);
        }
    }
}

fn format_asked_section(names: &[String]) -> String {
    let mut out = format!("{ASKED_HEADING}\n\n{ASKED_INTRO}\n\n| Tool | Courses | Notes |\n|------|---------|-------|\n");
    for name in names {
        out.push_str(&format!("| {} | {GAP_COURSES} | {GAP_NOTE} |\n", esc_gap_cell(name)));
    }
    out
}

fn strip_asked_section(text: &str) -> String {
    let Some(start) = text.find(ASKED_HEADING) else {
        return text.trim_end().to_string();
    };
    let before = text[..start].trim_end();
    let after_marker = &text[start + ASKED_HEADING.len()..];
    let after = if let Some(idx) = after_marker.find("\n#") {
        after_marker[idx + 1..].trim_start_matches('\n').trim_end()
    } else {
        ""
    };
    match (before.is_empty(), after.is_empty()) {
        (true, true) => String::new(),
        (false, true) => before.to_string(),
        (true, false) => after.to_string(),
        (false, false) => format!("{before}\n\n{after}"),
    }
}

fn reconcile_markdown(existing: &str, names: &[String]) -> String {
    let had = existing.contains(ASKED_HEADING);
    let base = strip_asked_section(existing);
    if names.is_empty() {
        if !had {
            return existing.to_string();
        }
        if base.is_empty() {
            return String::new();
        }
        return format!("{base}\n");
    }
    let section = format_asked_section(names);
    if base.is_empty() {
        section
    } else {
        format!("{base}\n\n{section}")
    }
}

/// Rewrite the asked-for section from the draft and the accepted spec. Local file only.
fn reconcile_tool_gaps(root: &Path) -> Result<(), String> {
    let mut names = Vec::new();
    let mut seen = BTreeSet::new();
    if let Some(draft) = read_json(&draft_path(root)) {
        collect_request_names(&draft, &mut names, &mut seen);
    }
    if let Some(spec) = read_json(&accepted_path(root)) {
        collect_request_names(&spec, &mut names, &mut seen);
    }
    let path = tool_gaps_path(root);
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let next = reconcile_markdown(&existing, &names);
    if next == existing {
        return Ok(());
    }
    if next.is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    write_atomic(&path, next.as_bytes())
}

fn clip_str(value: &Value, max: usize) -> Option<String> {
    let text = value.as_str()?.trim();
    if text.is_empty() {
        return Some(String::new());
    }
    Some(text.chars().take(max).collect())
}

/// Keep a draft's intent fields. Anything that could be a spec is dropped.
pub fn sanitize_workflow_draft(value: &Value) -> Result<Value, String> {
    let Some(obj) = value.as_object() else {
        return Err("That draft is not a workspace interview.".into());
    };
    if obj.get("status").and_then(|v| v.as_str()) != Some("draft") {
        return Err("That draft is not ready to preview.".into());
    }
    let mut out = Map::new();
    out.insert("status".into(), Value::String("draft".into()));
    if let Some(version) = obj.get("version").and_then(|v| v.as_u64()) {
        if version == 1 {
            out.insert("version".into(), Value::from(1));
        }
    }
    for (key, max) in [("created_at", 40usize), ("session_id", 80), ("ideal_workflow", 600), ("constraints", 500), ("preference", 40), ("proposed_template", 40)] {
        if let Some(text) = obj.get(key).and_then(|v| clip_str(v, max)) {
            out.insert(key.into(), Value::String(text));
        }
    }
    for (key, max_items, max_len) in [("frictions", 8usize, 40usize), ("requested_integrations", 5, 120)] {
        let Some(items) = obj.get(key).and_then(|v| v.as_array()) else { continue };
        let names: Vec<Value> = items.iter().filter_map(|item| clip_str(item, max_len).filter(|s| !s.is_empty()).map(Value::String)).take(max_items).collect();
        out.insert(key.into(), Value::Array(names));
    }
    if let Some(items) = obj.get("interrupt_for").and_then(|v| v.as_array()) {
        let kinds = ["due_moved", "high_stakes_48h", "sync_broken"];
        let kept: Vec<Value> = kinds.iter().filter(|kind| items.iter().any(|item| item.as_str() == Some(kind))).map(|kind| Value::String((*kind).into())).collect();
        out.insert("interrupt_for".into(), Value::Array(kept));
    }
    if let Some(items) = obj.get("alternatives").and_then(|v| v.as_array()) {
        let alts: Vec<Value> = items.iter().filter_map(|item| {
            let map = item.as_object()?;
            let title = clip_str(map.get("title")?, 100).filter(|s| !s.is_empty())?;
            let reason = clip_str(map.get("reason")?, 240).filter(|s| !s.is_empty())?;
            let mut alt = Map::new();
            alt.insert("title".into(), Value::String(title));
            alt.insert("reason".into(), Value::String(reason));
            Some(Value::Object(alt))
        }).take(3).collect();
        out.insert("alternatives".into(), Value::Array(alts));
    }
    Ok(Value::Object(out))
}

pub fn read_workflow_draft(root: &Path) -> Result<Value, String> {
    match read_json(&draft_path(root)) {
        None => Ok(Value::Null),
        Some(value) => sanitize_workflow_draft(&value),
    }
}

pub fn write_workflow_draft(root: &Path, draft: &Value) -> Result<Value, String> {
    let clean = sanitize_workflow_draft(draft)?;
    let mut body = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
    body.push('\n');
    write_atomic(&draft_path(root), body.as_bytes())?;
    reconcile_tool_gaps(root)?;
    Ok(clean)
}

fn stamp_ok(ts: &str) -> bool {
    (10..=16).contains(&ts.len()) && ts.bytes().all(|b| b.is_ascii_digit())
}

fn safe_block_id(id: &str) -> bool {
    let mut chars = id.chars();
    if !matches!(chars.next(), Some(c) if c.is_ascii_lowercase()) {
        return false;
    }
    id.len() <= 32 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn clip(value: &str) -> String {
    value.chars().take(40).collect()
}

fn known(list: &[&str], value: &str) -> bool {
    list.contains(&value)
}

fn prop_type_ok(kind: &str, value: &Value) -> bool {
    match kind {
        "boolean" => value.is_boolean(),
        "string" => value.is_string(),
        "number" => value.is_number(),
        _ => false,
    }
}

fn clean_props(block_id: &str, props: Option<&Value>, schema: &BTreeMap<String, PropField>, errors: &mut Vec<String>) -> Value {
    let source = match props {
        None => Map::new(),
        Some(Value::Object(map)) => map.clone(),
        Some(_) => {
            errors.push(format!("block {block_id} props is not an object"));
            return Value::Object(Map::new());
        }
    };
    let mut next = Map::new();
    for (key, field) in schema {
        if let Some(default) = &field.default {
            next.insert(key.clone(), default.clone());
        }
    }
    for (key, value) in source {
        let Some(field) = schema.get(&key) else { continue };
        if !prop_type_ok(&field.kind, &value) {
            errors.push(format!("block {block_id} prop {key} is not a {}", field.kind));
            continue;
        }
        next.insert(key, value);
    }
    Value::Object(next)
}

fn validate(spec: &Value) -> Result<Value, Vec<String>> {
    let mut errors = Vec::new();
    if !spec.is_object() {
        return Err(vec!["spec is not an object".into()]);
    }
    let mut spec = spec.clone();
    check_header(&spec, &mut errors);
    let blocks_missing = !spec.get("blocks").is_some_and(|v| v.is_object());
    let surfaces_missing = !spec.get("surfaces").is_some_and(|v| v.is_object());
    if blocks_missing {
        errors.push("blocks is missing".into());
    }
    if surfaces_missing {
        errors.push("surfaces is missing".into());
    }
    if blocks_missing || surfaces_missing {
        return Err(errors);
    }
    check_blocks(&mut spec, &mut errors);
    check_surfaces(&spec, &mut errors);
    check_quiet(&spec, &mut errors);
    check_requested(&spec, &mut errors);
    if errors.is_empty() { Ok(spec) } else { Err(errors) }
}

fn check_header(spec: &Value, errors: &mut Vec<String>) {
    if spec.get("schema_version").and_then(|v| v.as_u64()) != Some(SCHEMA_VERSION) {
        errors.push(format!("schema_version must be {SCHEMA_VERSION}"));
    }
    match spec.get("status").and_then(|v| v.as_str()) {
        Some(status) if known(&STATUSES, status) => {
            if status == "accepted" && spec.get("accepted_by").and_then(|v| v.as_str()) != Some("student") {
                errors.push("an accepted spec must be accepted_by student".into());
            }
        }
        _ => errors.push("status must be draft, proposed, or accepted".into()),
    }
    if let Some(density) = spec.get("density").and_then(|v| v.as_str()) {
        if !known(&DENSITIES, density) {
            errors.push("density is not a known density".into());
        }
    } else if spec.get("density").is_some() && !spec.get("density").is_some_and(|v| v.is_null()) {
        errors.push("density is not a known density".into());
    }
    if let Some(origin) = spec.get("origin") {
        if !origin.get("kind").and_then(|v| v.as_str()).is_some_and(|kind| known(&ORIGINS, kind)) {
            errors.push("origin.kind is not a known origin".into());
        }
    }
    if let Some(home) = spec.get("home") {
        if !home.as_str().is_some_and(|value| known(&SURFACES, value)) {
            errors.push("home is not a surface".into());
        }
    }
    // The student types the name and Settings renders it back, so it is bounded
    // here too rather than trusted from the webview.
    if let Some(name) = spec.get("name") {
        if !name.is_null() && !name.as_str().is_some_and(|value| value.chars().count() <= MAX_NAME) {
            errors.push(format!("name must be text of at most {MAX_NAME} characters"));
        }
    }
}

fn check_blocks(spec: &mut Value, errors: &mut Vec<String>) {
    let caps = catalog();
    let ids: Vec<String> = spec.get("blocks").and_then(|v| v.as_object()).map(|m| m.keys().cloned().collect()).unwrap_or_default();
    if ids.len() > MAX_BLOCKS_TOTAL {
        errors.push(format!("more than {MAX_BLOCKS_TOTAL} blocks"));
    }
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut cleaned: BTreeMap<String, Value> = BTreeMap::new();
    for id in &ids {
        if !safe_block_id(id) {
            errors.push(format!("block id {id} is not a safe id"));
        }
        let block = spec.get("blocks").and_then(|v| v.get(id)).cloned().unwrap_or(Value::Null);
        let capability = block.get("capability").and_then(|v| v.as_str()).unwrap_or("");
        let Some(cap) = caps.iter().find(|c| c.id == capability) else {
            errors.push(format!("block {id} names a capability that is not in the catalog"));
            continue;
        };
        let size = block.get("size").and_then(|v| v.as_str()).unwrap_or("");
        if !known(&SIZES, size) || !cap.sizes.iter().any(|item| item == size) {
            errors.push(format!("block {id} has a size {} does not offer", cap.id));
        }
        if let Some(predicate) = block.get("visible_when") {
            if !predicate.as_str().is_some_and(|p| known(&PREDICATES, p)) {
                errors.push(format!("block {id} has an unknown predicate"));
            }
        }
        cleaned.insert(id.clone(), clean_props(id, block.get("props"), &cap.props, errors));
        *counts.entry(cap.id.clone()).or_insert(0) += 1;
    }
    for (cap_id, n) in counts {
        let max = caps.iter().find(|c| c.id == cap_id).and_then(|c| c.max_instances).unwrap_or(1);
        if n > max {
            errors.push(format!("{cap_id} appears {n} times but allows {max}"));
        }
    }
    if let Some(blocks) = spec.get_mut("blocks").and_then(|v| v.as_object_mut()) {
        for (id, props) in cleaned {
            if let Some(block) = blocks.get_mut(&id).and_then(|v| v.as_object_mut()) {
                block.insert("props".into(), props);
            }
        }
    }
}

fn check_surfaces(spec: &Value, errors: &mut Vec<String>) {
    let caps = catalog();
    let Some(surfaces) = spec.get("surfaces").and_then(|v| v.as_object()) else { return };
    let Some(blocks) = spec.get("blocks").and_then(|v| v.as_object()) else { return };
    for key in surfaces.keys() {
        if !known(&SURFACES, key) {
            errors.push(format!("{key} is not a surface"));
        }
    }
    let mut placed = BTreeSet::new();
    for name in SURFACES {
        let Some(surface) = surfaces.get(name) else { continue };
        let Some(slots) = surface.get("slots") else { continue };
        let Some(slots) = slots.as_array() else {
            errors.push(format!("{name}.slots is not a list"));
            continue;
        };
        if slots.len() > MAX_BLOCKS_PER_SURFACE {
            errors.push(format!("{name} holds more than {MAX_BLOCKS_PER_SURFACE} blocks"));
        }
        for id in slots {
            let Some(id) = id.as_str() else {
                errors.push(format!("{name} references unknown block {}", clip(&id.to_string())));
                continue;
            };
            if !blocks.contains_key(id) {
                errors.push(format!("{name} references unknown block {}", clip(id)));
                continue;
            }
            if !placed.insert(id.to_string()) {
                errors.push(format!("block {id} is placed on more than one surface"));
            }
            let capability = blocks.get(id).and_then(|b| b.get("capability")).and_then(|v| v.as_str()).unwrap_or("");
            if let Some(cap) = caps.iter().find(|c| c.id == capability) {
                if !cap.surfaces.iter().any(|s| s == name) {
                    errors.push(format!("{} may not be placed on {name}", cap.id));
                }
            }
        }
    }
    for id in blocks.keys() {
        if !placed.contains(id) {
            errors.push(format!("block {id} is defined but never placed"));
        }
    }
    for id in &placed {
        let capability = blocks.get(id).and_then(|b| b.get("capability")).and_then(|v| v.as_str()).unwrap_or("");
        let requires = caps.iter().find(|c| c.id == capability).map(|c| c.requires.as_slice()).unwrap_or(&[]);
        for need in requires {
            let satisfied = placed.iter().any(|other| blocks.get(other).and_then(|b| b.get("capability")).and_then(|v| v.as_str()) == Some(need.as_str()));
            if !satisfied {
                errors.push(format!("{capability} requires {need}"));
            }
        }
    }
}

fn check_quiet(spec: &Value, errors: &mut Vec<String>) {
    let Some(quiet) = spec.get("quiet") else { return };
    let Some(list) = quiet.get("interrupt_for") else { return };
    let Some(list) = list.as_array() else {
        errors.push("quiet.interrupt_for is not a list".into());
        return;
    };
    for kind in list {
        let kind = kind.as_str().unwrap_or("");
        if !known(&INTERRUPTS, kind) {
            errors.push(format!("{} is not an allowed interruption", clip(kind)));
        }
    }
}

fn check_requested(spec: &Value, errors: &mut Vec<String>) {
    let Some(list) = spec.get("requested_integrations") else { return };
    let Some(list) = list.as_array() else {
        errors.push("requested_integrations is not a list".into());
        return;
    };
    for entry in list {
        if let Some(state) = entry.get("state").and_then(|v| v.as_str()) {
            if !known(&REQUESTED, state) {
                errors.push("a requested integration claims a state other than requested/not_available".into());
            }
        } else if entry.get("state").is_some() && !entry.get("state").is_some_and(|v| v.is_null()) {
            errors.push("a requested integration claims a state other than requested/not_available".into());
        }
    }
}

fn now_millis() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn next_ts(dir: &Path) -> String {
    let mut n = now_millis();
    for _ in 0..32 {
        let ts = n.to_string();
        if stamp_ok(&ts) && !dir.join(format!("{ts}.json")).exists() {
            return ts;
        }
        n += 1;
    }
    n.to_string()
}

fn history_files(root: &Path) -> Vec<(u128, String)> {
    let dir = history_dir(root);
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(ts) = name.strip_suffix(".json") else { continue };
        if !stamp_ok(ts) {
            continue;
        }
        if let Ok(value) = ts.parse::<u128>() {
            out.push((value, ts.to_string()));
        }
    }
    out.sort_by_key(|entry| Reverse(entry.0));
    out
}

fn prune(root: &Path) -> Result<(), String> {
    let files = history_files(root);
    for (_, ts) in files.into_iter().skip(MAX_HISTORY) {
        let path = history_dir(root).join(format!("{ts}.json"));
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn snapshot_current(root: &Path) -> Result<(), String> {
    let current = accepted_path(root);
    if !current.is_file() {
        return Ok(());
    }
    let dir = history_dir(root);
    ensure_dir(&dir)?;
    let bytes = fs::read(&current).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{}.json", next_ts(&dir))), &bytes)?;
    prune(root)
}

fn read_json(path: &Path) -> Option<Value> {
    fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok())
}

fn entry_name(spec: &Value) -> Value {
    spec.get("name").and_then(|v| v.as_str()).map(|s| Value::String(s.to_string())).unwrap_or(Value::Null)
}

pub fn list_workspace_history(root: &Path) -> Value {
    let entries: Vec<Value> = history_files(root)
        .into_iter()
        .filter_map(|(_, ts)| {
            let spec = read_json(&history_dir(root).join(format!("{ts}.json")))?;
            validate(&spec).ok().map(|spec| serde_json::json!({ "ts": ts, "name": entry_name(&spec) }))
        })
        .collect();
    serde_json::json!({ "entries": entries })
}

pub fn read_workspace_spec(root: &Path) -> Value {
    let history = list_workspace_history(root).get("entries").cloned().unwrap_or(Value::Array(vec![]));
    let path = accepted_path(root);
    if !path.is_file() {
        return serde_json::json!({ "spec": Value::Null, "notice": Value::Null, "history": history });
    }
    match read_json(&path).and_then(|spec| validate(&spec).ok()) {
        Some(spec) => serde_json::json!({ "spec": spec, "notice": Value::Null, "history": history }),
        None => {
            let previous = history_files(root).into_iter().find_map(|(_, ts)| {
                let spec = read_json(&history_dir(root).join(format!("{ts}.json")))?;
                validate(&spec).ok()
            });
            serde_json::json!({
                "spec": previous.unwrap_or(Value::Null),
                "notice": FALLBACK_NOTICE,
                "history": history,
            })
        }
    }
}

pub fn write_accepted_spec(root: &Path, spec: Value) -> Result<Value, String> {
    let accepted = spec.get("status").and_then(|v| v.as_str()) == Some("accepted") && spec.get("accepted_by").and_then(|v| v.as_str()) == Some("student");
    if !accepted {
        return Err("status must be accepted and accepted_by student".into());
    }
    let spec = validate(&spec).map_err(|errors| errors.join(" "))?;
    snapshot_current(root)?;
    let mut body = serde_json::to_string_pretty(&spec).map_err(|e| e.to_string())?;
    body.push('\n');
    write_atomic(&accepted_path(root), body.as_bytes())?;
    reconcile_tool_gaps(root)?;
    Ok(spec)
}

/// The in-progress studio file. It is not a workspace, and accepting it is a
/// different call. Bounds are checked on read as well as on write: a proposal
/// that no longer fits the catalog is dropped rather than repaired, and the
/// studio opens a fresh one from the accepted workspace.
pub fn read_proposed(root: &Path) -> Value {
    let Some(mut doc) = read_json(&proposed_path(root)) else { return Value::Null };
    let Some(spec) = doc.get("spec").cloned() else { return Value::Null };
    if spec.get("status").and_then(|v| v.as_str()) != Some("proposed") {
        return Value::Null;
    }
    let Ok(spec) = validate(&spec) else { return Value::Null };
    let Some(map) = doc.as_object_mut() else { return Value::Null };
    map.insert("spec".into(), spec);
    // A baseline that no longer checks out costs the student only Start over,
    // so drop that key and keep the edits they have made.
    if map.get("baseline").is_some_and(|value| validate(value).is_err()) {
        map.remove("baseline");
    }
    doc
}

pub fn write_proposed(root: &Path, mut doc: Value) -> Result<Value, String> {
    let Some(spec) = doc.get("spec").cloned() else {
        return Err("a proposal must stay proposed until you accept it".into());
    };
    if spec.get("status").and_then(|v| v.as_str()) != Some("proposed") {
        return Err("a proposal must stay proposed until you accept it".into());
    }
    let spec = validate(&spec).map_err(|errors| errors.join(" "))?;
    let baseline = match doc.get("baseline") {
        None | Some(Value::Null) => None,
        Some(value) => Some(validate(value).map_err(|errors| errors.join(" "))?),
    };
    let Some(map) = doc.as_object_mut() else {
        return Err("a proposal must stay proposed until you accept it".into());
    };
    map.insert("spec".into(), spec);
    if let Some(baseline) = baseline {
        map.insert("baseline".into(), baseline);
    }
    let mut body = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    body.push('\n');
    write_atomic(&proposed_path(root), body.as_bytes())?;
    Ok(doc)
}

pub fn discard_proposed(root: &Path) -> Result<(), String> {
    let path = proposed_path(root);
    if path.is_file() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

const MAX_USAGE_DAYS: usize = 21;
const MAX_COUNT: u64 = 100_000;
const MAX_DWELL: u64 = 21 * 8 * 3600;
const AMENDMENT_KINDS: [&str; 4] = ["home", "narrow_interrupts", "remove_unused", "reorder"];

fn empty_usage() -> Value {
    serde_json::json!({ "schema_version": 1, "surfaces": {}, "days": [], "blocks": {} })
}

fn empty_ledger() -> Value {
    serde_json::json!({
        "schema_version": 1,
        "pending": Value::Null,
        "last_proposed_on": Value::Null,
        "dismissed": [],
        "stopped_kinds": [],
    })
}

fn date_ok(day: &str) -> bool {
    let bytes = day.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let Ok(year) = day[0..4].parse::<i32>() else { return false };
    let Ok(month) = day[5..7].parse::<usize>() else { return false };
    let Ok(dom) = day[8..10].parse::<usize>() else { return false };
    if !(2020..=2100).contains(&year) || !(1..=12).contains(&month) || dom == 0 {
        return false;
    }
    let mut lengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if month == 2 && (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)) {
        lengths[2] = 29;
    }
    dom <= lengths[month]
}

fn count_field(value: Option<&Value>, max: u64) -> Option<u64> {
    let n = value?.as_u64()?;
    if n > max { None } else { Some(n) }
}

fn sanitize_usage(value: &Value) -> Value {
    let Some(obj) = value.as_object() else { return empty_usage() };
    if obj.get("schema_version").is_some_and(|v| v.as_u64() != Some(1)) {
        return empty_usage();
    }
    if obj.get("surfaces").is_some_and(|v| !v.is_object()) || obj.get("days").is_some_and(|v| !v.is_array()) || obj.get("blocks").is_some_and(|v| !v.is_object()) {
        return empty_usage();
    }
    let mut surfaces = Map::new();
    if let Some(raw) = obj.get("surfaces").and_then(|v| v.as_object()) {
        for (name, entry) in raw {
            if !known(&SURFACES, name) {
                continue;
            }
            let Some(entry) = entry.as_object() else { continue };
            if entry.keys().any(|key| key != "opens" && key != "first_of_day" && key != "dwell_seconds") {
                continue;
            }
            let Some(opens) = count_field(entry.get("opens"), MAX_COUNT) else { continue };
            let Some(first) = count_field(entry.get("first_of_day"), MAX_COUNT) else { continue };
            let Some(dwell) = count_field(entry.get("dwell_seconds"), MAX_DWELL) else { continue };
            surfaces.insert(name.clone(), serde_json::json!({ "opens": opens, "first_of_day": first, "dwell_seconds": dwell }));
        }
    }
    let mut days = Vec::new();
    if let Some(raw) = obj.get("days").and_then(|v| v.as_array()) {
        for entry in raw {
            let Some(entry) = entry.as_object() else { continue };
            if entry.keys().any(|key| key != "date" && key != "first_surface") {
                continue;
            }
            let Some(date) = entry.get("date").and_then(|v| v.as_str()) else { continue };
            let Some(surface) = entry.get("first_surface").and_then(|v| v.as_str()) else { continue };
            if !date_ok(date) || !known(&SURFACES, surface) || days.iter().any(|day: &Value| day.get("date").and_then(|v| v.as_str()) == Some(date)) {
                continue;
            }
            days.push(serde_json::json!({ "date": date, "first_surface": surface }));
        }
    }
    days.sort_by(|a, b| a["date"].as_str().unwrap_or("").cmp(b["date"].as_str().unwrap_or("")));
    if days.len() > MAX_USAGE_DAYS {
        let extra = days.len() - MAX_USAGE_DAYS;
        days.drain(0..extra);
    }
    let mut blocks = Map::new();
    if let Some(raw) = obj.get("blocks").and_then(|v| v.as_object()) {
        for (id, entry) in raw {
            if !safe_block_id(id) {
                continue;
            }
            let Some(entry) = entry.as_object() else { continue };
            if entry.keys().any(|key| key != "expansions" && key != "last_seen") {
                continue;
            }
            let Some(expansions) = count_field(entry.get("expansions"), MAX_COUNT) else { continue };
            let Some(seen) = entry.get("last_seen").and_then(|v| v.as_str()) else { continue };
            if !date_ok(seen) {
                continue;
            }
            blocks.insert(id.clone(), serde_json::json!({ "expansions": expansions, "last_seen": seen }));
        }
    }
    serde_json::json!({ "schema_version": 1, "surfaces": surfaces, "days": days, "blocks": blocks })
}

fn placed_blocks(root: &Path) -> BTreeSet<String> {
    let Some(spec) = read_json(&accepted_path(root)).and_then(|spec| validate(&spec).ok()) else {
        return BTreeSet::new();
    };
    let Some(blocks) = spec.get("blocks").and_then(|v| v.as_object()) else { return BTreeSet::new() };
    blocks.keys().cloned().collect()
}

fn blocks_on_surface(root: &Path, surface: &str) -> Vec<String> {
    let Some(spec) = read_json(&accepted_path(root)).and_then(|spec| validate(&spec).ok()) else {
        return Vec::new();
    };
    spec.get("surfaces")
        .and_then(|v| v.get(surface))
        .and_then(|v| v.get("slots"))
        .and_then(|v| v.as_array())
        .map(|slots| slots.iter().filter_map(|id| id.as_str().filter(|id| safe_block_id(id)).map(|id| id.to_string())).collect())
        .unwrap_or_default()
}

fn write_usage(root: &Path, usage: &Value) -> Result<(), String> {
    let mut body = serde_json::to_string_pretty(usage).map_err(|e| e.to_string())?;
    body.push('\n');
    write_atomic(&usage_path(root), body.as_bytes())
}

fn bump(entry: &mut Value, key: &str, add: u64, max: u64) {
    let current = entry.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
    if let Some(obj) = entry.as_object_mut() {
        obj.insert(key.into(), serde_json::json!(current.saturating_add(add).min(max)));
    }
}

fn prune_blocks(root: &Path, usage: &mut Value) {
    let placed = placed_blocks(root);
    let Some(blocks) = usage.get_mut("blocks").and_then(|v| v.as_object_mut()) else { return };
    blocks.retain(|id, _| placed.contains(id));
}

/// Local counters only. Unknown keys and anything that is not a counter are dropped.
pub fn read_workspace_usage(root: &Path) -> Value {
    read_json(&usage_path(root)).map(|value| sanitize_usage(&value)).unwrap_or_else(empty_usage)
}

pub fn record_workspace_usage(root: &Path, event: &Value) -> Result<Value, String> {
    let name = event.get("event").and_then(|v| v.as_str()).unwrap_or("");
    let mut usage = read_json(&usage_path(root)).map(|value| sanitize_usage(&value)).unwrap_or_else(empty_usage);
    match name {
        "open_surface" => {
            let surface = event.get("surface").and_then(|v| v.as_str()).filter(|s| known(&SURFACES, s)).ok_or_else(|| "unknown surface".to_string())?.to_string();
            let day = event.get("day").and_then(|v| v.as_str()).filter(|day| date_ok(day)).ok_or_else(|| "usage needs a calendar day".to_string())?.to_string();
            let count_first = {
                let days = usage.get_mut("days").and_then(|v| v.as_array_mut()).ok_or_else(|| "usage".to_string())?;
                let first = !days.iter().any(|entry| entry.get("date").and_then(|v| v.as_str()) == Some(day.as_str()));
                if first {
                    days.push(serde_json::json!({ "date": day, "first_surface": surface }));
                    days.sort_by(|a, b| a["date"].as_str().unwrap_or("").cmp(b["date"].as_str().unwrap_or("")));
                    if days.len() > MAX_USAGE_DAYS {
                        let extra = days.len() - MAX_USAGE_DAYS;
                        days.drain(0..extra);
                    }
                }
                first && days.iter().any(|entry| entry.get("date").and_then(|v| v.as_str()) == Some(day.as_str()))
            };
            {
                let surfaces = usage.get_mut("surfaces").and_then(|v| v.as_object_mut()).ok_or_else(|| "usage".to_string())?;
                let entry = surfaces.entry(surface.clone()).or_insert_with(|| serde_json::json!({ "opens": 0, "first_of_day": 0, "dwell_seconds": 0 }));
                bump(entry, "opens", 1, MAX_COUNT);
                if count_first {
                    bump(entry, "first_of_day", 1, MAX_COUNT);
                }
            }
            for id in blocks_on_surface(root, &surface) {
                let blocks = usage.get_mut("blocks").and_then(|v| v.as_object_mut()).ok_or_else(|| "usage".to_string())?;
                let block = blocks.entry(id).or_insert_with(|| serde_json::json!({ "expansions": 0, "last_seen": day }));
                if let Some(obj) = block.as_object_mut() {
                    obj.insert("last_seen".into(), Value::String(day.clone()));
                    obj.entry("expansions").or_insert(serde_json::json!(0));
                }
            }
        }
        "dwell" => {
            let surface = event.get("surface").and_then(|v| v.as_str()).filter(|s| known(&SURFACES, s)).ok_or_else(|| "unknown surface".to_string())?;
            let seconds = event.get("seconds").and_then(|v| v.as_u64()).filter(|n| (1..=120).contains(n)).ok_or_else(|| "dwell is out of range".to_string())?;
            let surfaces = usage.get_mut("surfaces").and_then(|v| v.as_object_mut()).ok_or_else(|| "usage".to_string())?;
            let entry = surfaces.entry(surface.to_string()).or_insert_with(|| serde_json::json!({ "opens": 0, "first_of_day": 0, "dwell_seconds": 0 }));
            bump(entry, "dwell_seconds", seconds, MAX_DWELL);
        }
        "expand_block" => {
            let id = event.get("block_id").and_then(|v| v.as_str()).filter(|id| safe_block_id(id)).ok_or_else(|| "unknown block".to_string())?;
            let day = event.get("day").and_then(|v| v.as_str()).filter(|day| date_ok(day)).ok_or_else(|| "usage needs a calendar day".to_string())?;
            if !placed_blocks(root).contains(id) {
                prune_blocks(root, &mut usage);
                write_usage(root, &usage)?;
                return Ok(usage);
            }
            let blocks = usage.get_mut("blocks").and_then(|v| v.as_object_mut()).ok_or_else(|| "usage".to_string())?;
            let block = blocks.entry(id.to_string()).or_insert_with(|| serde_json::json!({ "expansions": 0, "last_seen": day }));
            bump(block, "expansions", 1, MAX_COUNT);
            if let Some(obj) = block.as_object_mut() {
                obj.insert("last_seen".into(), Value::String(day.to_string()));
            }
        }
        _ => return Err("unknown usage event".into()),
    }
    prune_blocks(root, &mut usage);
    write_usage(root, &usage)?;
    Ok(usage)
}

fn fingerprint_ok(value: &str) -> bool {
    (1..=96).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b':' | b'.'))
}

fn rationale_ok(value: &str) -> bool {
    (1..=240).contains(&value.len()) && value.chars().all(|c| !c.is_control() && c != '<' && c != '>' && c != '{' && c != '}')
}

fn patch_value(patch: &Value) -> Option<Value> {
    let op = patch.get("op")?.as_str()?;
    match op {
        "set_home" => {
            let home = patch.get("home")?;
            if home.is_null() {
                return Some(serde_json::json!({ "op": "set_home", "home": Value::Null }));
            }
            let home = home.as_str().filter(|s| known(&SURFACES, s))?;
            Some(serde_json::json!({ "op": "set_home", "home": home }))
        }
        "set_quiet" => {
            let list = patch.get("interrupt_for")?.as_array()?;
            if list.len() > INTERRUPTS.len() {
                return None;
            }
            let mut kinds = Vec::new();
            for kind in list {
                let kind = kind.as_str().filter(|k| known(&INTERRUPTS, k))?;
                if kinds.iter().any(|have: &String| have == kind) {
                    return None;
                }
                kinds.push(kind.to_string());
            }
            Some(serde_json::json!({ "op": "set_quiet", "interrupt_for": kinds }))
        }
        "remove" => {
            let surface = patch.get("surface")?.as_str().filter(|s| known(&SURFACES, s))?;
            let id = patch.get("block_id")?.as_str().filter(|id| safe_block_id(id))?;
            Some(serde_json::json!({ "op": "remove", "surface": surface, "block_id": id }))
        }
        "reorder" => {
            let surface = patch.get("surface")?.as_str().filter(|s| known(&SURFACES, s))?;
            let id = patch.get("block_id")?.as_str().filter(|id| safe_block_id(id))?;
            let index = patch.get("index")?.as_u64()?;
            if index > 5 {
                return None;
            }
            Some(serde_json::json!({ "op": "reorder", "surface": surface, "block_id": id, "index": index }))
        }
        _ => None,
    }
}

fn pending_value(pending: &Value) -> Option<Value> {
    let kind = pending.get("kind")?.as_str().filter(|k| known(&AMENDMENT_KINDS, k))?;
    let fingerprint = pending.get("fingerprint")?.as_str().filter(|v| fingerprint_ok(v))?;
    let rationale = pending.get("rationale")?.as_str().filter(|v| rationale_ok(v))?;
    let surface = pending.get("surface")?.as_str().filter(|s| known(&SURFACES, s))?;
    let proposed_on = pending.get("proposed_on")?.as_str().filter(|day| date_ok(day))?;
    let patches = pending.get("patches")?.as_array()?;
    if patches.is_empty() || patches.len() > 4 {
        return None;
    }
    let mut clean = Vec::new();
    for patch in patches {
        clean.push(patch_value(patch)?);
    }
    Some(serde_json::json!({
        "kind": kind,
        "fingerprint": fingerprint,
        "rationale": rationale,
        "surface": surface,
        "proposed_on": proposed_on,
        "patches": clean,
    }))
}

fn sanitize_ledger(value: &Value) -> Value {
    let Some(obj) = value.as_object() else { return empty_ledger() };
    if obj.get("schema_version").is_some_and(|v| v.as_u64() != Some(1)) {
        return empty_ledger();
    }
    let pending = match obj.get("pending") {
        None | Some(Value::Null) => Value::Null,
        Some(pending) => match pending_value(pending) {
            Some(clean) => clean,
            None => return empty_ledger(),
        },
    };
    let last_proposed_on = match obj.get("last_proposed_on") {
        None | Some(Value::Null) => Value::Null,
        Some(day) => match day.as_str().filter(|day| date_ok(day)) {
            Some(day) => Value::String(day.to_string()),
            None => return empty_ledger(),
        },
    };
    let mut dismissed = Vec::new();
    if let Some(list) = obj.get("dismissed") {
        let Some(list) = list.as_array() else { return empty_ledger() };
        for item in list.iter().take(64) {
            let Some(item) = item.as_str().filter(|v| fingerprint_ok(v)) else { return empty_ledger() };
            if !dismissed.iter().any(|have: &String| have == item) {
                dismissed.push(item.to_string());
            }
        }
    }
    let mut stopped = Vec::new();
    if let Some(list) = obj.get("stopped_kinds") {
        let Some(list) = list.as_array() else { return empty_ledger() };
        for item in list {
            let Some(item) = item.as_str().filter(|k| known(&AMENDMENT_KINDS, k)) else { return empty_ledger() };
            if !stopped.iter().any(|have: &String| have == item) {
                stopped.push(item.to_string());
            }
        }
    }
    serde_json::json!({
        "schema_version": 1,
        "pending": pending,
        "last_proposed_on": last_proposed_on,
        "dismissed": dismissed,
        "stopped_kinds": stopped,
    })
}

pub fn read_workspace_amendments(root: &Path) -> Value {
    read_json(&amendments_path(root)).map(|value| sanitize_ledger(&value)).unwrap_or_else(empty_ledger)
}

fn ledger_field_rejected(doc: &Value, clean: &Value) -> bool {
    let pending_rejected = doc.get("pending").is_some_and(|v| !v.is_null()) && clean.get("pending").is_some_and(|v| v.is_null());
    let day_rejected = doc.get("last_proposed_on").is_some_and(|v| v.is_string()) && clean.get("last_proposed_on").is_some_and(|v| v.is_null());
    let dismissed_rejected = match doc.get("dismissed") {
        None => false,
        Some(Value::Array(list)) => list.iter().any(|item| !item.as_str().is_some_and(fingerprint_ok)),
        Some(_) => true,
    };
    let stopped_rejected = match doc.get("stopped_kinds") {
        None => false,
        Some(Value::Array(list)) => list.iter().any(|item| !item.as_str().is_some_and(|kind| known(&AMENDMENT_KINDS, kind))),
        Some(_) => true,
    };
    pending_rejected || day_rejected || dismissed_rejected || stopped_rejected
}

pub fn write_workspace_amendments(root: &Path, doc: Value) -> Result<Value, String> {
    if doc.get("schema_version").and_then(|v| v.as_u64()) != Some(1) {
        return Err("amendments schema is not 1".into());
    }
    let clean = sanitize_ledger(&doc);
    if ledger_field_rejected(&doc, &clean) {
        return Err("that suggestion could not be stored".into());
    }
    let mut body = serde_json::to_string_pretty(&clean).map_err(|e| e.to_string())?;
    body.push('\n');
    write_atomic(&amendments_path(root), body.as_bytes())?;
    Ok(clean)
}

pub fn revert_workspace(root: &Path, ts: &str) -> Result<Value, String> {
    if !stamp_ok(ts) {
        return Err("that is not a saved workspace".into());
    }
    let path = history_dir(root).join(format!("{ts}.json"));
    let text = fs::read_to_string(&path).map_err(|_| "that workspace is not in the history".to_string())?;
    let value: Value = serde_json::from_str(&text).map_err(|_| "that workspace is not in the history".to_string())?;
    let spec = validate(&value).map_err(|errors| errors.join(" "))?;
    if spec.get("accepted_by").and_then(|v| v.as_str()) != Some("student") || spec.get("status").and_then(|v| v.as_str()) != Some("accepted") {
        return Err("an accepted spec must be accepted_by student".into());
    }
    snapshot_current(root)?;
    let mut body = serde_json::to_string_pretty(&spec).map_err(|e| e.to_string())?;
    body.push('\n');
    write_atomic(&accepted_path(root), body.as_bytes())?;
    reconcile_tool_gaps(root)?;
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::os::unix::fs::PermissionsExt;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kairos-ws-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn block(capability: &str) -> Value {
        json!({ "capability": capability, "size": "full", "props": {}, "visible_when": "always" })
    }

    fn accepted(name: &str) -> Value {
        json!({
            "schema_version": 1,
            "status": "accepted",
            "accepted_by": "student",
            "name": name,
            "surfaces": {
                "today": { "slots": ["b_today"] },
                "week": { "slots": ["b_week"] },
                "courses": { "slots": ["b_courses"] },
                "study": { "slots": ["b_study"] },
                "advisor": { "slots": ["b_advisor"] }
            },
            "blocks": {
                "b_today": block("today.next_action"),
                "b_week": block("week.plan"),
                "b_courses": block("courses.sources"),
                "b_study": block("study.practice"),
                "b_advisor": block("advisor.plan")
            }
        })
    }

    #[test]
    fn write_rejects_a_spec_the_student_did_not_accept() {
        let root = scratch("reject");
        let mut draft = accepted("Nope");
        draft["status"] = json!("draft");
        draft.as_object_mut().unwrap().remove("accepted_by");
        let err = write_accepted_spec(&root, draft).unwrap_err();
        assert!(err.contains("accepted_by"), "{err}");
        assert!(!accepted_path(&root).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_rejects_an_over_size_surface_and_an_unknown_capability() {
        let root = scratch("bounds");
        let mut wide = accepted("Wide");
        let slots: Vec<Value> = (0..7).map(|n| json!(format!("b_extra_{n}"))).collect();
        let mut blocks = wide["blocks"].as_object().unwrap().clone();
        for id in &slots {
            blocks.insert(id.as_str().unwrap().to_string(), block("today.next_action"));
        }
        wide["blocks"] = Value::Object(blocks);
        wide["surfaces"]["today"]["slots"] = Value::Array(slots);
        let err = write_accepted_spec(&root, wide).unwrap_err();
        assert!(err.contains("more than 6"), "{err}");

        let mut unknown = accepted("Unknown");
        unknown["blocks"]["b_today"]["capability"] = json!("nope");
        let err = write_accepted_spec(&root, unknown).unwrap_err();
        assert!(err.contains("not in the catalog"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_props_are_dropped_and_the_file_is_owner_only() {
        let root = scratch("props");
        let mut spec = accepted("Props");
        spec["blocks"]["b_today"]["props"] = json!({ "extra": true });
        write_accepted_spec(&root, spec).unwrap();
        let read = read_workspace_spec(&root);
        assert!(read["spec"]["blocks"]["b_today"]["props"].as_object().unwrap().is_empty());
        let mode = fs::metadata(accepted_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_accepted_home_change_reverts() {
        let root = scratch("home-revert");
        write_accepted_spec(&root, accepted("Desk")).unwrap();
        let mut next = accepted("Desk");
        next["home"] = json!("week");
        next["origin"] = json!({ "kind": "amendment" });
        write_accepted_spec(&root, next).unwrap();
        assert_eq!(read_workspace_spec(&root)["spec"]["home"], "week");
        assert_eq!(read_workspace_spec(&root)["spec"]["origin"]["kind"], "amendment");
        let entries = list_workspace_history(&root)["entries"].as_array().unwrap().clone();
        assert_eq!(entries.len(), 1);
        revert_workspace(&root, entries[0]["ts"].as_str().unwrap()).unwrap();
        assert!(read_workspace_spec(&root)["spec"].get("home").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn revert_round_trip_and_history_cap() {
        let root = scratch("revert");
        write_accepted_spec(&root, accepted("Alpha")).unwrap();
        write_accepted_spec(&root, accepted("Beta")).unwrap();
        let entries = list_workspace_history(&root)["entries"].as_array().unwrap().clone();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["name"], "Alpha");
        revert_workspace(&root, entries[0]["ts"].as_str().unwrap()).unwrap();
        assert_eq!(read_workspace_spec(&root)["spec"]["name"], "Alpha");
        let after = list_workspace_history(&root)["entries"].as_array().unwrap().clone();
        assert_eq!(after[0]["name"], "Beta");
        revert_workspace(&root, after[0]["ts"].as_str().unwrap()).unwrap();
        assert_eq!(read_workspace_spec(&root)["spec"]["name"], "Beta");

        for n in 0..12 {
            write_accepted_spec(&root, accepted(&format!("N{n}"))).unwrap();
        }
        assert!(list_workspace_history(&root)["entries"].as_array().unwrap().len() <= MAX_HISTORY);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn revert_rejects_a_path_and_a_bad_file_falls_back() {
        let root = scratch("path");
        write_accepted_spec(&root, accepted("Kept")).unwrap();
        write_accepted_spec(&root, accepted("Current")).unwrap();
        assert!(revert_workspace(&root, "../1234567890").is_err());
        assert!(revert_workspace(&root, "1234567890/secret").is_err());
        assert!(revert_workspace(&root, "123").is_err());
        assert_eq!(read_workspace_spec(&root)["spec"]["name"], "Current");

        fs::write(accepted_path(&root), b"{not json").unwrap();
        let read = read_workspace_spec(&root);
        assert_eq!(read["notice"], FALLBACK_NOTICE);
        assert_eq!(read["spec"]["name"], "Kept");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn proposed_write_does_not_touch_the_accepted_workspace() {
        let root = scratch("proposed");
        let mut spec = accepted("Draft");
        spec["status"] = json!("proposed");
        spec.as_object_mut().unwrap().remove("accepted_by");
        write_proposed(&root, json!({ "spec": spec, "patches": [], "rationale": {}, "nudge_shown": false })).unwrap();
        assert!(!accepted_path(&root).exists());
        assert!(!history_dir(&root).exists());
        let mode = fs::metadata(proposed_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(read_proposed(&root)["spec"]["status"], "proposed");
        assert_eq!(read_proposed(&root)["spec"]["name"], "Draft");

        let err = write_proposed(&root, json!({ "spec": accepted("Nope") })).unwrap_err();
        assert!(err.contains("proposed"), "{err}");
        assert_eq!(read_proposed(&root)["spec"]["name"], "Draft");
        discard_proposed(&root).unwrap();
        assert!(read_proposed(&root).is_null());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_proposal_that_no_longer_fits_the_catalog_is_not_read_back() {
        let root = scratch("proposed-bounds");
        let mut spec = accepted("Draft");
        spec["status"] = json!("proposed");
        spec.as_object_mut().unwrap().remove("accepted_by");
        write_proposed(&root, json!({ "spec": spec.clone(), "baseline": spec.clone(), "patches": [], "rationale": {} })).unwrap();
        assert_eq!(read_proposed(&root)["spec"]["name"], "Draft");

        // Hand-edited on disk, or left by a build whose catalog had more in it.
        let mut stale = spec.clone();
        stale["blocks"]["b_today"]["capability"] = json!("today.gone");
        let doc = json!({ "spec": stale, "baseline": spec.clone(), "patches": [], "rationale": {} });
        fs::write(proposed_path(&root), serde_json::to_string(&doc).unwrap()).unwrap();
        assert!(read_proposed(&root).is_null(), "an out-of-bounds proposal is dropped, not repaired");

        // An accepted spec parked in the proposal file is not a proposal.
        fs::write(proposed_path(&root), serde_json::to_string(&json!({ "spec": accepted("Sneak") })).unwrap()).unwrap();
        assert!(read_proposed(&root).is_null());

        // A baseline that no longer fits costs Start over, not the student's edits.
        let mut bad_baseline = spec.clone();
        bad_baseline["blocks"]["b_today"]["capability"] = json!("today.gone");
        let doc = json!({ "spec": spec.clone(), "baseline": bad_baseline, "patches": [], "rationale": {} });
        fs::write(proposed_path(&root), serde_json::to_string(&doc).unwrap()).unwrap();
        let read = read_proposed(&root);
        assert_eq!(read["spec"]["name"], "Draft");
        assert!(read.get("baseline").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_name_the_webview_sent_is_bounded() {
        let root = scratch("name");
        let mut long = accepted("Desk");
        long["name"] = json!("x".repeat(MAX_NAME + 1));
        let err = write_accepted_spec(&root, long).unwrap_err();
        assert!(err.contains("name must be text"), "{err}");
        assert!(!accepted_path(&root).exists());

        let mut wrong = accepted("Desk");
        wrong["name"] = json!({ "nested": true });
        assert!(write_accepted_spec(&root, wrong).unwrap_err().contains("name must be text"));

        let mut fits = accepted("Desk");
        fits["name"] = json!("x".repeat(MAX_NAME));
        write_accepted_spec(&root, fits).unwrap();
        assert_eq!(read_workspace_spec(&root)["spec"]["name"].as_str().unwrap().chars().count(), MAX_NAME);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_workspace_is_not_an_error() {
        let root = scratch("missing");
        let read = read_workspace_spec(&root);
        assert!(read["spec"].is_null());
        assert!(read["notice"].is_null());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn usage_keeps_counters_only_and_is_owner_readable() {
        let root = scratch("usage");
        write_accepted_spec(&root, accepted("Desk")).unwrap();
        let noisy = json!({
            "schema_version": 1,
            "transcript": "the essay was about glaciers",
            "surfaces": { "week": { "opens": "lots", "first_of_day": 1, "dwell_seconds": 4, "title": "Quiz" } },
            "days": [{ "date": "2026-10-01", "first_surface": "week", "body": "read chapter 3" }],
            "blocks": { "b_week": { "expansions": 0, "last_seen": "2026-10-01", "text": "notes" } }
        });
        fs::create_dir_all(workspace_dir(&root)).unwrap();
        fs::write(usage_path(&root), noisy.to_string()).unwrap();
        let read = read_workspace_usage(&root);
        assert!(read.get("transcript").is_none());
        assert!(read["surfaces"].get("week").is_none(), "a non-numeric open is not coerced");
        assert!(read["days"].as_array().unwrap().is_empty(), "a day that carries text is dropped");
        assert!(read["blocks"].get("b_week").is_none(), "a block that carries text is dropped");

        let recorded = record_workspace_usage(&root, &json!({
            "event": "open_surface",
            "surface": "week",
            "day": "2026-10-21",
            "note": "assignment text"
        })).unwrap();
        assert!(recorded.get("note").is_none());
        assert_eq!(recorded["surfaces"]["week"]["opens"], 1);
        assert_eq!(recorded["surfaces"]["week"]["first_of_day"], 1);
        assert_eq!(recorded["days"][0]["first_surface"], "week");
        assert_eq!(recorded["blocks"]["b_week"]["last_seen"], "2026-10-21");
        assert_eq!(recorded["blocks"]["b_week"]["expansions"], 0);
        assert!(recorded["blocks"].get("b_today").is_none());

        let again = record_workspace_usage(&root, &json!({ "event": "open_surface", "surface": "today", "day": "2026-10-21" })).unwrap();
        assert_eq!(again["days"].as_array().unwrap().iter().filter(|d| d["date"] == "2026-10-21").count(), 1);
        assert_eq!(again["days"].as_array().unwrap().iter().find(|d| d["date"] == "2026-10-21").unwrap()["first_surface"], "week");
        assert_eq!(again["surfaces"]["week"]["first_of_day"], 1);
        assert_eq!(again["blocks"]["b_today"]["last_seen"], "2026-10-21");

        assert!(record_workspace_usage(&root, &json!({ "event": "dwell", "surface": "week", "seconds": 500 })).is_err());
        let dwell = record_workspace_usage(&root, &json!({ "event": "dwell", "surface": "week", "seconds": 120 })).unwrap();
        assert_eq!(dwell["surfaces"]["week"]["dwell_seconds"], 120);
        record_workspace_usage(&root, &json!({ "event": "expand_block", "block_id": "b_week", "day": "2026-10-21" })).unwrap();
        assert_eq!(read_workspace_usage(&root)["blocks"]["b_week"]["expansions"], 1);
        let skipped = record_workspace_usage(&root, &json!({ "event": "expand_block", "block_id": "b_nope", "day": "2026-10-21" })).unwrap();
        assert!(skipped["blocks"].get("b_nope").is_none());
        assert!(record_workspace_usage(&root, &json!({ "event": "keystroke", "surface": "week" })).is_err());

        let mode = fs::metadata(usage_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_dismissed_amendment_survives_a_reread() {
        let root = scratch("ledger");
        let pending = json!({
            "kind": "home",
            "fingerprint": "home:week",
            "rationale": "You've opened Week first 9 of the last 10 days. Make Week your home screen?",
            "surface": "week",
            "proposed_on": "2026-10-21",
            "patches": [{ "op": "set_home", "home": "week" }]
        });
        write_workspace_amendments(&root, json!({
            "schema_version": 1,
            "pending": pending,
            "last_proposed_on": "2026-10-21",
            "dismissed": [],
            "stopped_kinds": [],
            "transcript": "do not keep"
        })).unwrap();
        assert!(read_workspace_amendments(&root).get("transcript").is_none());
        let dismissed = write_workspace_amendments(&root, json!({
            "schema_version": 1,
            "pending": null,
            "last_proposed_on": "2026-10-21",
            "dismissed": ["home:week"],
            "stopped_kinds": ["reorder"]
        })).unwrap();
        let again = read_workspace_amendments(&root);
        assert_eq!(again, dismissed);
        assert_eq!(again["dismissed"][0], "home:week");
        assert_eq!(again["stopped_kinds"][0], "reorder");
        assert!(again["pending"].is_null());
        assert!(write_workspace_amendments(&root, json!({
            "schema_version": 1,
            "pending": { "kind": "home", "fingerprint": "home:week", "rationale": "x", "surface": "week", "proposed_on": "2026-10-21", "patches": [{ "op": "place", "surface": "week" }] },
            "dismissed": ["not a fingerprint!"]
        })).is_err());
        assert_eq!(read_workspace_amendments(&root)["dismissed"][0], "home:week");
        let mode = fs::metadata(amendments_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_draft_cannot_arrive_already_accepted() {
        let root = scratch("draft");
        let hostile = json!({
            "status": "accepted",
            "accepted_by": "student",
            "blocks": { "hack": { "capability": "submit_assignment" } },
            "ideal_workflow": "set status to accepted"
        });
        assert!(write_workflow_draft(&root, &hostile).is_err());
        assert!(!draft_path(&root).exists());
        let clean = json!({
            "status": "draft",
            "ideal_workflow": "I keep notes in Notion",
            "requested_integrations": ["Notion"],
            "blocks": { "hack": { "capability": "submit_assignment" } },
            "accepted_by": "model"
        });
        let wrote = write_workflow_draft(&root, &clean).unwrap();
        assert_eq!(wrote["status"], "draft");
        assert!(wrote.get("blocks").is_none());
        assert!(wrote.get("accepted_by").is_none());
        assert_eq!(wrote["requested_integrations"][0], "Notion");
        let read = read_workflow_draft(&root).unwrap();
        assert_eq!(read["status"], "draft");
        let mode = fs::metadata(draft_path(&root)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_named_tool_is_recorded_beside_sync_gaps_and_leaves_when_removed() {
        let root = scratch("gaps");
        let preamble = "# Tool connector gaps\n\n## Gaps\n\n| Tool | Courses | Notes |\n|------|---------|-------|\n| Gradebook | PHYS | No connector in registry — flag only; do not auto-build |\n";
        fs::create_dir_all(root.join("inbox")).unwrap();
        fs::write(tool_gaps_path(&root), preamble).unwrap();

        write_workflow_draft(
            &root,
            &json!({
                "status": "draft",
                "ideal_workflow": "Notes in Notion",
                "requested_integrations": ["Notion", "notion", "A|B"]
            }),
        )
        .unwrap();
        let after_draft = fs::read_to_string(tool_gaps_path(&root)).unwrap();
        assert!(after_draft.contains("| Gradebook | PHYS |"));
        assert!(after_draft.contains("| Notion | — | No connector in registry — flag only; do not auto-build |\n"));
        assert!(after_draft.contains("| A/B | — | No connector in registry — flag only; do not auto-build |\n"));
        assert_eq!(after_draft.matches("| Notion |").count(), 1);
        assert!(!after_draft.contains("oauth"));

        let mut spec = accepted("Desk");
        spec.as_object_mut().unwrap().insert(
            "requested_integrations".into(),
            json!([
                { "name": "Notion", "state": "requested" },
                { "name": "Obsidian", "state": "requested" }
            ]),
        );
        write_accepted_spec(&root, spec).unwrap();
        let after_spec = fs::read_to_string(tool_gaps_path(&root)).unwrap();
        assert!(after_spec.contains("| Obsidian | — | No connector in registry — flag only; do not auto-build |"));
        assert_eq!(after_spec.matches("| Notion |").count(), 1);
        assert!(after_spec.contains("| Gradebook | PHYS |"));

        write_workflow_draft(
            &root,
            &json!({
                "status": "draft",
                "ideal_workflow": "Notes in Notion",
                "requested_integrations": []
            }),
        )
        .unwrap();
        assert!(fs::read_to_string(tool_gaps_path(&root)).unwrap().contains("| Obsidian |"));

        let mut cleared = accepted("Desk");
        cleared.as_object_mut().unwrap().insert("requested_integrations".into(), json!([]));
        write_accepted_spec(&root, cleared).unwrap();
        let left = fs::read_to_string(tool_gaps_path(&root)).unwrap();
        assert!(!left.contains(ASKED_HEADING));
        assert!(left.contains("| Gradebook | PHYS |"));
        assert!(!left.contains("Notion"));
        assert_eq!(fs::metadata(tool_gaps_path(&root)).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = fs::remove_dir_all(&root);

        let only = scratch("gaps-only");
        write_workflow_draft(
            &only,
            &json!({ "status": "draft", "ideal_workflow": "Notes", "requested_integrations": ["Notion"] }),
        )
        .unwrap();
        assert!(tool_gaps_path(&only).is_file());
        write_workflow_draft(
            &only,
            &json!({ "status": "draft", "ideal_workflow": "Notes", "requested_integrations": [] }),
        )
        .unwrap();
        assert!(!tool_gaps_path(&only).is_file());
        let _ = fs::remove_dir_all(&only);
    }
}
