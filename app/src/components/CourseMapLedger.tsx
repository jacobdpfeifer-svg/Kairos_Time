import { openExternalUrl, type CourseMap, type GradeTruth } from "../ipc";

/** Start here / Learn / Do / Check for one course, plus the grade-truth sentence. */
export function CourseMapLedger({ map, grades, limit = 12 }: { map: CourseMap; grades: GradeTruth | null; limit?: number }) {
  const lead = grades?.lead;
  const startHere = map.start_here || [];
  const learn = map.learn || [];
  const doRows = (map.do || []).slice(0, limit);
  if (startHere.length + learn.length + doRows.length === 0 && !lead && !map.fallback_reason) return null;
  return (
    <div className="course-map ledger">
      {map.fallback_reason && <p className="muted">{map.fallback_reason}</p>}
      {startHere.length > 0 && (
        <section aria-labelledby="map-start">
          <h3 id="map-start" className="index-label">
            Start here
          </h3>
          <ul>
            {startHere.map((row) => (
              <li key={row.title}>
                {row.html_url ? (
                  <button type="button" className="link" onClick={() => void openExternalUrl(row.html_url as string)}>
                    {row.title}
                  </button>
                ) : (
                  row.title
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {learn.length > 0 && (
        <section aria-labelledby="map-learn">
          <h3 id="map-learn" className="index-label">
            Learn
          </h3>
          <ul>
            {learn.map((row) => (
              <li key={row.id}>
                {row.title}
                {row.lti && <span className="muted">, opens in the browser</span>}
                {row.locked && <span className="muted">, locked</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {doRows.length > 0 && (
        <section aria-labelledby="map-do">
          <h3 id="map-do" className="index-label">
            Do
          </h3>
          <ul>
            {doRows.map((row) => (
              <li key={row.id}>
                {row.title}
                <span className="muted">, {row.submission_state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lead && (
        <section aria-labelledby="map-check">
          <h3 id="map-check" className="index-label">
            Check
          </h3>
          <p>
            Canvas says {lead.canvas_says ?? "nothing yet"}
            {lead.canvas_letter ? ` (${lead.canvas_letter})` : ""}; if the {lead.unsubmitted_due_count ?? 0} unsubmitted
            items count as zero, your estimate is {lead.risk ?? "not available"}. {lead.why}
          </p>
        </section>
      )}
    </div>
  );
}
