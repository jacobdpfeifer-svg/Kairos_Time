// Launch switches for the landing site. This is the one file to edit when a piece
// of the funnel goes live; every page reads it and nothing else needs to change.
// Leave a value as null until the thing it points at really exists.
window.KAIROS_CONFIG = {
  // Versioned, notarized .dmg URL. While null, the download buttons stay disabled
  // and say so; once set, the main page's access section and /go turn on.
  downloadUrl: null,
  // Shown under the download button, e.g. "Version 0.1.0, macOS 12 or later".
  downloadNote: "macOS 12 or later",

  // Where early-access and "tell me when Windows is ready" requests go. There is
  // no backend yet, so this is a mailto address and the copy says nothing was
  // saved. Swap in a form endpoint later (see landing/README.md).
  contactEmail: "jacobdpfeifer@gmail.com",

  // Public source repository. The landing page links here directly.
  sourceUrl: "https://github.com/jacobdpfeifer-svg/Kairos_Time",
};
