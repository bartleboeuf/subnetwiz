/**
 * IP Processor Web Worker
 * Handles background processing of large IP datasets
 * Runs in a separate thread to keep main thread responsive
 */

// Color mapping logic (mirrored from IpVisualization)
const getIpColor = (ip) => {
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
};

// Get last octet of IP for label
const getIpLabel = (ip) => {
  const parts = ip.ip.split('.');
  return parts[parts.length - 1];
};

// Process IPs in the worker
self.onmessage = (event) => {
  const { ips, cols = 32 } = event.data;

  if (!ips || ips.length === 0) {
    self.postMessage({ complete: true, data: [] });
    return;
  }

  const CHUNK_SIZE = 5000; // Process 5K IPs at a time
  const processedIps = [];
  const totalIps = ips.length;

  try {
    // Process in chunks to avoid blocking the worker
    for (let i = 0; i < ips.length; i += CHUNK_SIZE) {
      const chunk = ips.slice(i, Math.min(i + CHUNK_SIZE, ips.length));

      chunk.forEach((ip, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        const row = Math.floor(globalIndex / cols);
        const col = globalIndex % cols;

        // Process IP: calculate color, label, and metadata
        const processed = {
          ...ip,
          index: globalIndex,
          color: getIpColor(ip),
          label: (globalIndex % 4 === 0 || ip.status === 'used')
            ? getIpLabel(ip)
            : null,
          hasReservationOverlap: ip.status === 'used' && ip.details?.cidrReservation,
          row,
          col
        };

        processedIps.push(processed);
      });

      // Send progress update every chunk
      self.postMessage({
        progress: Math.min(i + CHUNK_SIZE, totalIps),
        total: totalIps,
        percent: Math.round(((i + CHUNK_SIZE) / totalIps) * 100)
      });
    }

    // Send final result
    self.postMessage({
      complete: true,
      data: processedIps,
      total: totalIps,
      percent: 100
    });
  } catch (error) {
    // Send error if processing fails
    self.postMessage({
      error: error.message,
      complete: true
    });
  }
};
