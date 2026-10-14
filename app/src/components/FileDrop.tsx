import { useEffect, useRef, useState } from "react";
import { library } from "../study/api";

/*
 * Drop files anywhere (MASTER §10 navigation). On a course page they land in
 * that course; anywhere else Kairos sorts them. One sentence says where they went.
 */
export function FileDrop({
  courseId,
  courseLabel,
  onAdded,
}: {
  courseId?: string;
  courseLabel?: string;
  onAdded: (message: string) => void;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const target = useRef({ courseId, courseLabel });
  target.current = { courseId, courseLabel };

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // The upload page's own drop zone handles its drops.
      if ((e.target as HTMLElement | null)?.closest?.(".upload-dropzone")) {
        depth.current = 0;
        setOver(false);
        return;
      }
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const { courseId: cid, courseLabel: label } = target.current;
      try {
        const result = await library.add(files);
        if (cid) {
          for (const added of result.added) {
            if (added.course_id !== cid) await library.update(added.id, { course_id: cid }).catch(() => undefined);
          }
        }
        const n = result.added.length;
        const where = cid && label ? ` to ${label}` : "";
        onAdded(
          n
            ? `Added ${n} file${n === 1 ? "" : "s"}${where}.${result.duplicates.length ? ` ${result.duplicates.length} were already there.` : ""}`
            : result.errors[0]
              ? `${result.errors[0].name}: ${result.errors[0].message}`
              : "Those files were already in your library."
        );
      } catch {
        onAdded("Those files didn't save. Try again.");
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [onAdded]);

  if (!over) return null;
  return (
    <div className="file-drop" aria-hidden="true">
      <p className="file-drop-card sheet">{courseLabel ? `Drop to add to ${courseLabel}` : "Drop to add to your files. Kairos sorts them by course."}</p>
    </div>
  );
}
