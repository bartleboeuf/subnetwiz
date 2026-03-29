import React, { useMemo, useState, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
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

  // Extract unique availability zones from subnets
  const uniqueAZs = useMemo(() => {
    const azSet = new Set(subnets.map(s => s.availabilityZone));
    return Array.from(azSet).sort();
  }, [subnets]);

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
      return true;
    });
  }, [subnets, searchText, selectedAZs, minUtilization, maxUtilization, selectedFragmentationLevels]);

  // Memoize sorted subnets to avoid re-sorting on every render (must be before early returns)
  const sortedSubnets = useMemo(() => {
    const sorted = [...filteredSubnets];
    if (sortBy === 'utilization') {
      sorted.sort((a, b) => b.utilization - a.utilization);
    } else if (sortBy === 'fragmentation') {
      sorted.sort((a, b) => b.fragmentationScore - a.fragmentationScore);
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [filteredSubnets, sortBy]);

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

  // Reset all filters
  const resetFilters = useCallback(() => {
    setSearchText('');
    setSelectedAZs([]);
    setMinUtilization(0);
    setMaxUtilization(100);
    setSelectedFragmentationLevels(['Low', 'Moderate', 'High']);
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
          </select>
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
          <label>Availability Zone:</label>
          <div className="filter-checkboxes">
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
          <div className="filter-checkboxes">
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
