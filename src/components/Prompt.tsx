import { useEffect, useRef, useState } from 'react';

// In-app text box. The desktop app (Electron) has no window.prompt, so every text question goes through here.
type Req = { message: string; value: string; resolve: (v: string | null) => void; choices?: { label: string; danger?: boolean }[] };
let push: ((r: Req) => void) | null = null;

export function askText(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!push) throw new Error('PromptHost is not mounted');
    push({ message, value, resolve });
  });
}

/** A question with buttons. Resolves to the chosen index, or null for Cancel. */
export function askChoice(message: string, choices: { label: string; danger?: boolean }[]): Promise<number | null> {
  return new Promise((resolve) => {
    if (!push) throw new Error('PromptHost is not mounted');
    push({ message, value: '', choices, resolve: (v) => resolve(v === null ? null : Number(v)) });
  });
}

export function PromptHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [val, setVal] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { push = (r) => { setReq(r); setVal(r.value); }; return () => { push = null; }; }, []);
  useEffect(() => { if (req) setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0); }, [req]);
  if (!req) return null;
  const done = (v: string | null) => { req.resolve(v); setReq(null); };
  if (req.choices) {
    return (
      <div className="modal-back" onClick={() => done(null)}>
        <div className="modal prompt" onClick={(e) => e.stopPropagation()}>
          <p>{req.message}</p>
          <div className="choice-col">
            {req.choices.map((c, i) => <button key={i} className={c.danger ? 'danger' : ''} onClick={() => done(String(i))}>{c.label}</button>)}
            <button onClick={() => done(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="modal-back" onClick={() => done(null)}>
      <div className="modal prompt" onClick={(e) => e.stopPropagation()}>
        <label>{req.message}
          <input ref={input} value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') done(val); if (e.key === 'Escape') done(null); }} />
        </label>
        <div className="row"><button onClick={() => done(val)}>OK</button><button onClick={() => done(null)}>Cancel</button></div>
      </div>
    </div>
  );
}
