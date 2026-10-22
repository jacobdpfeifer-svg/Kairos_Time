// Purpose: mount the accepted workspace spec as the screens that already exist
import { Fragment, useEffect, useMemo } from "react";
import type { ToastState } from "../components/Toast";
import type { SemesterTick } from "../ipc";
import type { AskEnvelope } from "../study/types";
import { WORKSPACE_COMPONENTS } from "./components";
import {
  DEFAULT_SPEC,
  FALLBACK_NOTICE,
  SURFACES,
  WORKSPACE_CAPABILITIES,
  validateWorkspaceSpec,
  type Surface,
  type WorkspaceSpec,
} from "./contracts";
import { predicateHolds, type PredicateSnapshot } from "./predicates";

export type WorkspaceHost = {
  lastAsk: AskEnvelope | null;
  openItem: { courseId?: string; itemId: string } | null;
  onStudyToday: (target: { id: string } | null) => void;
  onAsk: (initial?: AskEnvelope | null) => void;
  onOpenWeek: () => void;
  onToast: (toast: ToastState) => void;
  onStudyTick: (tick: SemesterTick) => void;
  examId?: string;
  practice?: boolean;
  onOpenExam: (examId: string) => void;
  onPractice: (examId?: string) => void;
  onBack: () => void;
  onGoToSources: (examId?: string) => void;
  onOpenCourse: (courseId: string) => void;
  courseId?: string;
  filesVersion: number;
};

function renderBlock(component: string, host: WorkspaceHost) {
  switch (component) {
    case "TodayView":
      return (
        <WORKSPACE_COMPONENTS.TodayView
          lastAsk={host.lastAsk}
          openItem={host.openItem}
          onStudy={host.onStudyToday}
          onAsk={host.onAsk}
          onOpenWeek={host.onOpenWeek}
        />
      );
    case "WeekView":
      return <WORKSPACE_COMPONENTS.WeekView onToast={host.onToast} onStudy={host.onStudyTick} />;
    case "CoursesView":
      return (
        <WORKSPACE_COMPONENTS.CoursesView
          courseId={host.courseId}
          filesVersion={host.filesVersion}
          onOpenCourse={host.onOpenCourse}
          onBack={host.onBack}
          onStudy={host.onStudyTick}
        />
      );
    case "StudyPathView":
      return (
        <WORKSPACE_COMPONENTS.StudyPathView
          examId={host.examId}
          practice={host.practice}
          onOpenExam={host.onOpenExam}
          onPractice={host.onPractice}
          onBack={host.onBack}
          onGoToSources={host.onGoToSources}
          onOpenCourse={host.onOpenCourse}
        />
      );
    case "AdvisorView":
      return <WORKSPACE_COMPONENTS.AdvisorView />;
    default:
      return null;
  }
}

function specToRender(candidate: WorkspaceSpec): { spec: WorkspaceSpec; invalid: boolean } {
  const checked = validateWorkspaceSpec(candidate, { capabilities: WORKSPACE_CAPABILITIES });
  if (!checked.ok || !checked.spec) return { spec: DEFAULT_SPEC, invalid: true };
  for (const surface of SURFACES) {
    for (const id of checked.spec.surfaces[surface]?.slots ?? []) {
      const capability = WORKSPACE_CAPABILITIES.find((item) => item.id === checked.spec?.blocks[id]?.capability);
      if (!capability || !(capability.component in WORKSPACE_COMPONENTS)) return { spec: DEFAULT_SPEC, invalid: true };
    }
  }
  return { spec: checked.spec, invalid: false };
}

export function WorkspaceRenderer({
  surface,
  spec,
  snapshot,
  host,
  onInvalid,
}: {
  surface: Surface;
  spec: WorkspaceSpec;
  snapshot?: PredicateSnapshot;
  host: WorkspaceHost;
  onInvalid?: (notice: string) => void;
}) {
  const resolved = useMemo(() => specToRender(spec), [spec]);
  useEffect(() => {
    if (resolved.invalid) onInvalid?.(FALLBACK_NOTICE);
  }, [resolved.invalid, onInvalid]);

  const slots = resolved.spec.surfaces[surface]?.slots ?? [];
  const pieces = slots.flatMap((id) => {
    const block = resolved.spec.blocks[id];
    if (!block || !predicateHolds(block.visible_when, snapshot)) return [];
    const capability = WORKSPACE_CAPABILITIES.find((item) => item.id === block.capability);
    const node = capability ? renderBlock(capability.component, host) : null;
    return node ? [{ id, node }] : [];
  });
  // A visible block with no component means the spec is not the one we validated.
  // Render the default screen for this tab rather than a mix of blocks.
  if (pieces.length !== slots.filter((id) => predicateHolds(resolved.spec.blocks[id]?.visible_when, snapshot)).length) {
    const fallback = DEFAULT_SPEC.surfaces[surface]?.slots ?? [];
    return (
      <>
        {fallback.map((id) => {
          const capability = WORKSPACE_CAPABILITIES.find((item) => item.id === DEFAULT_SPEC.blocks[id].capability);
          const node = capability ? renderBlock(capability.component, host) : null;
          return node ? <Fragment key={id}>{node}</Fragment> : null;
        })}
      </>
    );
  }
  return (
    <>
      {pieces.map(({ id, node }) => (
        <Fragment key={id}>{node}</Fragment>
      ))}
    </>
  );
}
