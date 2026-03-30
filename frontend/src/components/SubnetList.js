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
      <div className="fragmentation-score">
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

function SubnetList({ subnets, selectedSubnet, onSelect, loading }) {
  const [sortBy, setSortBy] = useState('utilization'); // Sort by utilization by default
  const [filtersExpanded, setFiltersExpanded] = useState(false); // Filters collapsed by default

  // Filter state
  const [searchText, setSearchText] = useState('');
  const [selectedAZs, setSelectedAZs] = useState([]);
  const [minUtilization, setMinUtilization] = useState(0);
  const [maxUtilization, setMaxUtilization] = useState(100);
  const [selectedFragmentationLevels, setSelectedFragmentationLevels] = useState(['Low', 'Moderate', 'High']);

  // Sort state for Phase 15
  const [tagSortKey, setTagSortKey] = useState(null); // null = no tag sort
  const [cidrSortType, setCidrSortType] = useState('address'); // 'address' or 'size'

  // Filter state for Phase 15.3
  const [selectedTagFilters, setSelectedTagFilters] = useState({}); // { tagKey: [values] }

  // Filter state for Phase 15.4
  const [filterByIP, setFilterByIP] = useState('');
  const [ipFilterError, setIpFilterError] = useState('');

  // Tag filter UI state for condensed display
  const [collapsedTags, setCollapsedTags] = useState({}); // { tagKey: isCollapsed }

  // Extract unique availability zones from subnets
  const uniqueAZs = useMemo(() => {
    const azSet = new Set(subnets.map(s => s.availabilityZone));
    return Array.from(azSet).sort();
  }, [subnets]);

  // Extract unique tag keys from subnets (Phase 15)
  const availableTagKeys = useMemo(() => {
    const keys = new Set();
    subnets.forEach(subnet => {
      subnet.tags?.forEach(tag => keys.add(tag.key));
    });
    return Array.from(keys).sort();
  }, [subnets]);

  // Extract unique tag values by tag key (Phase 15.3)
  const availableTagValues = useMemo(() => {
    const tagMap = {};
    subnets.forEach(subnet => {
      subnet.tags?.forEach(tag => {
        if (!tagMap[tag.key]) tagMap[tag.key] = new Set();
        tagMap[tag.key].add(tag.value);
      });
    });
    // Convert Sets to sorted arrays
    Object.keys(tagMap).forEach(key => {
      tagMap[key] = Array.from(tagMap[key]).sort();
    });
    return tagMap;
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

  // Helper to validate IP address (Phase 15.4)
  const isValidIP = (ipString) => {
    try {
      const ip = new Address4(ipString);
      return ip.isCorrect();
    } catch {
      return false;
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

  // Handle AZ filter toggle
  const toggleAZ = useCallback((az) => {
    setSelectedAZs(prev =>
      prev.includes(az) ? prev.filter(a => a !== az) : [...prev, az]
    );
  }, []);

  // Handle fragmentation level toggle
  const toggleFragmentationLevel = useCallback((level) => {
    setSelectedFragmentationLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    );
  }, []);

  // Handle tag filter toggle (Phase 15.3)
  const toggleTagFilter = useCallback((tagKey, value) => {
    setSelectedTagFilters(prev => {
      const current = prev[tagKey] || [];
      const updated = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [tagKey]: updated };
    });
  }, []);

  // Handle tag section collapse toggle
  const toggleTagCollapse = useCallback((tagKey) => {
    setCollapsedTags(prev => ({
      ...prev,
      [tagKey]: !prev[tagKey]
    }));
  }, []);

  // Reset all filters
  const resetFilters = useCallback(() => {
    setSearchText('');
    setSelectedAZs([]);
    setMinUtilization(0);
    setMaxUtilization(100);
    setSelectedFragmentationLevels(['Low', 'Moderate', 'High']);
    setSelectedTagFilters({});
    setFilterByIP('');
    setIpFilterError('');
    setCollapsedTags({});
  }, []);

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
        <h3>Subnets ({filteredSubnets.length}/{subnets.length})</h3>
        <div className="header-controls">
          <button
            className="toggle-filters-btn"
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            title={filtersExpanded ? 'Collapse filters' : 'Expand filters'}
            aria-expanded={filtersExpanded}
            aria-label="Toggle filters"
          >
            <span className="filter-icon">⚙️</span>
            <span className={`toggle-arrow ${filtersExpanded ? 'expanded' : ''}`}>▼</span>
          </button>
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

      {/* Filter Panel */}
      <div className={`filter-panel ${filtersExpanded ? 'expanded' : 'collapsed'}`}>
        <div className="filter-section">
          <label>Search:</label>
          <input
            type="text"
            className="filter-input search-input"
            placeholder="Subnet name..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        <div className="filter-section">
          <label>IP Address:</label>
          <input
            type="text"
            className="filter-input"
            placeholder="e.g., 10.0.0.50"
            value={filterByIP}
            onChange={(e) => {
              const val = e.target.value;
              setFilterByIP(val);
              if (val && !isValidIP(val)) {
                setIpFilterError('Invalid IP address format');
              } else {
                setIpFilterError('');
              }
            }}
          />
          {ipFilterError && <span className="filter-error">{ipFilterError}</span>}
        </div>

        <div className="filter-section">
          <label>Availability Zone:</label>
          <div className="filter-checkboxes filter-checkboxes-grid-2col">
            {uniqueAZs.map(az => (
              <label key={az} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedAZs.length === 0 || selectedAZs.includes(az)}
                  onChange={() => {
                    if (selectedAZs.length === 0 || selectedAZs.includes(az)) {
                      if (selectedAZs.length === uniqueAZs.length - 1) {
                        setSelectedAZs([]);
                      } else {
                        toggleAZ(az);
                      }
                    } else {
                      toggleAZ(az);
                    }
                  }}
                />
                {az}
              </label>
            ))}
          </div>
        </div>

        <div className="filter-section">
          <label>Utilization: {minUtilization}% - {maxUtilization}%</label>
          <div className="filter-range">
            <input
              type="range"
              min="0"
              max="100"
              value={minUtilization}
              onChange={(e) => setMinUtilization(Math.min(Number(e.target.value), maxUtilization))}
              className="range-input"
            />
            <input
              type="range"
              min="0"
              max="100"
              value={maxUtilization}
              onChange={(e) => setMaxUtilization(Math.max(Number(e.target.value), minUtilization))}
              className="range-input"
            />
          </div>
        </div>

        <div className="filter-section">
          <label>Fragmentation Level:</label>
          <div className="filter-checkboxes filter-checkboxes-inline">
            {['Low', 'Moderate', 'High'].map(level => (
              <label key={level} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedFragmentationLevels.includes(level)}
                  onChange={() => toggleFragmentationLevel(level)}
                />
                {level}
              </label>
            ))}
          </div>
        </div>

        {Object.keys(availableTagValues).length > 0 && (
          <div className="filter-section filter-tags-section">
            <h4>Tags</h4>
            <div className="filter-tags-scroll">
              {Object.entries(availableTagValues).map(([tagKey, tagValues]) => (
                <div key={tagKey} className="filter-tag-group">
                  <button
                    className="tag-collapse-btn"
                    onClick={() => toggleTagCollapse(tagKey)}
                    aria-expanded={!collapsedTags[tagKey]}
                  >
                    <span className={`collapse-arrow ${collapsedTags[tagKey] ? 'collapsed' : ''}`}>▼</span>
                    {tagKey}
                    {selectedTagFilters[tagKey]?.length > 0 && (
                      <span className="tag-filter-badge">{selectedTagFilters[tagKey].length}</span>
                    )}
                  </button>
                  {!collapsedTags[tagKey] && (
                    <div className="filter-checkboxes tag-values">
                      {tagValues.map(value => (
                        <label key={value} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={selectedTagFilters[tagKey]?.includes(value) || false}
                            onChange={() => toggleTagFilter(tagKey, value)}
                          />
                          {value}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <button className="reset-filters-btn" onClick={resetFilters}>
          Clear Filters
        </button>
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
