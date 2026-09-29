import type { ComponentType, ReactNode } from "react";

/**
 * The navigation glyphs of Dental CRM: drawn for this app (square caps,
 * mitred corners, one stroke weight) instead of a stock icon set.
 */
export type NavGlyph = ComponentType<{ className?: string }>;

const glyph = (children: ReactNode): NavGlyph => {
  const Glyph = ({ className }: { className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
  return Glyph;
};

/** Рабочий стол: panels of different sizes */
export const DashboardGlyph = glyph(
  <>
    <rect x="3.5" y="3.5" width="7" height="8" />
    <rect x="13.5" y="3.5" width="7" height="4.5" />
    <rect x="13.5" y="11" width="7" height="9.5" />
    <rect x="3.5" y="14.5" width="7" height="6" />
  </>,
);

/** Сделки: columns of a board, shorter as deals move on */
export const DealsGlyph = glyph(
  <>
    <rect x="3.5" y="3.5" width="4.5" height="17" />
    <rect x="9.75" y="3.5" width="4.5" height="12" />
    <rect x="16" y="3.5" width="4.5" height="7" />
  </>,
);

/** Входящие: a message with its tail */
export const InboxGlyph = glyph(
  <>
    <path d="M3.5 4.5h17v12H11l-5 4v-4H3.5z" />
    <path d="M7.5 9h9M7.5 12.5h5" />
  </>,
);

/** Задачи: a ticked box and two lines */
export const TasksGlyph = glyph(
  <>
    <rect x="3.5" y="4.5" width="6" height="6" />
    <path d="M5.2 7.6l1.4 1.4 2.4-2.8" />
    <rect x="3.5" y="13.5" width="6" height="6" />
    <path d="M13 7.5h7.5M13 16.5h7.5" />
  </>,
);

/** Расписание: a sheet with hour rows and a booked block */
export const ScheduleGlyph = glyph(
  <>
    <rect x="3.5" y="4.5" width="17" height="16" />
    <path d="M3.5 9h17M8 2.5v4M16 2.5v4" />
    <rect x="7" y="12" width="5" height="5" />
  </>,
);

/** Пациенты: a person */
export const PatientsGlyph = glyph(
  <>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20.5c1-4 4-6 7.5-6s6.5 2 7.5 6" />
  </>,
);

/** Отчёты: axes and rising bars */
export const ReportsGlyph = glyph(
  <>
    <path d="M3.5 3.5v17h17" />
    <path d="M8 16.5v-4M12.5 16.5V8.5M17 16.5v-7" />
  </>,
);

/** Прайс: a price tag with its hole and two lines of a price list */
export const PriceListGlyph = glyph(
  <>
    <path d="M3.5 12.5V3.5h9l8 8-9 9z" />
    <circle cx="8" cy="8" r="1.25" />
    <path d="M11 13l2.5 2.5M13 11l2.5 2.5" />
  </>,
);

/** Рассылки: an envelope */
export const MailingsGlyph = glyph(
  <>
    <rect x="3.5" y="5.5" width="17" height="13" />
    <path d="M3.5 6l8.5 6.5L20.5 6" />
  </>,
);

/** Интеграции: a plug */
export const IntegrationsGlyph = glyph(
  <>
    <path d="M9 3v5M15 3v5" />
    <path d="M6 8h12v3.5a6 6 0 0 1-12 0z" />
    <path d="M12 17.5v3.5" />
  </>,
);

/** Сотрудники: two people */
export const TeamGlyph = glyph(
  <>
    <circle cx="9" cy="8.5" r="3.25" />
    <path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5" />
    <path d="M15 5.5a3.25 3.25 0 0 1 0 6.3M17.5 14.9c1.6.7 2.8 2.2 3.3 4.6" />
  </>,
);

/** Настройки: sliders */
export const SettingsGlyph = glyph(
  <>
    <path d="M3.5 7h9M18.5 7h2M3.5 17h2M11.5 17h9" />
    <rect x="12.5" y="4.5" width="5" height="5" />
    <rect x="5.5" y="14.5" width="5" height="5" />
  </>,
);

/** Касса: a cash drawer with a receipt coming out */
export const CashGlyph = glyph(
  <>
    <path d="M7.5 9V3.5h9V9" />
    <path d="M10 6h4" />
    <rect x="3.5" y="9" width="17" height="11.5" />
    <path d="M3.5 14.5h17M10.5 17.5h3" />
  </>,
);

/** Зарплаты: a pay envelope with a coin */
export const PayrollGlyph = glyph(
  <>
    <path d="M20.5 12V6.5h-17v12h9" />
    <path d="M3.5 6.5l8.5 6 8.5-6" />
    <circle cx="17.5" cy="17.5" r="3.25" />
    <path d="M17.5 16.1v2.8" />
  </>,
);

/** Лист ожидания: a list and a clock */
export const WaitingListGlyph = glyph(
  <>
    <path d="M3.5 5.5h9M3.5 10h6.5M3.5 14.5h4.5" />
    <circle cx="16" cy="15.5" r="5" />
    <path d="M16 12.75v2.75l1.9 1.4" />
  </>,
);
