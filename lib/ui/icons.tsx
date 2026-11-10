import type { ReactElement, ReactNode } from "react";

type IconProps = {
  /** Edge length in pixels. */
  size?: number;
};

// Line icons drawn here, so that the components do not need an icon package. Decorative:
// the text beside them says what they mean.
const icon =
  (shape: ReactNode) =>
  ({ size = 16 }: IconProps): ReactElement => (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shape}
    </svg>
  );

/** A key: the license. */
const KeyIcon = icon(
  <path d="M10.25 9.75a3.5 3.5 0 1 0-3.4-2.7L2.25 11.65v2.1h2.1l.9-.9v-1.1h1.1l1.1-1.1v-1.1h1.1l.3-.3c.45.33.9.5 1.4.5Zm1-4.25v.01" />
);

/** Two screens: another device. */
const DevicesIcon = icon(
  <path d="M1.75 3.25h9.5v6.5h-9.5zm3 9.5h3.5M6.5 9.75v3M12.75 6.25h1.5v7.5h-3v-1.5" />
);

/** A crossed cloud: no connection, or no answer. */
const OfflineIcon = icon(
  <path d="M4.5 12.75h7.25a2.75 2.75 0 0 0 .5-5.45A4.25 4.25 0 0 0 4.3 6.1 3.35 3.35 0 0 0 4.5 12.75ZM2.25 2.25l11.5 11.5" />
);

/** A clock: the trial's time, or a wrong clock. */
const ClockIcon = icon(
  <path d="M8 14.25A6.25 6.25 0 1 0 8 1.75a6.25 6.25 0 0 0 0 12.5ZM8 4.75V8l2.25 1.5" />
);

/** An arrow leaving a box: opens in the browser. */
const ExternalIcon = icon(
  <path d="M9.25 2.75h4v4m0-4-6 6M11.75 9.5v3.75h-9v-9H6.5" />
);

/** A check mark. */
const CheckIcon = icon(<path d="m3.25 8.5 3 3 6.5-7" />);

export {
  CheckIcon,
  ClockIcon,
  DevicesIcon,
  ExternalIcon,
  KeyIcon,
  OfflineIcon,
};
