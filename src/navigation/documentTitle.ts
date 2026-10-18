import type { DocumentTitleOptions } from '@react-navigation/native';

// The window title on the desktop app (Mac and Windows) and the browser tab on
// web. React Navigation's default formatter is `options?.title ?? route?.name`,
// which printed "undefined" on the mode-select screen (rendered outside any
// navigator, so there is no route) and raw route names such as
// "AdminDashboard" everywhere else. Found by the Windows smoke test, 2026-10-18.
export const APP_TITLE = 'Sign2Site';

export const formatDocumentTitle: NonNullable<DocumentTitleOptions['formatter']> = (options) =>
  options?.title ? `${options.title} – ${APP_TITLE}` : APP_TITLE;
