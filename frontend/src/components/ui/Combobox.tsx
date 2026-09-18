import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useTranslation } from "react-i18next";
import { cx } from "./cx";
import { useFieldControl, useFieldLabelId } from "./Field";
import { Spinner } from "./Spinner";
import "./Field.css";
import "./Combobox.css";

export interface ComboboxProps<T> {
  /** aria-label; required when not inside a Field. */
  label?: string;
  inputValue: string;
  /** The page debounces (useDebouncedValue) and fetches. */
  onInputChange: (value: string) => void;
  /** The page caps the list (e.g. the first 50 matches). */
  options: readonly T[];
  getKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  onSelect: (option: T) => void;
  loading?: boolean;
  /** Shown when the query is non-empty and there are no options. Default t('ui.noResults'). */
  emptyText?: string;
  placeholder?: string;
  mono?: boolean;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Goes on the outermost rendered element, like every kit control: here the wrapper <div>. */
  className?: string;
  /**
   * Ref to the combobox <input> (a prop, because forwardRef would drop the
   * option generic): lets a page focus the first invalid control.
   */
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * WAI-ARIA combobox with a listbox popup (list autocomplete, manual
 * selection). The popup renders in normal flow under the input, so modals
 * and table cells never clip it.
 *
 * Escape while the list is open is caught on window in the capture phase and
 * stopped there, so an enclosing Modal (whose own Escape listener sits on
 * document) stays open.
 */
export function Combobox<T>({
  label,
  inputValue,
  onInputChange,
  options,
  getKey,
  renderOption,
  onSelect,
  loading = false,
  emptyText,
  placeholder,
  mono = false,
  size = "md",
  disabled = false,
  className,
  inputRef: externalInputRef,
}: ComboboxProps<T>) {
  const { t } = useTranslation();
  const a11y = useFieldControl({ "aria-label": label }, "Combobox");
  const fieldLabelId = useFieldLabelId();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(externalInputRef, () => inputRef.current as HTMLInputElement);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const hasQuery = inputValue.trim() !== "";
  const statusText = loading
    ? t("common.loading")
    : hasQuery && options.length === 0
      ? emptyText ?? t("ui.noResults")
      : "";
  const showPopup = open && !disabled && (options.length > 0 || statusText !== "");
  const activeIndex = active < options.length ? active : -1;

  // Escape closes the list first, before any dialog hears it.
  useEffect(() => {
    if (!showPopup) return;
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [showPopup]);

  useEffect(() => {
    if (showPopup && activeIndex >= 0) {
      document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    }
    // optionId is derived from a stable useId value.
  }, [showPopup, activeIndex]);

  function choose(index: number) {
    const option = options[index];
    if (option === undefined) return;
    onSelect(option);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) setOpen(true);
        else if (options.length > 0) setActive(i => (i + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) setOpen(true);
        else if (options.length > 0) setActive(i => (i <= 0 ? options.length - 1 : i - 1));
        break;
      case "Enter":
        if (showPopup && activeIndex >= 0) {
          event.preventDefault();
          choose(activeIndex);
        }
        break;
      case "Tab":
        setOpen(false);
        setActive(-1);
        break;
    }
  }

  return (
    <div className={cx("ui-combobox", className)}>
      <input
        {...a11y}
        ref={inputRef}
        type="text"
        role="combobox"
        className={cx("ui-control", size === "sm" && "ui-control--sm", mono && "ui-control--mono")}
        aria-label={label}
        aria-expanded={showPopup}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPopup && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={inputValue}
        placeholder={placeholder}
        disabled={disabled}
        onChange={event => {
          onInputChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
      />
      {/* Persistent live region: loading / no results are announced. */}
      <span className="u-sr-only" role="status">
        {showPopup ? statusText : ""}
      </span>
      <div
        className="ui-combobox__popup"
        hidden={!showPopup}
        // Keep focus in the input while clicking an option.
        onMouseDown={event => event.preventDefault()}
      >
        <ul
          className="ui-combobox__list"
          role="listbox"
          id={listId}
          aria-label={label}
          aria-labelledby={label === undefined ? fieldLabelId : undefined}
        >
          {options.map((option, index) => (
            <li
              key={getKey(option)}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className="ui-combobox__option"
              onClick={() => choose(index)}
              onMouseMove={() => {
                if (index !== activeIndex) setActive(index);
              }}
            >
              {renderOption(option)}
            </li>
          ))}
        </ul>
        {statusText !== "" && (
          <div className="ui-combobox__status" aria-hidden="true">
            {loading && <Spinner />}
            {statusText}
          </div>
        )}
      </div>
    </div>
  );
}
