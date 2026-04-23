import { useState } from 'react';

interface Props {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}

// A reliable replacement for window.prompt() that works inside iOS PWA
// standalone mode (where native prompt() is blocked).
export function InputPromptModal({
  title, label, initial = '', placeholder, confirmLabel = 'OK', onClose, onConfirm
}: Props) {
  const [val, setVal] = useState(initial);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onConfirm(val.trim());
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold">{title}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        <label className="block">
          {label && <div className="text-xs uppercase text-slate-400 mb-1">{label}</div>}
          <input
            autoFocus
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-3 text-lg"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-lg"
          >Cancel</button>
          <button
            type="submit"
            className="flex-1 bg-brand hover:bg-brand-dark text-white font-bold py-3 rounded-lg"
          >{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
