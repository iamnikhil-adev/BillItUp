import React from 'react';
import type { BillRecord } from '../utils/db';

interface BillViewerProps {
  bill: BillRecord;
}

const BillViewer: React.FC<BillViewerProps> = ({ bill }) => {
  return (
    <div className="w-full max-w-5xl mx-auto py-8 px-4 sm:px-6">
      {/* Header - Centered as requested */}
      <div className="text-center mb-12 space-y-2">
        <h1 className="text-3xl sm:text-4xl font-['Manrope'] font-extrabold text-primary tracking-tight">
          {bill.id.split('-').join(' - ')}
        </h1>
        <h2 className="text-xl sm:text-2xl font-bold text-on-surface">
          {bill.customerName || 'Generic Customer'}
        </h2>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 mt-4 text-[13px] font-bold text-on-surface-variant/60 uppercase tracking-[0.15em]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            {bill.dateString}
          </div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">schedule</span>
            {bill.timeString}
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="bg-surface-container-lowest rounded-[32px] border border-outline-variant/15 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-surface-container-low/50">
                <th className="px-6 py-5 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10 w-16">S.No</th>
                <th className="px-6 py-5 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">Product</th>
                <th className="px-6 py-5 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">Model</th>
                <th className="px-6 py-5 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10 w-24 text-center">Qty</th>
                <th className="px-6 py-5 text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-widest border-b border-outline-variant/10">Serial Numbers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {bill.products.map((product, idx) => (
                <tr key={product.id} id={`product-${product.id}`} className={`hover:bg-surface-container-low/30 transition-colors ${product.isRemoved ? 'bg-error/[0.03]' : ''}`}>
                  <td className="px-6 py-4 text-sm font-bold text-on-surface-variant/40 align-top pt-5">
                    {(idx + 1).toString().padStart(2, '0')}
                  </td>
                  <td className="px-6 py-4 align-top pt-5">
                    <p className={`text-sm font-bold leading-tight ${product.isRemoved ? 'text-error line-through opacity-60' : 'text-on-surface'}`}>
                      {product.name} {product.isRemoved && <span className="text-[10px] font-extrabold ml-1 uppercase text-error tracking-wider">[REMOVED]</span>}
                    </p>
                    {product.isRemoved && product.removedAt ? (
                      <span className="inline-block mt-1 text-[9px] font-black uppercase bg-error/10 px-1.5 py-0.5 rounded text-error border border-error/20">
                        REMOVED {new Date(product.removedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    ) : product.isAdded ? (
                      <span className="inline-block mt-1 text-[9px] font-black uppercase bg-success/10 px-1.5 py-0.5 rounded text-success border border-success/20">
                        ADDED {new Date(product.addedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-6 py-4 align-top pt-5">
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${product.isRemoved ? 'text-error/40' : 'text-primary'}`}>
                      {product.model || 'No Model'}
                    </p>
                  </td>
                  <td className="px-6 py-4 text-center align-top pt-5">
                    <span className={`inline-flex items-center justify-center min-w-[2.25rem] h-8 rounded-lg text-xs font-bold ${product.isRemoved ? 'bg-error/10 text-error' : 'bg-secondary/10 text-secondary'}`}>
                      {product.quantity}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1.5 py-1">
                      {product.serialNumbers && product.serialNumbers.length > 0 ? (
                        product.serialNumbers.map((sn, snIdx) => {
                          // Ghost Row Filter: If removed but never scanned, hide it
                          if (sn.isRemoved && !sn.value) return null;
                          
                          return (
                            <div 
                              key={snIdx} 
                              className={`text-[13px] font-mono leading-tight flex items-center gap-2 ${
                                product.isRemoved
                                  ? 'text-error line-through opacity-50'
                                  : sn.isRemoved 
                                    ? 'text-error line-through opacity-50' 
                                    : sn.isAdded 
                                      ? 'text-success font-bold' 
                                      : 'text-on-surface-variant font-medium'
                              }`}
                            >
                              <span className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] font-bold ${(product.isRemoved || sn.isRemoved) ? 'bg-error/10 text-error' : 'bg-surface-container text-on-surface-variant/40'}`}>
                                {snIdx + 1}
                              </span>
                              {sn.value || 'NOT SCANNED'}
                              {product.isRemoved && product.removedAt ? (
                                <span className="text-[9px] font-black ml-1 uppercase bg-error/10 px-1.5 py-0.5 rounded text-error border border-error/20">
                                  REMOVED {new Date(product.removedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                              ) : sn.isRemoved ? (
                                <span className="text-[9px] font-black ml-1 uppercase bg-error/10 px-1.5 py-0.5 rounded text-error border border-error/20">
                                  REMOVED {new Date(sn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                              ) : sn.isAdded ? (
                                <span className="text-[9px] font-black ml-1 uppercase bg-success/10 px-1.5 py-0.5 rounded text-success border border-success/20">
                                  ADDED {new Date(sn.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                              ) : null}
                            </div>
                          );
                        })
                      ) : (
                        <span className="text-[11px] text-on-surface-variant/20 italic">No serials tracked</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Additional Remarks */}
      {bill.remarks && (
        <div className="mt-8 bg-primary/[0.03] rounded-[32px] border border-primary/5 p-8 relative overflow-hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-[20px]">notes</span>
            </div>
            <h3 className="font-headline font-bold text-lg text-on-surface">Additional Remarks</h3>
          </div>
          <p className="text-on-surface-variant leading-relaxed whitespace-pre-wrap font-body text-[15px]">
            {bill.remarks}
          </p>
          <div className="absolute -inset-1 bg-gradient-to-b from-white/40 to-transparent pointer-events-none mix-blend-overlay z-0"></div>
        </div>
      )}

      {/* Summary Footer */}
      <div className="mt-8 flex flex-col items-end px-8">
        <div className="flex items-baseline gap-4">
          <span className="text-[11px] font-bold text-on-surface-variant/40 uppercase tracking-[0.2em]">Total Inventory Count</span>
          <span className="text-3xl font-['Manrope'] font-extrabold text-primary">{bill.totalQuantity}</span>
        </div>
        <p className="text-[10px] text-on-surface-variant/30 font-medium mt-2 uppercase tracking-widest italic">
          Verification check complete • {new Date(bill.timestamp).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
};

export default BillViewer;
