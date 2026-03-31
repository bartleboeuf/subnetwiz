import React, { useMemo, useState, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Address4 } from 'ip-address';
import './SubnetList.css';

// Helper function to get fragmentation color (defined outside to avoid recreation)
const getFragmentationColor = (score) => {
  if (score < 20) return '#10b981'; // Green - low fragmentation
  if (score < 50) return '#f59e0b'; // Orange - moderate
  return '#ef4444'; // Red - high fragmentation
};

// Memoized subnet item component for better performance
const SubnetItem = React.memo(({ subnet, isSelected, onSelect }) => {
  return (
    <div
      className={`subnet-item ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(subnet)}
      role="button"
      tabIndex={0}
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(subnet);
        }
      }}
    >
      <div className="subnet-header">
        <h4>{subnet.name}</h4>
        <span className="subnet-az">{subnet.availabilityZone}</span>
      </div>
      <div className="subnet-cidr">{subnet.cidr}</div>
      <div className="subnet-stats">
        <div className="stat">
          <span className="stat-label">Utilization:</span>
          <span className="stat-value">{subnet.utilization.toFixed(1)}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Used:</span>
          <span className="stat-value">{subnet.usedIps}/{subnet.totalIps}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Available:</span>
          <span className="stat-value">{subnet.availableIps}</span>
        </div>
      </div>
      <div className="subnet-ip-types">
        {subnet.primaryIps > 0 && (
          <span className="ip-type-badge primary">Primary: {subnet.primaryIps}</span>
        )}
        {subnet.secondaryIps > 0 && (
          <span className="ip-type-badge secondary">Secondary: {subnet.secondaryIps}</span>
        )}
        {subnet.prefixDelegationIps > 0 && (
          <span className="ip-type-badge prefix">Prefix: {subnet.prefixDelegationIps}</span>
        )}
        {subnet.cidrReservationIps > 0 && (
          <span className="ip-type-badge cidr-reservation">CIDR Resv: {subnet.cidrReservationIps}</span>
        )}
      </div>
      {subnet.cidrReservations && subnet.cidrReservations.length > 0 && (
        <div className="subnet-reservations">
          <span className="reservations-label">Reservations:</span>
          {subnet.cidrReservations.map((resv) => (
            <div key={resv.cidr} className="reservation-item">
              <span className="reservation-cidr">{resv.cidr}</span>
              <span className="reservation-type">({resv.type})</span>
            </div>
          ))}
        </div>
      )}
      <div className="fragmentation-score" title="Based on actual ENI allocations only. CIDR reservations don't affect this score.">
        <span className="frag-label">Fragmentation:</span>
        <div className="frag-bar-container">
          <div
            className="frag-bar"
            style={{
              width: `${subnet.fragmentationScore}%`,
              backgroundColor: getFragmentationColor(subnet.fragmentationScore)
            }}
          />
        </div>
        <span className="frag-value">{subnet.fragmentationScore.toFixed(1)}</span>
      </div>
    </div>
  );
});

SubnetItem.displayName = 'SubnetItem';

function SubnetList({
  subnets,
  selectedSubnet,
  onSelect,
  loading,
  filters,
  onFiltersChange,
  filterPanelExpanded,
  onToggleFilterPanel
}) {
  const [sortBy, setSortBy] = useState('utilization'); // Sort by utilization by default

  // Sort state for Phase 15
  const [tagSortKey, setTagSortKey] = useState(null); // null = no tag sort
  const [cidrSortType, setCidrSortType] = useState('address'); // 'address' or 'size'

  // Extract filter values from props
  const {
    searchText = '',
    selectedAZs = [],
    minUtilization = 0,
    maxUtilization = 100,
    selectedFragmentationLevels = ['Low', 'Moderate', 'High'],
    selectedTagFilters = {},
    filterByIP = '',
  } = filters || {};

  // Extract unique tag keys from subnets (Phase 15)
  const availableTagKeys = useMemo(() => {
    const keys = new Set();
    subnets.forEach(subnet => {
      subnet.tags?.forEach(tag => keys.add(tag.key));
    });
    return Array.from(keys).sort();
  }, [subnets]);

  // Helper to parse CIDR blocks (Phase 15.2)
  const parseCIDR = (cidrString) => {
    try {
      const [addr, bits] = cidrString.split('/');
      return new Address4(addr + '/' + bits);
    } catch {
      return null;
    }
  };

  // Helper to check if subnet contains IP (Phase 15.4)
  const subnetContainsIP = (cidrString, ipString) => {
    try {
      const subnet = new Address4(cidrString);
      const ip = new Address4(ipString);
      return ip.isInSubnet(subnet);
    } catch {
      return false;
    }
  };

  // Helper to validate IP address (Phase 15.4)
  const isValidIP = (ipString) => {
    try {
      const parts = ipString.split('.');
      if (parts.length !== 4) return false;
      return parts.every(part => {
        const num = parseInt(part, 10);
        return num >= 0 && num <= 255;
      });
    } catch {
      return false;
    }
  };

  // Helper to get fragmentation level
  const getFragmentationLevel = (score) => {
    if (score < 20) return 'Low';
    if (score < 50) return 'Moderate';
    return 'High';
  };

  // Filter subnets based on all criteria
  const filteredSubnets = useMemo(() => {
    return subnets.filter(subnet => {
      // Text search filter
      if (searchText && !subnet.name.toLowerCase().includes(searchText.toLowerCase())) {
        return false;
      }
      // Availability zone filter
      if (selectedAZs.length > 0 && !selectedAZs.includes(subnet.availabilityZone)) {
        return false;
      }
      // Utilization range filter
      if (subnet.utilization < minUtilization || subnet.utilization > maxUtilization) {
        return false;
      }
      // Fragmentation level filter
      const fragLevel = getFragmentationLevel(subnet.fragmentationScore);
      if (!selectedFragmentationLevels.includes(fragLevel)) {
        return false;
      }
      // Tag value filter (Phase 15.3)
      if (Object.keys(selectedTagFilters).length > 0) {
        const tagFilterMatches = Object.entries(selectedTagFilters).every(([tagKey, values]) => {
          if (values.length === 0) return true; // No filter on this tag
          const subnetTagValue = subnet.tags?.find(t => t.key === tagKey)?.value;
          return values.includes(subnetTagValue);
        });
        if (!tagFilterMatches) return false;
      }
      // IP address filter (Phase 15.4)
      if (filterByIP && isValidIP(filterByIP)) {
        if (!subnetContainsIP(subnet.cidr, filterByIP)) {
          return false;
        }
      }
      return true;
    });
  }, [subnets, searchText, selectedAZs, minUtilization, maxUtilization, selectedFragmentationLevels, selectedTagFilters, filterByIP]);

  // Memoize sorted subnets to avoid re-sorting on every render (must be before early returns)
  const sortedSubnets = useMemo(() => {
    const sorted = [...filteredSubnets];
    if (sortBy === 'utilization') {
      sorted.sort((a, b) => b.utilization - a.utilization);
    } else if (sortBy === 'fragmentation') {
      sorted.sort((a, b) => b.fragmentationScore - a.fragmentationScore);
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'tag' && tagSortKey) {
      sorted.sort((a, b) => {
        const aTag = a.tags?.find(t => t.key === tagSortKey)?.value;
        const bTag = b.tags?.find(t => t.key === tagSortKey)?.value;

        // Subnets without tag go to end
        if (aTag === undefined && bTag === undefined) return 0;
        if (aTag === undefined) return 1; // a goes to end
        if (bTag === undefined) return -1; // b goes to end

        return aTag.localeCompare(bTag);
      });
    } else if (sortBy === 'cidr') {
      sorted.sort((a, b) => {
        const addrA = parseCIDR(a.cidr);
        const addrB = parseCIDR(b.cidr);
        if (!addrA || !addrB) return 0;

        if (cidrSortType === 'address') {
          // Compare network addresses as BigInt
          const bigIntA = addrA.startAddress().bigInt();
          const bigIntB = addrB.startAddress().bigInt();
          return bigIntA < bigIntB ? -1 : bigIntA > bigIntB ? 1 : 0;
        } else {
          // Compare subnet size (prefix length) - larger first (smaller prefix = larger subnet)
          const bitsA = parseInt(a.cidr.split('/')[1]);
          const bitsB = parseInt(b.cidr.split('/')[1]);
          return bitsA - bitsB;
        }
      });
    }
    return sorted;
  }, [filteredSubnets, sortBy, tagSortKey, cidrSortType]);


  // Item renderer for virtualized list
  const Row = useCallback(({ index, style }) => {
    const subnet = sortedSubnets[index];
    return (
      <div style={style}>
        <SubnetItem
          subnet={subnet}
          isSelected={selectedSubnet?.id === subnet.id}
          onSelect={onSelect}
        />
      </div>
    );
  }, [sortedSubnets, selectedSubnet, onSelect]);

  if (loading) {
    return (
      <div className="subnet-list">
        <h3>Subnets</h3>
        <div className="subnet-list-loading">
          <div className="spinner"></div>
          <p>Loading {subnets.length} subnets...</p>
        </div>
      </div>
    );
  }

  if (subnets.length === 0) {
    return (
      <div className="subnet-list">
        <h3>Subnets</h3>
        <div className="subnet-list-empty">No subnets found</div>
      </div>
    );
  }

  // Use virtualization for large lists (100+ subnets)
  const useVirtualization = subnets.length > 50;
  const itemHeight = 280; // Average height of a subnet item
  const visibleItems = 5; // Show ~5 items at a time
  const listHeight = visibleItems * itemHeight;

  return (
    <div className="subnet-list">
      <div className="subnet-list-header">
        <div className="header-title">
          <h3>Subnets ({filteredSubnets.length}/{subnets.length})</h3>
          <button
            className="filter-toggle-btn"
            onClick={onToggleFilterPanel}
            title={filterPanelExpanded ? 'Hide filters' : 'Show filters'}
            aria-label="Toggle filter panel"
          >
            <span className="filter-wheel-icon">⚙️</span>
          </button>
        </div>
        <div className="header-controls">
          <select
            className="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort subnets by"
          >
            <option value="utilization">Sort by: Utilization</option>
            <option value="fragmentation">Sort by: Fragmentation</option>
            <option value="name">Sort by: Name</option>
            {availableTagKeys.length > 0 && <option value="tag">Sort by: Tag</option>}
            <option value="cidr">Sort by: CIDR Range</option>
          </select>
          {sortBy === 'tag' && availableTagKeys.length > 0 && (
            <select
              className="sort-select"
              value={tagSortKey || ''}
              onChange={(e) => setTagSortKey(e.target.value || null)}
              aria-label="Select tag to sort by"
            >
              <option value="">Select tag...</option>
              {availableTagKeys.map(key => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          )}
          {sortBy === 'cidr' && (
            <select
              className="sort-select"
              value={cidrSortType}
              onChange={(e) => setCidrSortType(e.target.value)}
              aria-label="Select CIDR sort type"
            >
              <option value="address">By Network Address</option>
              <option value="size">By Size (Largest First)</option>
            </select>
          )}
        </div>
      </div>

      {useVirtualization ? (
        <List
          height={listHeight}
          itemCount={sortedSubnets.length}
          itemSize={itemHeight}
          width="100%"
          className="subnet-items virtualized"
        >
          {Row}
        </List>
      ) : (
        <div className="subnet-items">
          {sortedSubnets.map(subnet => (
            <SubnetItem
              key={subnet.id}
              subnet={subnet}
              isSelected={selectedSubnet?.id === subnet.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default React.memo(SubnetList);
