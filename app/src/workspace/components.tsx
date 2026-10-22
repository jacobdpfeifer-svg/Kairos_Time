import { AdvisorView } from "../views/AdvisorView";
import { CoursesView } from "../views/CoursesView";
import { StudyPathView } from "../views/StudyPathView";
import { TodayView } from "../views/TodayView";
import { WeekView } from "../views/WeekView";

/** One entry per catalog `component` string. The parity test keeps this aligned. */
export const WORKSPACE_COMPONENTS = {
  TodayView,
  WeekView,
  CoursesView,
  StudyPathView,
  AdvisorView,
};
