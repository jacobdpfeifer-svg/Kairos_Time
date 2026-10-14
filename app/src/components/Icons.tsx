/** Thin-stroke icons — never emoji / lone unicode. */

type IconProps = { className?: string; title?: string };

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

export function IconStop(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

export function IconStudy(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 19V6a2 2 0 0 1 2-2h7" />
      <path d="M8 6h10v13H8z" />
      <path d="M11 10h4M11 14h3" />
    </svg>
  );
}

export function IconPlan(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M5 7h2M10 7h9" />
      <path d="M5 12h2M10 12h9" />
      <path d="M5 17h2M10 17h6" />
    </svg>
  );
}

export function IconSources(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M8 4h10v16H8z" />
      <path d="M6 7H4v13h10" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M4.9 6.5l1.5 1.5M17.6 16l1.5 1.5M3 12h2M19 12h2M4.9 17.5l1.5-1.5M17.6 8l1.5-1.5" />
    </svg>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M5 14v5h14v-5" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M8 5v14M16 5v14" />
    </svg>
  );
}

export function IconLearn(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M4 19V7l8-3 8 3v12" />
      <path d="M12 4v15" />
    </svg>
  );
}

export function IconPractice(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M12 20V4" />
      <path d="M6 10l6-6 6 6" />
    </svg>
  );
}

export function IconQuiz(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7V14" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** Home: the semester line — a rule with ticks and a today marker. */
export function IconHome(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <path d="M3 16h18" />
      <path d="M7 16v-4M12 16v-7M17 16v-3" />
      <path d="M10 5v14" strokeDasharray="1.5 2" />
    </svg>
  );
}

/** Calendar: month grid with one marked day. */
export function IconCalendar(props: IconProps) {
  return (
    <svg {...base} className={props.className}>
      {props.title ? <title>{props.title}</title> : null}
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
      <path d="M9 14h2v2H9z" fill="currentColor" stroke="none" />
    </svg>
  );
}
