import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, AlertTriangle, Info } from 'lucide-react';
import { ContractErrorDetails } from '../utils/contractErrorParser';
import styles from './ContractErrorPanel.module.css';

interface Props {
  error: ContractErrorDetails | null;
  className?: string;
}

export const ContractErrorPanel: React.FC<Props> = ({ error, className = '' }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!error) return null;

  const handleCopyRaw = () => {
    if (error.rawXdr) {
      void navigator.clipboard.writeText(error.rawXdr);
    }
  };

  const isUnknown = error.code === 'UNKNOWN_FORMAT' || error.code === 'UNPARSEABLE_XDR';

  return (
    <div className={`${styles.panel} ${className} ${isExpanded ? styles.expanded : ''}`}>
      <div className={styles.header} onClick={() => setIsExpanded(!isExpanded)}>
        <div className={styles.headerLeft}>
          <AlertTriangle className={styles.errorIcon} size={18} />
          <span className={styles.title}>Contract Invocation Failed</span>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.errorCode}>{error.code}</span>
          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {isExpanded && (
        <div className={styles.content}>
          <div className={styles.messageSection}>
            <p className={styles.message}>{error.message}</p>
          </div>

          <div className={styles.actionSection}>
            <div className={styles.actionHeader}>
              <Info size={14} className={styles.infoIcon} />
              <span className={styles.actionLabel}>Suggested Action</span>
            </div>
            <p className={styles.actionText}>{error.action}</p>
          </div>

          {(isUnknown || error.rawXdr) && (
            <div className={styles.rawSection}>
              <div className={styles.rawHeader}>
                <span className={styles.rawLabel}>Raw Transaction Result (XDR)</span>
                <button
                  type="button"
                  onClick={handleCopyRaw}
                  className={styles.copyButton}
                  title="Copy XDR"
                >
                  <Copy size={14} />
                  <span>Copy</span>
                </button>
              </div>
              <div className={styles.rawContent}>
                <code>{error.rawXdr || 'N/A'}</code>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContractErrorPanel;
