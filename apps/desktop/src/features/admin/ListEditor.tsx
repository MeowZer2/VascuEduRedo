interface ListEditorProps {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Use a textarea per row when entries can be multi-line (e.g. teaching points). */
  multiline?: boolean;
  addLabel?: string;
}

/**
 * Small string-array editor used for objectives / teaching points / references / tags.
 * Keeps the JSX in AdminContentPage compact.
 */
export function ListEditor({
  values,
  onChange,
  placeholder,
  multiline,
  addLabel = '+ Add',
}: ListEditorProps) {
  function setItem(idx: number, value: string) {
    onChange(values.map((v, i) => (i === idx ? value : v)));
  }
  function removeItem(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }
  return (
    <div className="admin-keyword-list">
      {values.map((value, idx) => (
        <div key={idx} className="admin-choice-row">
          {multiline ? (
            <textarea
              className="text-input textarea"
              value={value}
              onChange={(e) => setItem(idx, e.target.value)}
              placeholder={placeholder}
            />
          ) : (
            <input
              className="text-input"
              value={value}
              onChange={(e) => setItem(idx, e.target.value)}
              placeholder={placeholder}
            />
          )}
          <button
            type="button"
            className="secondary-button small"
            onClick={() => removeItem(idx)}
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-button small"
        onClick={() => onChange([...values, ''])}
      >
        {addLabel}
      </button>
    </div>
  );
}
