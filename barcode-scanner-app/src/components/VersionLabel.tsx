import React from 'react';
import { APP_VERSION } from '../version';

const VersionLabel: React.FC = () => {
  return (
    <div className="fixed bottom-4 left-4 z-0 pointer-events-none opacity-30 select-none">
      <span className="font-mono text-[10px] font-bold text-on-surface-variant tracking-widest uppercase">
        {APP_VERSION}
      </span>
    </div>
  );
};

export default VersionLabel;
