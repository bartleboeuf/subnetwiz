import React, { useMemo, useState, useRef } from 'react';
import './Statistics.css';

function Statistics({ subnet, ipData }) {
  const [copyFeedback, setCopyFeedback] = useState(null);
  const feedbackTimeoutRef = useRef(null);
  const getFragmentationLevel = (score) => {
    if (score < 20) return { level: 'Low', color: '#10b981' };
    if (score < 50) return { level: 'Moderate', color: '#f59e0b' };
    return { level: 'High', color: '#ef4444' };
  };

  // Calculate first and last IP from CIDR block
  const getSubnetIpRange = (cidr) => {
    try {
      const [ip, mask] = cidr.split('/');
      const ipParts = ip.split('.').map(Number);
      const maskBits = parseInt(mask, 10);

      // Convert IP to number
      const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];

      // Calculate network and broadcast addresses
      const hostBits = 32 - maskBits;
      const networkNum = ipNum & (~((1 << hostBits) - 1));
      const broadcastNum = networkNum | ((1 << hostBits) - 1);

      // First usable IP (network + 1), last usable IP (broadcast - 1)
      const firstIp = networkNum + 1;
      const lastIp = broadcastNum - 1;

      const toIpString = (num) => {
        return [
          (num >>> 24) & 0xff,
          (num >>> 16) & 0xff,
          (num >>> 8) & 0xff,
          num & 0xff
        ].join('.');
      };

      return {
        firstIp: toIpString(firstIp),
        lastIp: toIpString(lastIp)
      };
    } catch (e) {
      return { firstIp: 'N/A', lastIp: 'N/A' };
    }
  };

  // Memoize fragmentation info to avoid recalculation
  const fragInfo = useMemo(() => getFragmentationLevel(subnet.fragmentationScore), [subnet.fragmentationScore]);

  // Memoize IP range calculation
  const ipRange = useMemo(() => getSubnetIpRange(subnet.cidr), [subnet.cidr]);

  // Find first free IP in subnet
  const firstFreeIp = useMemo(() => {
    if (!ipData || !ipData.ips || ipData.ips.length === 0) {
      return 'N/A';
    }

    const freeIp = ipData.ips.find(ip => ip.status === 'free');
    return freeIp ? freeIp.ip : 'None';
  }, [ipData]);

  // Handle copy first free IP
  const handleCopyFirstFreeIp = () => {
    if (firstFreeIp === 'N/A' || firstFreeIp === 'None') {
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(firstFreeIp).then(() => {
        setCopyFeedback(`Copied: ${firstFreeIp}`);
        if (feedbackTimeoutRef.current) {
          clearTimeout(feedbackTimeoutRef.current);
        }
        feedbackTimeoutRef.current = setTimeout(() => {
          setCopyFeedback(null);
        }, 2000);
      }).catch(() => {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = firstFreeIp;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          setCopyFeedback(`Copied: ${firstFreeIp}`);
          if (feedbackTimeoutRef.current) {
            clearTimeout(feedbackTimeoutRef.current);
          }
          feedbackTimeoutRef.current = setTimeout(() => {
            setCopyFeedback(null);
          }, 2000);
        } catch (err) {
          console.error('Failed to copy to clipboard:', err);
        }
        document.body.removeChild(textarea);
      });
    }
  };

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="statistics">
      {copyFeedback && (
        <div className="copy-feedback-stats">
          {copyFeedback}
        </div>
      )}
      <h3>Subnet Statistics: {subnet.name}</h3>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-header">IP Allocation</div>
          <div className="stat-card-body">
            <div className="stat-row">
              <span>Total IPs:</span>
              <strong>{subnet.totalIps}</strong>
            </div>
            <div className="stat-row">
              <span>Used IPs:</span>
              <strong>{subnet.usedIps}</strong>
            </div>
            <div className="stat-row">
              <span>Available IPs:</span>
              <strong>{subnet.availableIps}</strong>
            </div>
            <div className="stat-row">
              <span>Reserved (AWS):</span>
              <strong>{subnet.reservedIps}</strong>
            </div>
            <div className="stat-row highlight">
              <span>Utilization:</span>
              <strong>{subnet.utilization.toFixed(2)}%</strong>
            </div>
            <div className="stat-row">
              <span>First Free IP:</span>
              <div className="first-free-ip-container">
                {firstFreeIp !== 'N/A' && firstFreeIp !== 'None' ? (
                  <>
                    <strong
                      style={{ color: '#10b981' }}
                      className="copyable-ip"
                      onClick={handleCopyFirstFreeIp}
                      title="Click to copy IP"
                      role="button"
                      tabIndex={0}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleCopyFirstFreeIp();
                        }
                      }}
                    >
                      {firstFreeIp}
                    </strong>
                    <button
                      className="copy-icon-btn"
                      onClick={handleCopyFirstFreeIp}
                      title="Copy IP to clipboard"
                      aria-label="Copy IP to clipboard"
                    >
                      📋
                    </button>
                  </>
                ) : (
                  <strong style={{ color: '#10b981' }}>{firstFreeIp}</strong>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">IP Types (EKS)</div>
          <div className="stat-card-body">
            <div className="stat-row">
              <span>Primary ENI IPs:</span>
              <strong>{subnet.primaryIps}</strong>
            </div>
            <div className="stat-row">
              <span>Secondary IPs:</span>
              <strong>{subnet.secondaryIps}</strong>
            </div>
            <div className="stat-row">
              <span>Prefix Delegation:</span>
              <strong>{subnet.prefixDelegationIps}</strong>
            </div>
            {subnet.cidrReservationIps > 0 && (
              <div className="stat-row">
                <span>CIDR Reservations:</span>
                <strong>{subnet.cidrReservationIps}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="stat-card fragmentation-card" style={{ borderColor: fragInfo.color }}>
          <div className="stat-card-header" style={{ backgroundColor: fragInfo.color }}>
            Fragmentation Analysis
            <span className="frag-info-tooltip" title="Based on actual ENI allocations (primary, secondary, and prefix delegation IPs). CIDR reservations are intentional reserves and don't affect this score.">ⓘ</span>
          </div>
          <div className="stat-card-body">
            <div className="frag-score" style={{ color: fragInfo.color }}>
              <span className="frag-score-value">{subnet.fragmentationScore.toFixed(1)}</span>
              <span className="frag-score-label">{fragInfo.level}</span>
            </div>
            <div className="frag-description">
              <small>Measures allocation efficiency for /28 prefix blocks (EKS). Based on gaps between actual ENI IPs.</small>
            </div>
            {subnet.fragmentationDetails && (
              <>
                <div className="stat-row">
                  <span>Usable /28 Blocks:</span>
                  <strong>{subnet.fragmentationDetails.usable_prefixes}</strong>
                </div>
                <div className="stat-row">
                  <span>Number of Gaps:</span>
                  <strong>{subnet.fragmentationDetails.num_gaps}</strong>
                </div>
                <div className="stat-row">
                  <span>Largest Free Block:</span>
                  <strong>{subnet.fragmentationDetails.largest_gap} IPs</strong>
                </div>
                <div className="stat-row">
                  <span>Average Gap Size:</span>
                  <strong>{subnet.fragmentationDetails.avg_gap_size.toFixed(1)} IPs</strong>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="subnet-info">
        <div className="info-row">
          <span>Subnet ID:</span>
          <code>{subnet.id}</code>
        </div>
        <div className="info-row">
          <span>CIDR Block:</span>
          <code>{subnet.cidr}</code>
        </div>
        <div className="info-row">
          <span>First IP:</span>
          <code>{ipRange.firstIp}</code>
        </div>
        <div className="info-row">
          <span>Last IP:</span>
          <code>{ipRange.lastIp}</code>
        </div>
        <div className="info-row">
          <span>Availability Zone:</span>
          <code>{subnet.availabilityZone}</code>
        </div>
      </div>

      {subnet.cidrReservations && subnet.cidrReservations.length > 0 && (
        <div className="cidr-reservations-section">
          <h4>CIDR Reservations (Intentional Reserves)</h4>
          <p className="section-description">
            These are intentionally reserved blocks. They don't affect the fragmentation score,
            which measures actual allocation efficiency.
          </p>
          <div className="reservations-list">
            {subnet.cidrReservations.map((resv) => (
              <div key={resv.reservationId} className="reservation-detail">
                <div className="reservation-block">
                  <span className="reservation-cidr-label">{resv.cidr}</span>
                  <span className="reservation-type-badge">{resv.type}</span>
                </div>
                {resv.description && (
                  <div className="reservation-description">{resv.description}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(Statistics);
