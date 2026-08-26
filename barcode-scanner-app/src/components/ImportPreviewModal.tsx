import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiFileText, FiCheck, FiX, FiUser, FiPhone, FiBox, FiLayers } from 'react-icons/fi';
import type { ParsedBillData } from '../utils/importParser';

interface ImportPreviewModalProps {
  isOpen: boolean;
  data: ParsedBillData | null;
  onConfirm: (confirmedData: ParsedBillData) => void;
  onCancel: () => void;
}

export const ImportPreviewModal: React.FC<ImportPreviewModalProps> = ({
  isOpen,
  data,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen || !data) return null;

  const [customerName, setCustomerName] = useState(data.customerName || '');
  const [phone, setPhone] = useState(data.clientPhoneNumber || '');

  const totalQty = data.products.reduce((acc, p) => acc + (Number(p.quantity) || 0), 0);
  const totalSerials = data.products.reduce((acc, p) => acc + (p.serialNumbers?.length || 0), 0);

  const handleApply = () => {
    onConfirm({
      ...data,
      customerName: customerName.trim() || 'Customer',
      clientPhoneNumber: phone.replace(/[\s\-()]/g, ''),
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onCancel}
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-surface-container-lowest border border-outline-variant/15 w-full max-w-lg rounded-[32px] p-6 sm:p-7 shadow-2xl relative z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-outline-variant/10 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xl shadow-inner">
                <FiFileText />
              </div>
              <div>
                <h3 className="font-headline font-bold text-xl text-on-surface">Data Extracted</h3>
                <p className="text-xs text-on-surface-variant/70 truncate max-w-[200px] sm:max-w-xs font-mono">
                  {data.sourceFileName}
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="w-9 h-9 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant transition-colors"
            >
              <FiX className="text-lg" />
            </button>
          </div>

          {/* Body (Scrollable) */}
          <div className="overflow-y-auto py-4 space-y-4 pr-1">
            {/* Customer & Phone fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-surface-container-low p-3 rounded-2xl border border-outline-variant/10">
                <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <FiUser className="text-primary" /> Customer Name
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Enter Customer Name"
                  className="w-full bg-surface-container-lowest px-3 py-2 rounded-xl text-sm font-medium text-on-surface border border-outline-variant/10 focus:border-primary focus:outline-none"
                />
              </div>

              <div className="bg-surface-container-low p-3 rounded-2xl border border-outline-variant/10">
                <label className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
                  <FiPhone className="text-primary" /> Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit Phone"
                  className="w-full bg-surface-container-lowest px-3 py-2 rounded-xl text-sm font-medium text-on-surface border border-outline-variant/10 focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            {/* Quick Stats Badges */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold font-headline">
                <FiBox className="text-[12px]" /> {data.products.length} Products
              </span>
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-secondary-container/30 text-secondary text-xs font-bold font-headline">
                <FiLayers className="text-[12px]" /> {totalQty} Total Qty
              </span>
              {totalSerials > 0 && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-tertiary-container/30 text-tertiary text-xs font-bold font-headline">
                  {totalSerials} Serials
                </span>
              )}
            </div>

            {/* Products List Preview */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Detected Items</h4>
              {data.products.map((prod, idx) => (
                <div
                  key={prod.id || idx}
                  className="bg-surface-container-low p-3.5 rounded-2xl border border-outline-variant/10 flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h5 className="font-headline font-bold text-sm text-on-surface">{prod.name || `Item ${idx + 1}`}</h5>
                      {prod.model && (
                        <p className="text-xs text-on-surface-variant font-mono mt-0.5">Model: {prod.model}</p>
                      )}
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface font-bold text-xs">
                      Qty: {prod.quantity}
                    </span>
                  </div>

                  {prod.serialNumbers && prod.serialNumbers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-1 pt-2 border-t border-outline-variant/10">
                      {prod.serialNumbers.slice(0, 6).map((sn, sIdx) => (
                        <span
                          key={sIdx}
                          className="px-2 py-0.5 rounded-md bg-surface-container-lowest border border-outline-variant/20 text-[10px] font-mono text-on-surface-variant font-medium"
                        >
                          {sn.value}
                        </span>
                      ))}
                      {prod.serialNumbers.length > 6 && (
                        <span className="px-2 py-0.5 text-[10px] text-primary font-bold">
                          +{prod.serialNumbers.length - 6} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-outline-variant/10 flex items-center gap-3 shrink-0">
            <button
              onClick={onCancel}
              className="flex-1 h-12 rounded-full bg-surface-container hover:bg-surface-container-high text-on-surface font-headline font-bold text-sm transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="flex-1 h-12 rounded-full bg-gradient-to-r from-primary to-primary-container text-on-primary font-headline font-bold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <FiCheck className="text-lg" /> Load into Bill
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
