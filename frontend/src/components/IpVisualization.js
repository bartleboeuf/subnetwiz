import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import './IpVisualization.css';

// Worker will be loaded dynamically in useEffect

function IpVisualization({ ipData }) {
  const [hoveredIp, setHoveredIp] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [gridWidth, setGridWidth] = useState(0);
  const [processedIps, setProcessedIps] = useState([]);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const containerRef = useRef(null);
  const feedbackTimeoutRef = useRef(null);

  // Memoize color mapping function
  const getIpColor = useCallback((ip) => {
    switch (ip.status) {
      case 'used':
        if (ip.details?.type === 'primary') return '#3b82f6';
        if (ip.details?.type === 'secondary') return '#06b6d4';
        if (ip.details?.type === 'prefix_delegation') return '#8b5cf6';
        return '#3b82f6';
      case 'reserved':
        return '#9ca3af';
      case 'cidr_reservation':
        if (ip.details?.type === 'explicit') return '#f59e0b';
        if (ip.details?.type === 'prefix') return '#f97316';
        return '#f59e0b';
      case 'free':
        return '#f3f4f6';
      default:
        return '#f3f4f6';
    }
  }, []);

  const getIpLabel = useCallback((ip) => ip.ip.split('.').pop(), []);

  // Cleanup feedback timeout on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  // Measure container width on mount and window resize only
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measureWidth = () => {
      const width = container.offsetWidth - 48; // Subtract padding (1.5rem × 2)
      if (width > 0) {
        setGridWidth(width);
      }
    };

    // Measure on next frame to ensure DOM is laid out
    const timeoutId = setTimeout(measureWidth, 0);

    // Only resize on window resize, not container resize (prevents loops)
    window.addEventListener('resize', measureWidth);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', measureWidth);
    };
  }, []);

  // Process IPs asynchronously in chunks to prevent UI blocking
  useEffect(() => {
    if (!ipData || !ipData.ips) {
      setProcessedIps([]);
      return;
    }

    let isMounted = true;
    let timeoutIds = [];

    const ips = ipData.ips;
    const CHUNK_SIZE = 5000; // Process 5K IPs at a time
    const totalIps = ips.length;
    const processedIps = [];

    // Process in chunks with async scheduling to prevent UI blocking
    const processChunk = (startIndex) => {
      if (!isMounted) return;

      const endIndex = Math.min(startIndex + CHUNK_SIZE, totalIps);

      for (let i = startIndex; i < endIndex; i++) {
        const ip = ips[i];
        processedIps.push({
          ...ip,
          index: i,
          color: getIpColor(ip),
          label: (i % 4 === 0 || ip.status === 'used') ? getIpLabel(ip) : null,
          hasReservationOverlap: ip.status === 'used' && ip.details?.cidrReservation
        });
      }

      // Continue with next chunk if there's more to process
      if (endIndex < totalIps) {
        const timeoutId = setTimeout(() => processChunk(endIndex), 10);
        timeoutIds.push(timeoutId);
      } else {
        // Done processing
        if (isMounted) {
          setProcessedIps(processedIps);
        }
      }
    };

    // Start processing
    processChunk(0);

    // Cleanup: cancel pending processing if component unmounts
    return () => {
      isMounted = false;
      timeoutIds.forEach(id => clearTimeout(id));
    };
  }, [ipData, getIpColor, getIpLabel]);

  // Format IP details for clipboard
  const formatIpDetails = useCallback((ip) => {
    let details = `IP: ${ip.ip}\nStatus: ${ip.status.toUpperCase()}`;

    if (ip.status === 'used' && ip.details) {
      if (ip.details.type) {
        details += `\nType: ${ip.details.type.replace(/_/g, ' ')}`;
      }
      if (ip.details.interfaceId) {
        details += `\nENI: ${ip.details.interfaceId}`;
      }
      if (ip.details.description) {
        details += `\nDescription: ${ip.details.description}`;
      }
      if (ip.details.status) {
        details += `\nENI Status: ${ip.details.status}`;
      }
      if (ip.details.cidrReservation) {
        details += `\nCIDR Reservation: ${ip.details.cidrReservation.cidr}`;
        details += `\nReservation Type: ${ip.details.cidrReservation.type}`;
        if (ip.details.cidrReservation.description) {
          details += `\nReservation Desc: ${ip.details.cidrReservation.description}`;
        }
      }
    } else if (ip.status === 'reserved' && ip.details) {
      if (ip.details.reason) {
        details += `\nReason: ${ip.details.reason}`;
      }
      if (ip.details.description) {
        details += `\nPurpose: ${ip.details.description}`;
      }
    } else if (ip.status === 'cidr_reservation' && ip.details) {
      details += `\nReservation Type: ${ip.details.type}`;
      details += `\nCIDR Block: ${ip.details.cidr}`;
      if (ip.details.description) {
        details += `\nDescription: ${ip.details.description}`;
      }
      if (ip.details.reservationId) {
        details += `\nID: ${ip.details.reservationId}`;
      }
    }

    return details;
  }, []);

  // Handle click on IP block to copy details
  const handleIpClick = useCallback((ip) => {
    const textToCopy = formatIpDetails(ip);

    // Copy to clipboard using modern Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textToCopy).then(() => {
        // Show feedback
        setCopyFeedback(`Copied: ${ip.ip}`);

        // Clear feedback after 2 seconds
        if (feedbackTimeoutRef.current) {
          clearTimeout(feedbackTimeoutRef.current);
        }
        feedbackTimeoutRef.current = setTimeout(() => {
          setCopyFeedback(null);
        }, 2000);
      }).catch(() => {
        // Fallback for older browsers or permission issues
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          setCopyFeedback(`Copied: ${ip.ip}`);
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
  }, [formatIpDetails]);

  // Grid configuration
  const COLS = 32;
  const CELL_SIZE = 31; // 28px block + 3px gap
  const MAX_HEIGHT = 600; // Maximum height in pixels before scrolling


  const totalIps = processedIps.length;
  const rowCount = Math.ceil(totalIps / COLS);

  // Adaptive height: show all rows up to max height
  const requiredHeight = rowCount * CELL_SIZE;
  const GRID_HEIGHT = Math.min(requiredHeight, MAX_HEIGHT);

  // Handle mouse enter on IP block
  const handleMouseEnter = (ip, event) => {
    // Position tooltip at cursor position with small offset
    setTooltipPos({
      x: event.clientX,
      y: event.clientY
    });
    setHoveredIp(ip);
  };

  // Handle mouse move to follow cursor
  const handleMouseMove = (event) => {
    if (hoveredIp) {
      setTooltipPos({
        x: `${event.clientX - 470}`,
        y: `${event.clientY + 20}`
      });
    }
  };

  const handleMouseLeave = () => {
    setHoveredIp(null);
  };

  // Cell renderer for virtualized grid
  const Cell = ({ columnIndex, rowIndex, style }) => {
    const ipIndex = rowIndex * COLS + columnIndex;

    if (ipIndex >= processedIps.length) {
      return null;
    }

    const ip = processedIps[ipIndex];

    return (
      <div
        style={style}
        className={`ip-block ${ip.status} ${ip.hasReservationOverlap ? 'has-reservation' : ''}`}
      >
        <div
          className="ip-block-inner clickable"
          style={{ backgroundColor: ip.color }}
          onMouseEnter={(e) => handleMouseEnter(ip, e)}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={() => handleIpClick(ip)}
          title={`${ip.ip} (Click to copy)`}
        >
          {ip.label && <span className="ip-label">{ip.label}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="ip-visualization" ref={containerRef}>
      <div className="visualization-header">
        <h3>IP Address Map</h3>
        <div className="legend-compact">
          <div className="legend-item-compact">
            <span className="color-dot color-primary"></span>
            <span>Primary</span>
          </div>
          <div className="legend-item-compact">
            <span className="color-dot color-secondary"></span>
            <span>Secondary</span>
          </div>
          <div className="legend-item-compact">
            <span className="color-dot color-prefix"></span>
            <span>Prefix</span>
          </div>
          <div className="legend-item-compact">
            <span className="color-dot color-cidr-resv"></span>
            <span>CIDR Resv</span>
          </div>
          <div className="legend-item-compact">
            <span className="color-dot color-aws-resv"></span>
            <span>AWS Resv</span>
          </div>
          <div className="legend-item-compact">
            <span className="color-dot color-free"></span>
            <span>Free</span>
          </div>
        </div>
      </div>

      <div className="ip-grid-container">
        {gridWidth > 0 ? (
          <Grid
            columnCount={COLS}
            columnWidth={CELL_SIZE}
            height={GRID_HEIGHT}
            rowCount={rowCount}
            rowHeight={CELL_SIZE}
            width={gridWidth}
            className="ip-grid virtualized"
          >
            {Cell}
          </Grid>
        ) : (
          <div className="grid-loading">Preparing grid...</div>
        )}
      </div>

      {hoveredIp && (
        <div
          className="ip-tooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
          }}
        >
          <div className="tooltip-header">
            <strong>{hoveredIp.ip}</strong>
          </div>
          <div className="tooltip-body">
            <div className="tooltip-row">
              <span>Status:</span>
              <span className={`status-badge ${hoveredIp.status}`}>
                {hoveredIp.status.toUpperCase()}
              </span>
            </div>
            {hoveredIp.status === 'used' && hoveredIp.details && (
              <>
                {hoveredIp.details.type && (
                  <div className="tooltip-row">
                    <span>Type:</span>
                    <span>{hoveredIp.details.type.replace('_', ' ')}</span>
                  </div>
                )}
                {hoveredIp.details.interfaceId && (
                  <div className="tooltip-row">
                    <span>ENI:</span>
                    <span className="mono">{hoveredIp.details.interfaceId}</span>
                  </div>
                )}
                {hoveredIp.details.description && (
                  <div className="tooltip-row">
                    <span>Description:</span>
                    <span>{hoveredIp.details.description}</span>
                  </div>
                )}
                {hoveredIp.details.status && (
                  <div className="tooltip-row">
                    <span>ENI Status:</span>
                    <span>{hoveredIp.details.status}</span>
                  </div>
                )}
                {hoveredIp.details.cidrReservation && (
                  <>
                    <div className="tooltip-divider"></div>
                    <div className="tooltip-row">
                      <span>CIDR Reservation:</span>
                      <span className="mono">{hoveredIp.details.cidrReservation.cidr}</span>
                    </div>
                    <div className="tooltip-row">
                      <span>Reservation Type:</span>
                      <span>{hoveredIp.details.cidrReservation.type}</span>
                    </div>
                    {hoveredIp.details.cidrReservation.description && (
                      <div className="tooltip-row">
                        <span>Reservation Desc:</span>
                        <span>{hoveredIp.details.cidrReservation.description}</span>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {hoveredIp.status === 'reserved' && hoveredIp.details && (
              <>
                <div className="tooltip-divider" />
                <div className="tooltip-row">
                  <span>Reserved For:</span>
                  <span>{hoveredIp.details.reason}</span>
                </div>
                {hoveredIp.details.description && (
                  <div className="tooltip-row reserved-detail">
                    <span style={{ display: 'block', width: '100%' }}>{hoveredIp.details.description}</span>
                  </div>
                )}
              </>
            )}
            {hoveredIp.status === 'cidr_reservation' && hoveredIp.details && (
              <>
                <div className="tooltip-row">
                  <span>Reservation Type:</span>
                  <span>{hoveredIp.details.type}</span>
                </div>
                <div className="tooltip-row">
                  <span>CIDR Block:</span>
                  <span className="mono">{hoveredIp.details.cidr}</span>
                </div>
                {hoveredIp.details.description && (
                  <div className="tooltip-row">
                    <span>Description:</span>
                    <span>{hoveredIp.details.description}</span>
                  </div>
                )}
                {hoveredIp.details.reservationId && (
                  <div className="tooltip-row">
                    <span>ID:</span>
                    <span className="mono">{hoveredIp.details.reservationId}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {copyFeedback && (
        <div className="copy-feedback">
          {copyFeedback}
        </div>
      )}

      <div className="visualization-summary">
        <p>
          Displaying <strong>{totalIps}</strong> IP addresses in a{' '}
          <strong>{rowCount} × {COLS}</strong> grid
        </p>
        <p className="help-text">
          Hover over any block to see IP details. <strong>Click any block to copy details to clipboard.</strong> Scroll to view all IPs.
        </p>
      </div>
    </div>
  );
}

export default React.memo(IpVisualization);
