import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  { code: 'en', flag: '\u{1F1EC}\u{1F1E7}', name: 'English' },
  { code: 'uk', flag: '\u{1F1FA}\u{1F1E6}', name: 'Ukrainian' },
  { code: 'de', flag: '\u{1F1E9}\u{1F1EA}', name: 'German' },
  { code: 'fr', flag: '\u{1F1EB}\u{1F1F7}', name: 'French' },
  { code: 'es', flag: '\u{1F1EA}\u{1F1F8}', name: 'Spanish' },
  { code: 'pt', flag: '\u{1F1E7}\u{1F1F7}', name: 'Portuguese' },
  { code: 'it', flag: '\u{1F1EE}\u{1F1F9}', name: 'Italian' },
  { code: 'nl', flag: '\u{1F1F3}\u{1F1F1}', name: 'Dutch' },
  { code: 'pl', flag: '\u{1F1F5}\u{1F1F1}', name: 'Polish' },
  { code: 'cs', flag: '\u{1F1E8}\u{1F1FF}', name: 'Czech' },
  { code: 'ro', flag: '\u{1F1F7}\u{1F1F4}', name: 'Romanian' },
  { code: 'hu', flag: '\u{1F1ED}\u{1F1FA}', name: 'Hungarian' },
  { code: 'sv', flag: '\u{1F1F8}\u{1F1EA}', name: 'Swedish' },
  { code: 'no', flag: '\u{1F1F3}\u{1F1F4}', name: 'Norwegian' },
  { code: 'da', flag: '\u{1F1E9}\u{1F1F0}', name: 'Danish' },
  { code: 'fi', flag: '\u{1F1EB}\u{1F1EE}', name: 'Finnish' },
  { code: 'ja', flag: '\u{1F1EF}\u{1F1F5}', name: 'Japanese' },
  { code: 'ko', flag: '\u{1F1F0}\u{1F1F7}', name: 'Korean' },
  { code: 'zh', flag: '\u{1F1E8}\u{1F1F3}', name: 'Chinese' },
  { code: 'ar', flag: '\u{1F1F8}\u{1F1E6}', name: 'Arabic' },
  { code: 'hi', flag: '\u{1F1EE}\u{1F1F3}', name: 'Hindi' },
  { code: 'tr', flag: '\u{1F1F9}\u{1F1F7}', name: 'Turkish' },
  { code: 'he', flag: '\u{1F1EE}\u{1F1F1}', name: 'Hebrew' },
  { code: 'th', flag: '\u{1F1F9}\u{1F1ED}', name: 'Thai' },
  { code: 'vi', flag: '\u{1F1FB}\u{1F1F3}', name: 'Vietnamese' },
  { code: 'id', flag: '\u{1F1EE}\u{1F1E9}', name: 'Indonesian' },
  { code: 'el', flag: '\u{1F1EC}\u{1F1F7}', name: 'Greek' },
  { code: 'bg', flag: '\u{1F1E7}\u{1F1EC}', name: 'Bulgarian' },
  { code: 'hr', flag: '\u{1F1ED}\u{1F1F7}', name: 'Croatian' },
  { code: 'sk', flag: '\u{1F1F8}\u{1F1F0}', name: 'Slovak' },
  { code: 'lt', flag: '\u{1F1F1}\u{1F1F9}', name: 'Lithuanian' },
  { code: 'lv', flag: '\u{1F1F1}\u{1F1FB}', name: 'Latvian' },
  { code: 'et', flag: '\u{1F1EA}\u{1F1EA}', name: 'Estonian' },
];

export function LanguageSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = LANGUAGES.find((l) => l.code === value);

  const filtered = search
    ? LANGUAGES.filter((l) =>
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.code.toLowerCase().includes(search.toLowerCase()),
      )
    : LANGUAGES;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="beast-input flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="text-[18px]">{selected?.flag ?? ''}</span>
        <span className="text-sm">{selected?.name ?? value}</span>
        <svg className="ml-auto h-4 w-4 text-th-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full border border-th-border bg-th-card shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-th-border-subtle">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="beast-input beast-input-sm"
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  onChange(lang.code);
                  setOpen(false);
                  setSearch('');
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                  lang.code === value
                    ? 'bg-beast-red/10 text-beast-red-light'
                    : 'text-th-text-secondary hover:bg-th-hover',
                )}
              >
                <span className="text-[16px]">{lang.flag}</span>
                {lang.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-th-text-muted text-center">No languages found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
