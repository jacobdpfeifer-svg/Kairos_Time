import day from "../../../design-system/kairos/logo/kairos-wordmark.svg";
import night from "../../../design-system/kairos/logo/kairos-wordmark-night.svg";

/** The name, with the highlighter behind "air". Night and high contrast use the light letters. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `kairos-wordmark ${className}` : "kairos-wordmark"}>
      <img className="day" src={day} alt="kairos" />
      <img className="night" src={night} alt="kairos" />
    </span>
  );
}
