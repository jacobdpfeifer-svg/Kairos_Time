//! Read-only academic-advisor snapshot assembled from the student's local inbox.
//! Requirement claims remain bounded by the dated student-provided audit.
//!
//! The audit grammar (section headings, remaining-credit phrases, 90-day
//! staleness) mirrors `src/canvas_mcp/core/degree_audit.py`, which stays the
//! authority for the agent path. Keep the two in step.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Same window as `degree_audit.STALE_DAYS`.
const STALE_DAYS: i64 = 90;
const MAX_ITEMS: usize = 6;
const MAX_ITEM_CHARS: usize = 160;

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

/// Template hints such as "(fill during onboarding)" or "YYYY-MM-DD" are not
/// student answers.
fn is_placeholder(value: &str) -> bool {
    let v = value.trim();
    v.is_empty() || v.starts_with('(') || v.eq_ignore_ascii_case("YYYY-MM-DD")
}

fn answer(value: String) -> String {
    if is_placeholder(&value) {
        String::new()
    } else {
        value
    }
}

/// `(frontmatter, body)`; frontmatter only counts when the file opens with `---`.
fn split_frontmatter(raw: &str) -> (&str, &str) {
    let trimmed = raw.trim_start_matches('\u{feff}');
    let Some(rest) = trimmed
        .strip_prefix("---\n")
        .or_else(|| trimmed.strip_prefix("---\r\n"))
    else {
        return ("", trimmed);
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim() == "---" {
            return (&rest[..offset], &rest[offset + line.len()..]);
        }
        offset += line.len();
    }
    ("", trimmed)
}

fn frontmatter_value(frontmatter: &str, key: &str) -> String {
    let prefix = format!("{key}:");
    frontmatter
        .lines()
        .find_map(|line| line.trim().strip_prefix(&prefix))
        .map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string())
        .unwrap_or_default()
}

fn profile_value(raw: &str, label: &str) -> String {
    let needle = format!("**{label}:**");
    let value = raw
        .lines()
        .find_map(|line| {
            line.trim()
                .trim_start_matches("- ")
                .strip_prefix(&needle)
                .map(|v| v.trim().to_string())
        })
        .unwrap_or_default();
    answer(value)
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Complete,
    InProgress,
    Unmet,
}

/// Heading line → section, matching `degree_audit._SECTION_RE` (0–3 `#`,
/// optional trailing colon, the label alone on its line).
fn section_heading(line: &str) -> Option<Section> {
    let trimmed = line.trim();
    if trimmed.starts_with("####") {
        return None;
    }
    let label = trimmed
        .trim_start_matches('#')
        .trim()
        .trim_end_matches(':')
        .trim()
        .to_ascii_lowercase();
    let words: Vec<&str> = label.split_whitespace().collect();
    match words.join(" ").as_str() {
        "complete" | "completed" => Some(Section::Complete),
        "in progress" | "in-progress" | "inprogress" => Some(Section::InProgress),
        "unmet" | "not complete" | "still needed" | "unfulfilled" | "remaining" => Some(Section::Unmet),
        _ => None,
    }
}

#[derive(Default)]
struct Sections {
    complete: String,
    in_progress: String,
    unmet: String,
}

fn split_sections(body: &str) -> Sections {
    let mut out = Sections::default();
    let mut current: Option<Section> = None;
    for line in body.lines() {
        if let Some(section) = section_heading(line) {
            current = Some(section);
            continue;
        }
        // Any other Markdown heading (e.g. "## Notes") ends the block.
        if line.trim_start().starts_with('#') {
            current = None;
            continue;
        }
        let target = match current {
            Some(Section::Complete) => &mut out.complete,
            Some(Section::InProgress) => &mut out.in_progress,
            Some(Section::Unmet) => &mut out.unmet,
            None => continue,
        };
        target.push_str(line);
        target.push('\n');
    }
    out
}

/// Drops "(… e.g. `Remaining credits: 42`)" style template hints so an
/// example number is never read as the student's total.
fn strip_example_hints(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('(') {
        let Some(close) = rest[open..].find(')') else {
            break;
        };
        let inner = &rest[open..open + close + 1];
        out.push_str(&rest[..open]);
        if !inner.to_ascii_lowercase().contains("e.g.") {
            out.push_str(inner);
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out
}

/// Remaining-credit phrases from `degree_audit._CREDITS_RE`; the earliest
/// phrase followed by a number wins.
fn remaining_credits(text: &str) -> Option<f64> {
    const PHRASES: [&str; 12] = [
        "credits still needed",
        "credit still needed",
        "credits needed",
        "credit needed",
        "credits remaining",
        "credit remaining",
        "credits required",
        "credit required",
        "remaining credits",
        "remaining credit",
        "hours needed",
        "hour needed",
    ];
    let cleaned = strip_example_hints(text);
    let lower = cleaned.to_ascii_lowercase();
    let mut best: Option<(usize, f64)> = None;
    for phrase in PHRASES {
        let mut from = 0;
        while let Some(found) = lower[from..].find(phrase) {
            let start = from + found;
            from = start + phrase.len();
            let rest = lower[from..].trim_start();
            let rest = rest.strip_prefix([':', '=']).unwrap_or(rest).trim_start();
            let number: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(value) = number.trim_end_matches('.').parse::<f64>() {
                if best.is_none_or(|(at, _)| start < at) {
                    best = Some((start, value));
                }
                break;
            }
        }
    }
    best.map(|(_, value)| value)
}

/// Top-level bullet texts of one section: no nested bullets, no template
/// hints, and no remaining-credit lines (those are a total, not a block).
fn section_items(body: &str) -> Vec<String> {
    body.lines()
        .filter(|line| {
            let indent = line.len() - line.trim_start().len();
            indent < 2
        })
        .filter_map(|line| {
            let t = line.trim();
            t.strip_prefix("- ")
                .or_else(|| t.strip_prefix("* "))
                .map(str::trim)
        })
        .filter(|item| !is_placeholder(item))
        .filter(|item| remaining_credits(item).is_none())
        .map(|item| {
            if item.chars().count() > MAX_ITEM_CHARS {
                let cut: String = item.chars().take(MAX_ITEM_CHARS - 1).collect();
                format!("{}…", cut.trim_end())
            } else {
                item.to_string()
            }
        })
        .collect()
}

/// Days since the epoch for a proleptic Gregorian date (stdlib-only).
fn civil_days(year: i64, month: i64, day: i64) -> i64 {
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Accepts the same formats as `degree_audit._parse_date`.
fn parse_date(raw: &str) -> Option<(i64, i64, i64)> {
    let s = raw.trim();
    let parts: Vec<&str> = s.split(['-', '/']).collect();
    if parts.len() != 3 {
        return None;
    }
    let nums: Vec<i64> = parts.iter().filter_map(|p| p.parse().ok()).collect();
    if nums.len() != 3 {
        return None;
    }
    let (y, m, d) = if parts[0].len() == 4 {
        (nums[0], nums[1], nums[2])
    } else if parts[2].len() == 4 && s.contains('/') {
        (nums[2], nums[0], nums[1])
    } else {
        return None;
    };
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((y, m, d))
}

fn today_days() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86_400)
        .unwrap_or(0)
}

/// Age of the import in days. A date in the future is a typo, not a fresh
/// audit, so it is treated like a missing date.
fn days_old(imported_on: &str, today: i64) -> Option<i64> {
    let (y, m, d) = parse_date(imported_on)?;
    let age = today - civil_days(y, m, d);
    if age < -1 {
        return None;
    }
    Some(age.max(0))
}

/// "APPM1235" → "APPM 1235"; anything else is left alone.
fn display_code(stem: &str) -> String {
    let letters: String = stem.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    let rest = &stem[letters.len()..];
    if (2..=5).contains(&letters.len()) && rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("{letters} {rest}")
    } else {
        stem.to_string()
    }
}

fn course_codes(user_root: &Path) -> Vec<String> {
    let dir = user_root.join("inbox").join("courses");
    let mut codes: Vec<String> = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_file() && path.extension().and_then(|v| v.to_str()) == Some("md"))
        .filter_map(|path| path.file_stem().and_then(|v| v.to_str()).map(str::to_string))
        .filter(|stem| !stem.starts_with(['_', '.']))
        .map(|stem| display_code(&stem))
        .collect();
    codes.sort();
    codes.dedup();
    codes
}

fn official_url(user_root: &Path) -> Option<String> {
    let raw = fs::read_to_string(user_root.join("school").join("profile.json")).ok()?;
    let profile = serde_json::from_str::<Value>(&raw).ok()?;
    let url = profile.get("canvas_base_url")?.as_str()?;
    url.starts_with("https://").then(|| url.to_string())
}

struct Facts<'a> {
    present: bool,
    dated: bool,
    stale: bool,
    imported_on: &'a str,
    program: &'a str,
    catalog_year: &'a str,
    target: &'a str,
    remaining: Option<f64>,
    unmet: &'a [String],
}

/// Meeting questions built from what is actually missing or open, so the
/// brief names the student's own blocks instead of generic prompts.
fn questions(f: &Facts) -> Vec<String> {
    let mut out = Vec::new();
    if !f.present {
        out.push("Can we pull up my degree audit together and confirm which requirements are still open?".to_string());
    } else if !f.dated {
        out.push("My audit copy has no import date. Can we check it against the live audit?".to_string());
    } else if f.stale {
        out.push(format!(
            "My audit copy is from {}. Has anything changed since then?",
            f.imported_on
        ));
    }
    if f.program.is_empty() || f.catalog_year.is_empty() {
        out.push("Which program and catalog year should my plan follow?".to_string());
    }
    for item in f.unmet.iter().take(3) {
        out.push(format!("What is the best way to finish \"{item}\", and when is it offered?"));
    }
    match (f.target.is_empty(), f.remaining) {
        (false, Some(credits)) => out.push(format!(
            "Is {} still realistic with {} credits left?",
            f.target,
            trim_number(credits)
        )),
        (false, None) => out.push(format!("Is {} still realistic for me?", f.target)),
        (true, _) => out.push("What graduation term should I plan toward?".to_string()),
    }
    out.push("Do any transfer, AP, or prior credits apply that are not showing yet?".to_string());
    out.push("If registration is tight, which next-term course should I protect first?".to_string());
    out
}

fn trim_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

pub fn read_snapshot(user_root: &Path) -> Value {
    snapshot_at(user_root, today_days())
}

fn snapshot_at(user_root: &Path, today: i64) -> Value {
    let user = read(&user_root.join("USER.md"));
    let audit_raw = read(&user_root.join("inbox").join("degree-audit.md"));
    let (frontmatter, body) = split_frontmatter(&audit_raw);
    let imported_on = answer(frontmatter_value(frontmatter, "imported_on"));
    let sections = split_sections(body);
    let complete_items = section_items(&sections.complete);
    let in_progress_items = section_items(&sections.in_progress);
    let unmet_items = section_items(&sections.unmet);
    let remaining = remaining_credits(&sections.unmet).or_else(|| remaining_credits(body));
    // An untouched template is not an import.
    let present = !complete_items.is_empty()
        || !in_progress_items.is_empty()
        || !unmet_items.is_empty()
        || remaining.is_some();
    // Template frontmatter carries an example catalog year; only a real import's counts.
    let audit_catalog = if present { answer(frontmatter_value(frontmatter, "catalog_year")) } else { String::new() };
    let age = days_old(&imported_on, today);
    let dated = present && age.is_some();
    let stale = present && age.is_none_or(|days| days > STALE_DAYS);

    let program = profile_value(&user, "Declared major(s)");
    let catalog_year = if audit_catalog.is_empty() {
        profile_value(&user, "Catalog year")
    } else {
        audit_catalog.clone()
    };
    let target = profile_value(&user, "Target grad term");
    let sync_health = crate::canvas::read_sync_health(user_root);
    let synced_at = sync_health.get("as_of").and_then(Value::as_str).unwrap_or("").to_string();

    let mode = if !present {
        "planning"
    } else if stale {
        "stale_audit"
    } else {
        "tier2_dated_audit"
    };
    let label = if !present {
        "No degree audit imported yet".to_string()
    } else if !dated {
        "Audit copy has no import date".to_string()
    } else if stale {
        format!("Audit copied on {imported_on}, more than {STALE_DAYS} days ago")
    } else {
        format!("Audit copied on {imported_on}")
    };
    let questions = questions(&Facts {
        present,
        dated,
        stale,
        imported_on: &imported_on,
        program: &program,
        catalog_year: &catalog_year,
        target: &target,
        remaining,
        unmet: &unmet_items,
    });

    json!({
        "mode": mode,
        "as_of": synced_at,
        "program": program,
        "catalog_year": catalog_year,
        "target_grad_term": target,
        "official_url": official_url(user_root),
        "audit": {
            "present": present,
            "dated": dated,
            "imported_on": if dated { json!(imported_on) } else { Value::Null },
            "stale_days": age.filter(|_| present),
            "catalog_year": if audit_catalog.is_empty() { Value::Null } else { json!(audit_catalog) },
            "stale": stale,
            "label": label,
            "remaining_credits": if present { json!(remaining) } else { Value::Null },
            "complete_count": complete_items.len(),
            "in_progress_count": in_progress_items.len(),
            "unmet_count": unmet_items.len(),
            "in_progress_items": in_progress_items.iter().take(MAX_ITEMS).collect::<Vec<_>>(),
            "unmet_items": unmet_items.iter().take(MAX_ITEMS).collect::<Vec<_>>()
        },
        "courses": course_codes(user_root),
        "sources": {
            "canvas": if synced_at.is_empty() { "Canvas not synced yet" } else { "Observed in Canvas" },
            "audit": if !present { "No audit copy" } else if stale { "Your audit copy, out of date" } else { "Your dated audit copy" },
            "profile": if program.is_empty() && target.is_empty() { "Not in your profile yet" } else { "Your profile" }
        },
        "questions": questions
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    // 2026-10-13
    const TODAY: i64 = 20_739;

    fn root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("kairos-advisor-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("inbox/courses")).unwrap();
        root
    }

    #[test]
    fn today_constant_matches_the_civil_calendar() {
        assert_eq!(civil_days(2026, 10, 13), TODAY);
    }

    #[test]
    fn parses_dated_audit_without_claiming_live_status() {
        let root = root("dated");
        fs::write(
            root.join("USER.md"),
            "- **Declared major(s):** Physics\n- **Target grad term:** Spring 2029\n",
        )
        .unwrap();
        fs::write(
            root.join("inbox/degree-audit.md"),
            "---\nimported_on: 2026-10-01\ncatalog_year: \"2025-2026\"\n---\n## Complete\n- Calculus 1\n  - AP credit\n## In progress\n- PHYS 2210\n## Unmet\n- Upper-division lab\n- Remaining credits: 42\n## Notes\n- Student notes: none\n",
        )
        .unwrap();
        fs::write(root.join("inbox/courses/PHYS2210.md"), "").unwrap();
        fs::write(root.join("inbox/courses/colors.json"), "{}").unwrap();
        let s = snapshot_at(&root, TODAY);
        assert_eq!(s["mode"], "tier2_dated_audit");
        assert_eq!(s["audit"]["remaining_credits"], 42.0);
        assert_eq!(s["audit"]["complete_count"], 1);
        assert_eq!(s["audit"]["in_progress_count"], 1);
        // The credit total is not counted as an unmet block.
        assert_eq!(s["audit"]["unmet_count"], 1);
        assert_eq!(s["audit"]["unmet_items"][0], "Upper-division lab");
        assert_eq!(s["audit"]["stale_days"], 12);
        assert_eq!(s["program"], "Physics");
        assert_eq!(s["catalog_year"], "2025-2026");
        assert_eq!(s["courses"], json!(["PHYS 2210"]));
        let qs = s["questions"].to_string();
        assert!(qs.contains("Upper-division lab"));
        assert!(qs.contains("Spring 2029 still realistic with 42 credits"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn marks_an_old_audit_stale() {
        let root = root("stale");
        fs::write(root.join("inbox/degree-audit.md"), "---\nimported_on: 2020-01-01\ncatalog_year: \"2020-2021\"\n---\n## Unmet\n- Remaining credits: 42\n").unwrap();
        let s = snapshot_at(&root, TODAY);
        assert_eq!(s["mode"], "stale_audit");
        assert!(s["questions"][0].as_str().unwrap().contains("2020-01-01"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn untouched_templates_are_not_answers() {
        let root = root("template");
        let template = include_str!("../../../templates/inbox/degree-audit.md");
        fs::write(root.join("inbox/degree-audit.md"), template).unwrap();
        fs::write(
            root.join("USER.md"),
            "- **Declared major(s):** (fill during onboarding)\n- **Catalog year:** (student-stated)\n- **Target grad term:** (e.g. Spring 2028)\n",
        )
        .unwrap();
        let s = snapshot_at(&root, TODAY);
        assert_eq!(s["mode"], "planning");
        assert_eq!(s["audit"]["present"], false);
        assert_eq!(s["audit"]["remaining_credits"], Value::Null);
        assert_eq!(s["program"], "");
        assert_eq!(s["target_grad_term"], "");
        assert_eq!(s["catalog_year"], "");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn undated_or_future_imports_are_never_current() {
        for date in ["", "2027-01-01", "13/45/2026"] {
            let root = root("undated");
            fs::write(
                root.join("inbox/degree-audit.md"),
                format!("---\nimported_on: {date}\n---\nStill needed:\n- Senior design\n"),
            )
            .unwrap();
            let s = snapshot_at(&root, TODAY);
            assert_eq!(s["mode"], "stale_audit", "{date}");
            assert_eq!(s["audit"]["dated"], false);
            assert_eq!(s["audit"]["imported_on"], Value::Null);
            assert_eq!(s["audit"]["unmet_items"][0], "Senior design");
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn credit_phrases_match_the_python_parser() {
        assert_eq!(remaining_credits("Remaining credits needed: 96"), Some(96.0));
        assert_eq!(remaining_credits("credits still needed = 12.5"), Some(12.5));
        assert_eq!(remaining_credits("Hours needed 30"), Some(30.0));
        assert_eq!(remaining_credits("Remaining credits needed: (optional — e.g. `Remaining credits: 42`)"), None);
        assert_eq!(parse_date("09/28/2026"), Some((2026, 9, 28)));
        assert_eq!(parse_date("2026/09/28"), Some((2026, 9, 28)));
    }
}
