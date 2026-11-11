import day from "../../../design-system/kairos/logo/kairos-wordmark.svg";
import night from "../../../design-system/kairos/logo/kairos-wordmark-night.svg";

/** The mark: a lowercase k with the highlighter across it. Night and high contrast use the light k. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `kairos-wordmark ${className}` : "kairos-wordmark"}>
      <img className="day" src={day} alt="kairos" />
      <img className="night" src={night} alt="kairos" />
    </span>
  );
}
