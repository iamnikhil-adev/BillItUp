import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiBarChart2, FiPieChart, FiTrendingUp, FiDownload, FiBox, FiFileText } from 'react-icons/fi';
import { getAllBills, isBillInScope, type BillRecord, type UserScope } from '../utils/db';
import { useAuth } from '../context/AuthContext';
import { useAlert } from '../context/AlertContext';
import { format, subMonths, startOfMonth } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capawesome-team/capacitor-file-opener';
import { Share } from '@capacitor/share';

const ease: any = [0.23, 1, 0.32, 1];

type ChartType = 'bar' | 'line' | 'pie';
type MetricType = 'items' | 'bills';
type TimeRange = '3months' | '6months' | '12months' | 'all';

export default function Reports({ direction }: { direction: number }) {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { showAlert } = useAlert();

  const [allBills, setAllBills] = useState<BillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [metric, setMetric] = useState<MetricType>('items');
  const [timeRange, setTimeRange] = useState<TimeRange>('6months');

  // Load all accessible bills
  useEffect(() => {
    const userScope: UserScope | undefined = currentUser ? {
      uid: currentUser.uid,
      phoneNumber: currentUser.phoneNumber,
      role: currentUser.role || undefined,
      adminId: (currentUser as any).adminId,
    } : undefined;

    getAllBills().then((bills) => {
      setAllBills(bills.filter(b => isBillInScope(b, userScope)));
      setLoading(false);
    });
  }, [currentUser]);

  // Aggregate monthly data
  const monthlyStats = useMemo(() => {
    const map = new Map<string, { label: string; items: number; bills: number; date: Date }>();

    // Determine cutoff date
    let cutoff: Date | null = null;
    const now = new Date();
    if (timeRange === '3months') cutoff = startOfMonth(subMonths(now, 2));
    else if (timeRange === '6months') cutoff = startOfMonth(subMonths(now, 5));
    else if (timeRange === '12months') cutoff = startOfMonth(subMonths(now, 11));

    // Pre-populate months if range is fixed
    if (cutoff) {
      const monthCount = timeRange === '3months' ? 3 : timeRange === '6months' ? 6 : 12;
      for (let i = monthCount - 1; i >= 0; i--) {
        const d = startOfMonth(subMonths(now, i));
        const key = format(d, 'yyyy-MM');
        map.set(key, {
          label: format(d, 'MMM yyyy'),
          items: 0,
          bills: 0,
          date: d,
        });
      }
    }

    allBills.forEach((b) => {
      const billDate = new Date(b.timestamp);
      if (cutoff && billDate.getTime() < cutoff.getTime()) return;

      const key = format(billDate, 'yyyy-MM');
      const existing = map.get(key) || {
        label: format(billDate, 'MMM yyyy'),
        items: 0,
        bills: 0,
        date: startOfMonth(billDate),
      };

      existing.bills += 1;
      existing.items += (b.totalQuantity || 0);
      map.set(key, existing);
    });

    const list = Array.from(map.entries()).map(([key, val]) => ({
      monthKey: key,
      label: val.label,
      items: val.items,
      bills: val.bills,
      date: val.date,
    }));

    return list.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [allBills, timeRange]);

  // Full 12-Month Historical Data for Complete Ledger
  const all12MonthsStats = useMemo(() => {
    const map = new Map<string, { label: string; items: number; bills: number; date: Date }>();
    const now = new Date();

    for (let i = 11; i >= 0; i--) {
      const d = startOfMonth(subMonths(now, i));
      const key = format(d, 'yyyy-MM');
      map.set(key, {
        label: format(d, 'MMM yyyy'),
        items: 0,
        bills: 0,
        date: d,
      });
    }

    allBills.forEach((b) => {
      const billDate = new Date(b.timestamp);
      const key = format(billDate, 'yyyy-MM');
      if (map.has(key)) {
        const existing = map.get(key)!;
        existing.bills += 1;
        existing.items += (b.totalQuantity || 0);
      }
    });

    const list = Array.from(map.entries()).map(([key, val]) => ({
      monthKey: key,
      label: val.label,
      items: val.items,
      bills: val.bills,
      date: val.date,
    }));

    return list.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [allBills]);

  // Summary numbers
  const totalItems = useMemo(() => monthlyStats.reduce((sum, m) => sum + m.items, 0), [monthlyStats]);
  const totalBillsCount = useMemo(() => monthlyStats.reduce((sum, m) => sum + m.bills, 0), [monthlyStats]);
  const yearlyTotalItems = useMemo(() => all12MonthsStats.reduce((sum, m) => sum + m.items, 0), [all12MonthsStats]);
  const yearlyTotalBills = useMemo(() => all12MonthsStats.reduce((sum, m) => sum + m.bills, 0), [all12MonthsStats]);

  const maxVal = useMemo(() => {
    const vals = monthlyStats.map(m => (metric === 'items' ? m.items : m.bills));
    return Math.max(...vals, 1);
  }, [monthlyStats, metric]);

  const peakMonth = useMemo(() => {
    if (monthlyStats.length === 0) return null;
    let peak = monthlyStats[0];
    monthlyStats.forEach(m => {
      const val = metric === 'items' ? m.items : m.bills;
      const peakVal = metric === 'items' ? peak.items : peak.bills;
      if (val > peakVal) peak = m;
    });
    return peak;
  }, [monthlyStats, metric]);

  // Export report to PDF (Full 12-Month Table & Metrics)
  const handleExportPDF = async () => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(20);
      doc.setTextColor(26, 35, 126);
      doc.text('BillItUp - Complete Annual Analytics Report', 14, 22);

      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Generated on: ${format(new Date(), 'dd MMM yyyy, HH:mm')}`, 14, 30);
      doc.text(`Annual Period: Last 12 Months | Active View: ${timeRange.toUpperCase()}`, 14, 36);

      // Summary Table
      autoTable(doc, {
        startY: 44,
        head: [['Metric', 'Value']],
        body: [
          ['Total Items Sold (Past 12 Months)', yearlyTotalItems.toString()],
          ['Total Bills Created (Past 12 Months)', yearlyTotalBills.toString()],
          ['Selected View Items Sold', totalItems.toString()],
          ['Selected View Bills Created', totalBillsCount.toString()],
          ['Peak Month', peakMonth ? `${peakMonth.label} (${metric === 'items' ? peakMonth.items + ' items' : peakMonth.bills + ' bills'})` : 'N/A'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [26, 35, 126] },
      });

      // Complete 12-Month Breakdown Table (Regardless of 0s)
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 12,
        head: [['Month', 'Items Sold (Qty)', 'Bills Created', 'Avg Qty / Bill']],
        body: all12MonthsStats.map(m => [
          m.label,
          m.items.toString(),
          m.bills.toString(),
          m.bills > 0 ? (m.items / m.bills).toFixed(1) : '0'
        ]),
        theme: 'grid',
        headStyles: { fillColor: [26, 35, 126] },
      });

      const fileName = `BillItUp-Annual-Report-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
      const pdfDataUri = doc.output('datauristring');
      const pdfBase64 = pdfDataUri.split(',')[1];

      let savedFileUri: string | null = null;
      let webBlobUrl: string | null = null;

      if (Capacitor.isNativePlatform()) {
        // 1. Save to Documents
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Documents,
          });
        } catch (e) {
          console.warn('[REPORT_SAVE] Documents write failed:', e);
        }

        // 2. Save to Cache for immediate opening / sharing
        try {
          const cached = await Filesystem.writeFile({
            path: fileName,
            data: pdfBase64,
            directory: Directory.Cache,
          });
          savedFileUri = cached.uri;
        } catch (e) {
          console.warn('[REPORT_SAVE] Cache write failed:', e);
        }
      } else {
        // Browser fallback
        doc.save(fileName);
        const blob = doc.output('blob');
        webBlobUrl = URL.createObjectURL(blob);
      }

      showAlert({
        title: 'Report Exported',
        message: 'Comprehensive 12-month PDF report has been generated and saved to Documents.',
        type: 'success',
        confirmText: 'Dismiss',
        actionText: 'View Report',
        onAction: async () => {
          try {
            if (Capacitor.isNativePlatform() && savedFileUri) {
              await FileOpener.openFile({
                path: savedFileUri,
                mimeType: 'application/pdf',
              });
            } else if (webBlobUrl) {
              window.open(webBlobUrl, '_blank');
            }
          } catch (openErr: any) {
            console.error('[OPEN_REPORT_ERROR]', openErr);
            if (savedFileUri) {
              await Share.share({
                title: 'Annual Analytics Report',
                url: savedFileUri,
              }).catch(() => {});
            }
          }
        },
      });
    } catch (e: any) {
      showAlert({ title: 'Export Failed', message: e.message || 'Could not export report.', type: 'error' });
    }
  };

  const colors = ['#1a237e', '#0056c5', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b', '#0097a7', '#5d4037', '#455a64'];

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
      transition={{ duration: 0.35, ease }}
      className="bg-surface text-on-surface font-body antialiased min-h-screen flex flex-col pb-28 motion-root"
    >
      {/* Top App Bar with Safe Area Top Padding */}
      <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-xl px-5 pt-14 pb-4 flex items-center justify-between border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-surface-container transition-colors">
            <FiArrowLeft className="w-5 h-5 text-on-surface" />
          </button>
          <h1 className="font-['Manrope'] font-extrabold text-xl text-on-surface tracking-tight">Analytics & Reports</h1>
        </div>
        <button
          onClick={handleExportPDF}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary text-on-primary font-['Manrope'] font-bold text-xs shadow-md active:scale-95 transition-transform"
        >
          <FiDownload className="w-3.5 h-3.5" />
          Export PDF
        </button>
      </header>

      <main className="flex-1 px-4 sm:px-6 max-w-3xl mx-auto w-full pt-4">
        {/* Metric Selector Tabs */}
        <div className="flex gap-2 p-1 bg-surface-container-low rounded-2xl mb-4 border border-outline-variant/10">
          <button
            onClick={() => setMetric('items')}
            className={`flex-1 py-3 rounded-xl font-['Manrope'] font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              metric === 'items'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <FiBox className="w-4 h-4" />
            Total Items Sold
          </button>
          <button
            onClick={() => setMetric('bills')}
            className={`flex-1 py-3 rounded-xl font-['Manrope'] font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              metric === 'bills'
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <FiFileText className="w-4 h-4" />
            Bills Created
          </button>
        </div>

        {/* Filter Controls Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          {/* Chart Type Selector */}
          <div className="flex bg-surface-container-low rounded-xl p-1 border border-outline-variant/10">
            <button
              onClick={() => setChartType('bar')}
              className={`p-2 rounded-lg transition-all ${chartType === 'bar' ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant'}`}
              title="Bar Chart"
            >
              <FiBarChart2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-2 rounded-lg transition-all ${chartType === 'line' ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant'}`}
              title="Line Chart"
            >
              <FiTrendingUp className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('pie')}
              className={`p-2 rounded-lg transition-all ${chartType === 'pie' ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant'}`}
              title="Pie Chart"
            >
              <FiPieChart className="w-4 h-4" />
            </button>
          </div>

          {/* Time Range Selector */}
          <div className="flex bg-surface-container-low rounded-xl p-1 border border-outline-variant/10 text-xs font-bold">
            {(['3months', '6months', '12months', 'all'] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  timeRange === r ? 'bg-surface text-primary shadow-sm' : 'text-on-surface-variant/70'
                }`}
              >
                {r === '3months' ? '3M' : r === '6months' ? '6M' : r === '12months' ? '1Y' : 'All'}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/10 shadow-sm">
            <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider mb-1">
              {metric === 'items' ? 'Items Sold' : 'Total Bills'}
            </p>
            <h3 className="font-['Manrope'] font-extrabold text-2xl text-primary">
              {metric === 'items' ? totalItems : totalBillsCount}
            </h3>
          </div>
          <div className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/10 shadow-sm">
            <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider mb-1">
              Monthly Avg
            </p>
            <h3 className="font-['Manrope'] font-extrabold text-2xl text-on-surface">
              {monthlyStats.length > 0 ? Math.round((metric === 'items' ? totalItems : totalBillsCount) / monthlyStats.length) : 0}
            </h3>
          </div>
          <div className="bg-surface-container-lowest rounded-2xl p-4 border border-outline-variant/10 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider mb-1">
              Peak Month
            </p>
            <h3 className="font-['Manrope'] font-extrabold text-lg text-secondary truncate">
              {peakMonth ? peakMonth.label : 'N/A'}
            </h3>
          </div>
        </div>

        {/* Visual Chart Card */}
        <section className="bg-surface-container-lowest rounded-[28px] p-4 sm:p-6 border border-outline-variant/10 shadow-sm mb-6 overflow-hidden">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="font-['Manrope'] font-bold text-base text-on-surface">
              {metric === 'items' ? 'Monthly Items Volume' : 'Monthly Bills Volume'}
            </h2>
            <span className="text-xs font-bold text-on-surface-variant/60">
              {chartType.toUpperCase()} VIEW
            </span>
          </div>

          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : monthlyStats.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-2">bar_chart</span>
              <p className="text-sm text-on-surface-variant/60 font-medium">No billing data found in this date range.</p>
            </div>
          ) : (
            <div className="h-72 w-full flex items-end overflow-hidden">
              <AnimatePresence mode="wait">
                {/* ──── BAR CHART (Responsive & Contained) ──── */}
                {chartType === 'bar' && (
                  <motion.div
                    key="bar"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex items-end justify-between gap-1 sm:gap-2 pt-6 overflow-x-auto no-scrollbar"
                  >
                    {monthlyStats.map((item, index) => {
                      const val = metric === 'items' ? item.items : item.bills;
                      const heightPercent = maxVal > 0 ? (val / maxVal) * 100 : 0;
                      return (
                        <div key={item.monthKey} className="flex-1 min-w-[20px] max-w-[48px] h-full flex flex-col items-center justify-end group relative">
                          {/* Value tooltip */}
                          <div className="text-[9px] sm:text-[11px] font-bold text-primary mb-1 opacity-80 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                            {val}
                          </div>
                          {/* Rising Bar */}
                          <div className="w-full max-w-[28px] sm:max-w-[40px] bg-surface-container-high rounded-xl sm:rounded-2xl overflow-hidden h-[180px] flex items-end p-0.5 sm:p-1">
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: `${Math.max(heightPercent, 5)}%` }}
                              transition={{ duration: 0.8, delay: index * 0.05, ease }}
                              className="w-full rounded-lg sm:rounded-xl bg-gradient-to-t from-primary to-primary-container shadow-sm group-hover:from-secondary group-hover:to-primary transition-colors"
                            />
                          </div>
                          {/* Month label */}
                          <span className="text-[8px] sm:text-[10px] font-bold text-on-surface-variant/70 mt-2 truncate max-w-full text-center">
                            {item.label.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </motion.div>
                )}

                {/* ──── LINE CHART ──── */}
                {chartType === 'line' && (
                  <motion.div
                    key="line"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col justify-end pt-4 overflow-hidden"
                  >
                    <svg className="w-full h-[200px] overflow-visible" viewBox="0 0 500 200" preserveAspectRatio="none">
                      {/* Grid Lines */}
                      <line x1="0" y1="50" x2="500" y2="50" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="4 4" />
                      <line x1="0" y1="100" x2="500" y2="100" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="4 4" />
                      <line x1="0" y1="150" x2="500" y2="150" stroke="currentColor" strokeOpacity="0.06" strokeDasharray="4 4" />

                      {/* Area Fill */}
                      {monthlyStats.length > 1 ? (
                        <motion.polygon
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.15 }}
                          transition={{ duration: 1 }}
                          fill="url(#gradientFill)"
                          points={`
                            0,200 
                            ${monthlyStats.map((item, idx) => {
                              const x = (idx / (monthlyStats.length - 1)) * 500;
                              const val = metric === 'items' ? item.items : item.bills;
                              const y = 180 - (val / maxVal) * 150;
                              return `${x},${y}`;
                            }).join(' ')}
                            500,200
                          `}
                        />
                      ) : (
                        <motion.polygon
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.15 }}
                          transition={{ duration: 1 }}
                          fill="url(#gradientFill)"
                          points={`0,200 0,${180 - ((metric === 'items' ? monthlyStats[0].items : monthlyStats[0].bills) / maxVal) * 150} 500,${180 - ((metric === 'items' ? monthlyStats[0].items : monthlyStats[0].bills) / maxVal) * 150} 500,200`}
                        />
                      )}

                      {/* Line Path */}
                      <defs>
                        <linearGradient id="gradientFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#1a237e" stopOpacity="0.5" />
                          <stop offset="100%" stopColor="#1a237e" stopOpacity="0" />
                        </linearGradient>
                      </defs>

                      {monthlyStats.length > 1 ? (
                        <motion.path
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 1.2, ease }}
                          d={`M ${monthlyStats.map((item, idx) => {
                            const x = (idx / (monthlyStats.length - 1)) * 500;
                            const val = metric === 'items' ? item.items : item.bills;
                            const y = 180 - (val / maxVal) * 150;
                            return `${x} ${y}`;
                          }).join(' L ')}`}
                          fill="none"
                          stroke="#1a237e"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      ) : (
                        <motion.line
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 1.2, ease }}
                          x1="0"
                          y1={180 - ((metric === 'items' ? monthlyStats[0].items : monthlyStats[0].bills) / maxVal) * 150}
                          x2="500"
                          y2={180 - ((metric === 'items' ? monthlyStats[0].items : monthlyStats[0].bills) / maxVal) * 150}
                          stroke="#1a237e"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      )}

                      {/* Data Dots */}
                      {monthlyStats.map((item, idx) => {
                        const x = monthlyStats.length === 1 ? 250 : (idx / (monthlyStats.length - 1)) * 500;
                        const val = metric === 'items' ? item.items : item.bills;
                        const y = 180 - (val / maxVal) * 150;
                        return (
                          <g key={item.monthKey}>
                            <motion.circle
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ delay: 0.3 + idx * 0.08 }}
                              cx={x}
                              cy={y}
                              r="6"
                              fill="#ffffff"
                              stroke="#1a237e"
                              strokeWidth="3"
                            />
                          </g>
                        );
                      })}
                    </svg>

                    {/* Labels Row */}
                    <div className="flex justify-between w-full mt-3">
                      {monthlyStats.map((item) => (
                        <span key={item.monthKey} className="text-[10px] font-bold text-on-surface-variant/70">
                          {item.label.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* ──── PIE / DONUT CHART (Clean Division & Zero Artifacts) ──── */}
                {chartType === 'pie' && (
                  <motion.div
                    key="pie"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full flex flex-col sm:flex-row items-center justify-center gap-6"
                  >
                    {/* Donut Visual */}
                    <div className="relative w-44 h-44 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                        {(() => {
                          const total = metric === 'items' ? totalItems : totalBillsCount;
                          if (total === 0) {
                            return (
                              <circle
                                cx="50"
                                cy="50"
                                r="38"
                                fill="transparent"
                                stroke="rgba(255,255,255,0.08)"
                                strokeWidth="16"
                              />
                            );
                          }

                          // Filter ONLY months with actual data to avoid zero-length overlapping artifacts
                          const activeStats = monthlyStats.filter(m => (metric === 'items' ? m.items : m.bills) > 0);
                          let accumulatedPercent = 0;

                          return activeStats.map((item, idx) => {
                            const val = metric === 'items' ? item.items : item.bills;
                            const percent = (val / total) * 100;
                            const strokeDasharray = `${percent} ${100 - percent}`;
                            const strokeDashoffset = -accumulatedPercent;
                            accumulatedPercent += percent;

                            return (
                              <motion.circle
                                key={item.monthKey}
                                initial={{ strokeDasharray: '0 100' }}
                                animate={{ strokeDasharray }}
                                transition={{ duration: 0.8, delay: idx * 0.1, ease }}
                                cx="50"
                                cy="50"
                                r="38"
                                fill="transparent"
                                stroke={colors[idx % colors.length]}
                                strokeWidth="16"
                                strokeDashoffset={strokeDashoffset}
                                strokeLinecap="butt"
                                pathLength={100}
                              />
                            );
                          });
                        })()}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="font-['Manrope'] font-extrabold text-xl text-primary">
                          {metric === 'items' ? totalItems : totalBillsCount}
                        </span>
                        <span className="text-[9px] font-bold text-on-surface-variant/60 uppercase">Total</span>
                      </div>
                    </div>

                    {/* Legend (Shows active months with data) */}
                    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-2 w-full sm:w-auto">
                      {(() => {
                        const total = metric === 'items' ? totalItems : totalBillsCount;
                        const activeStats = monthlyStats.filter(m => (metric === 'items' ? m.items : m.bills) > 0);

                        if (activeStats.length === 0) {
                          return <p className="text-xs text-on-surface-variant/60">No volume recorded in this period.</p>;
                        }

                        return activeStats.map((item, idx) => {
                          const val = metric === 'items' ? item.items : item.bills;
                          const percent = total > 0 ? Math.round((val / total) * 100) : 0;
                          return (
                            <div key={item.monthKey} className="flex items-center gap-2 text-xs">
                              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colors[idx % colors.length] }} />
                              <span className="font-medium text-on-surface">{item.label}:</span>
                              <span className="font-bold text-primary ml-auto">{val} ({percent}%)</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Zero Volume Disclaimer Note */}
          <div className="mt-3 px-2 flex items-center gap-2 text-[11px] text-on-surface-variant/70 font-medium">
            <span className="material-symbols-outlined text-[14px] text-primary/70">info</span>
            <span>Months not plotted in this chart had 0 items / bills recorded.</span>
          </div>
        </section>

        {/* Detailed Monthly Breakdown List (All 12 Months) */}
        <section className="bg-surface-container-lowest rounded-[28px] p-6 border border-outline-variant/10 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-['Manrope'] font-bold text-base text-on-surface">Detailed Monthly Breakdown</h2>
            <span className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider">All 12 Months</span>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {all12MonthsStats.map((m) => (
              <div key={m.monthKey} className="py-3 flex items-center justify-between">
                <div>
                  <h4 className="font-['Manrope'] font-bold text-sm text-on-surface">{m.label}</h4>
                  <p className="text-xs text-on-surface-variant/60">{m.bills} bills created</p>
                </div>
                <div className="text-right">
                  <span className="font-['Manrope'] font-extrabold text-base text-primary">{m.items}</span>
                  <span className="text-xs text-on-surface-variant/60 block">items sold</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </motion.div>
  );
}
