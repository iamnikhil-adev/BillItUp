import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { subscribeToBills } from '../utils/db';
import type { BillRecord } from '../utils/db';
import { getDaybookSessionDate, setDaybookSessionDate, clearDashboardSession } from '../utils/session';

export default function Daybook({ direction }: { direction: number }) {
  const navigate = useNavigate();
  const dateInputRef = useRef<HTMLInputElement>(null);
  
  // State for the selected date (YYYY/MM/DD)
  const now = new Date();
  const todayStr = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;
  
  // Initialize from session if exists, otherwise today
  const [selectedDate, setSelectedDate] = useState(getDaybookSessionDate() || todayStr);
  const [bills, setBills] = useState<BillRecord[]>([]);

  // Derived display date
  const displayDate = new Date(selectedDate).toLocaleDateString('en-IN', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric' 
  });

  useEffect(() => {
    const unsubscribe = subscribeToBills((records) => {
      const filtered = records
        .filter(b => b.dateString === selectedDate)
        .sort((a, b) => b.timestamp - a.timestamp);
      setBills(filtered);
    });
    return () => unsubscribe();
  }, [selectedDate]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value; // YYYY-MM-DD
    if (!val) return;
    const formatted = val.split('-').join('/');
    setSelectedDate(formatted);
    setDaybookSessionDate(formatted); // Save to session
  };

  const handleBackToDashboard = () => {
    setDaybookSessionDate(null); // Clear session so it resets to today next time
    clearDashboardSession(); // Reset dashboard filters to 'All Files'
    navigate('/');
  };

  const openPicker = () => {
    if (dateInputRef.current) {
      try {
        dateInputRef.current.showPicker();
      } catch {
        dateInputRef.current.click();
      }
    }
  };

  const variants = {
    initial: (dir: number) => ({ opacity: 0, x: dir > 0 ? 25 : dir < 0 ? -25 : 0, filter: 'blur(8px)' }),
    animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -20 : dir < 0 ? 20 : 0, filter: 'blur(6px)' })
  };

  return (
    <motion.div
      custom={direction}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
      className="bg-surface min-h-screen flex flex-col relative pb-24 font-body motion-root"
    >
      <header className="flex justify-between items-center w-full px-6 pt-10 pb-4 bg-surface-container-low flat z-40 sticky top-0 border-b border-outline-variant/10">
        <div className="flex items-center gap-4">
          <button onClick={handleBackToDashboard} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors active:scale-90">
            <span className="material-symbols-outlined text-primary">arrow_back</span>
          </button>
          <div className="flex flex-col">
            <h1 className="text-xl font-['Manrope'] font-bold text-primary tracking-tight">Daybook</h1>
            <p className="text-[11px] text-on-surface-variant font-bold uppercase tracking-widest -mt-0.5 opacity-60">{displayDate}</p>
          </div>
        </div>

        <div className="relative">
          <input 
            ref={dateInputRef}
            type="date" 
            onChange={handleDateChange}
            value={selectedDate.split('/').join('-')}
            className="absolute inset-0 opacity-0 pointer-events-none w-px h-px"
          />
          <button 
            onClick={openPicker}
            className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px]">calendar_month</span>
            <span className="text-xs font-bold uppercase tracking-wider hidden sm:inline">Change Date</span>
          </button>
        </div>
      </header>

      <main className="flex-grow px-4 py-6 w-full max-w-6xl mx-auto">
        <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/15 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-surface-container-low/50">
                  <th className="px-6 py-4 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">Serial No.</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">Bill No.</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">Customer Name</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">No. of Items</th>
                  <th className="px-6 py-4 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">No. of Logs</th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-20 text-center">
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant/20 block mb-2">inventory_2</span>
                      <p className="text-on-surface-variant/40 font-medium">No bills recorded for today.</p>
                    </td>
                  </tr>
                ) : (
                  bills.map((bill, idx) => {
                    const editSessions = bill.logs?.filter(l => l.action === 'Edit Session Started').length || 0;
                    return (
                      <tr 
                        key={bill.id}
                        onClick={() => navigate('/create', { state: { billToEdit: bill, isViewOnly: true, fromDaybook: true } })}
                        className="group hover:bg-primary/5 transition-colors cursor-pointer border-b border-outline-variant/5 last:border-0"
                      >
                        <td className="px-6 py-4 text-sm font-bold text-on-surface-variant/40 group-hover:text-primary transition-colors">
                          {(idx + 1).toString().padStart(2, '0')}
                        </td>
                        <td className="px-6 py-4 font-mono text-[13px] font-medium text-primary whitespace-nowrap">
                          {bill.id.split('-').join(' - ')}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-on-surface">{bill.customerName || '—'}</p>
                          <p className="text-[10px] text-on-surface-variant/40 font-medium mt-0.5">{bill.timeString}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/10 text-secondary text-xs font-bold">
                            {bill.totalQuantity} items
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-lg bg-surface-container-high flex items-center justify-center text-[11px] font-bold text-on-surface-variant">
                              {editSessions}
                            </span>
                            <span className="text-[11px] font-medium text-on-surface-variant/50 uppercase tracking-wide">Sessions</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        
        <p className="text-center text-[11px] text-on-surface-variant/30 font-medium mt-6 uppercase tracking-widest">
          End of Daily Records
        </p>
      </main>
    </motion.div>
  );
}
