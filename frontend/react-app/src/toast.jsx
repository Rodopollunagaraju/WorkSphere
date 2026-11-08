import { useEffect, useState } from 'react';
export const toast = (message, kind = 'info') => window.dispatchEvent(new CustomEvent('ws:toast', { detail: { message, kind, id: Math.random() } }));
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => { setItems((x) => [...x, e.detail]); setTimeout(() => setItems((x) => x.filter((i) => i.id !== e.detail.id)), 4000); };
    window.addEventListener('ws:toast', on); return () => window.removeEventListener('ws:toast', on);
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2" role="status">
      {items.map((t) => <div key={t.id} className={`rounded-md px-4 py-2 text-sm text-white shadow ${t.kind === 'error' ? 'bg-red-600' : 'bg-slate-800'}`}>{t.message}</div>)}
    </div>
  );
}
