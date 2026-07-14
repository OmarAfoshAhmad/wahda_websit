"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock3 } from "lucide-react";
import { cn } from "@/components/ui";

function normalizeDateText(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeDateTimeText(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 12);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length <= 10) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)} ${digits.slice(8)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)} ${digits.slice(8, 10)}:${digits.slice(10)}`;
}

function formatDateDisplay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function parseDateDisplay(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return null;
  const [dayText, monthText, yearText] = value.split("/");
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isValid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isValid) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

function formatDateTimeDisplay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const [date, time] = value.split("T");
  return `${formatDateDisplay(date)} ${time}`;
}

function parseDateTimeDisplay(value: string) {
  if (!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(value)) return null;
  const [datePart, timePart] = value.split(" ");
  const isoDate = parseDateDisplay(datePart);
  if (!isoDate) return null;
  const [hoursText, minutesText] = timePart.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${isoDate}T${hoursText}:${minutesText}`;
}

type CommonProps = {
  className?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  name?: string;
  required?: boolean;
};

type DateInputProps = CommonProps & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};

export function DateInput({
  className,
  defaultValue = "",
  disabled,
  max,
  min,
  name,
  onChange,
  required,
  value,
}: DateInputProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(value ?? defaultValue);
  const nativePickerRef = useRef<HTMLInputElement>(null);

  const isoValue = isControlled ? value ?? "" : internalValue;
  const [textValue, setTextValue] = useState(() => formatDateDisplay(isoValue));

  useEffect(() => {
    setTextValue(formatDateDisplay(isoValue));
  }, [isoValue]);

  const commit = (nextValue: string) => {
    if (!isControlled) setInternalValue(nextValue);
    onChange?.(nextValue);
  };

  const handleTextChange = (raw: string) => {
    const normalized = normalizeDateText(raw);
    setTextValue(normalized);
    if (!normalized) {
      commit("");
      return;
    }
    const parsed = parseDateDisplay(normalized);
    if (parsed) commit(parsed);
  };

  const handleBlur = () => {
    if (!textValue.trim()) {
      setTextValue("");
      commit("");
      return;
    }
    const parsed = parseDateDisplay(textValue);
    setTextValue(parsed ? formatDateDisplay(parsed) : formatDateDisplay(isoValue));
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={textValue}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="dd/mm/yyyy"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        disabled={disabled}
        required={required}
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500",
          className,
        )}
      />
      <input type="hidden" name={name} value={isoValue} />
      <input
        ref={nativePickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        min={min}
        max={max}
        onChange={(e) => commit(e.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          nativePickerRef.current?.showPicker?.();
          nativePickerRef.current?.focus();
        }}
        disabled={disabled}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
        aria-label="اختيار التاريخ"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
    </div>
  );
}

type DateTimeInputProps = CommonProps & {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
};

export function DateTimeInput({
  className,
  defaultValue = "",
  disabled,
  max,
  min,
  name,
  onChange,
  required,
  value,
}: DateTimeInputProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(value ?? defaultValue);
  const nativePickerRef = useRef<HTMLInputElement>(null);

  const isoValue = isControlled ? value ?? "" : internalValue;
  const [textValue, setTextValue] = useState(() => formatDateTimeDisplay(isoValue));

  useEffect(() => {
    setTextValue(formatDateTimeDisplay(isoValue));
  }, [isoValue]);

  const commit = (nextValue: string) => {
    if (!isControlled) setInternalValue(nextValue);
    onChange?.(nextValue);
  };

  const handleTextChange = (raw: string) => {
    const normalized = normalizeDateTimeText(raw);
    setTextValue(normalized);
    if (!normalized) {
      commit("");
      return;
    }
    const parsed = parseDateTimeDisplay(normalized);
    if (parsed) commit(parsed);
  };

  const handleBlur = () => {
    if (!textValue.trim()) {
      setTextValue("");
      commit("");
      return;
    }
    const parsed = parseDateTimeDisplay(textValue);
    setTextValue(parsed ? formatDateTimeDisplay(parsed) : formatDateTimeDisplay(isoValue));
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={textValue}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="dd/mm/yyyy hh:mm"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        disabled={disabled}
        required={required}
        className={cn(
          "flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500",
          className,
        )}
      />
      <input type="hidden" name={name} value={isoValue} />
      <input
        ref={nativePickerRef}
        type="datetime-local"
        tabIndex={-1}
        aria-hidden="true"
        value={isoValue}
        min={min}
        max={max}
        onChange={(e) => commit(e.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          nativePickerRef.current?.showPicker?.();
          nativePickerRef.current?.focus();
        }}
        disabled={disabled}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
        aria-label="اختيار التاريخ والوقت"
      >
        <Clock3 className="h-4 w-4" />
      </button>
    </div>
  );
}
