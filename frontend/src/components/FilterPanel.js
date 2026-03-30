import React, { useCallback, useMemo, useState } from 'react';
import './FilterPanel.css';

function FilterPanel({
  subnets,
  filters,
  onFiltersChange,
  isExpanded = true,
  onToggleExpand,
}) {
  const [collapsedTags, setCollapsedTags] = useState({});
  const {
    searchText,
    selectedAZs,
    minUtilization,
    maxUtilization,
    selectedFragmentationLevels,
    selectedTagFilters,
    filterByIP,
  } = filters;

  // Extract unique availability zones from subnets
  const uniqueAZs = useMemo(() => {
    const azSet = new Set(subnets.map(s => s.availabilityZone));
    return Array.from(azSet).sort();
  }, [subnets]);

  // Extract unique tag values by tag key
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

  // Helper to validate IP address
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

  // Handle AZ filter toggle
  const toggleAZ = useCallback((az) => {
    const updated = selectedAZs.includes(az)
      ? selectedAZs.filter(a => a !== az)
      : [...selectedAZs, az];
    onFiltersChange({ ...filters, selectedAZs: updated });
  }, [filters, selectedAZs, onFiltersChange]);

  // Handle fragmentation level toggle
  const toggleFragmentationLevel = useCallback((level) => {
    const updated = selectedFragmentationLevels.includes(level)
      ? selectedFragmentationLevels.filter(l => l !== level)
      : [...selectedFragmentationLevels, level];
    onFiltersChange({ ...filters, selectedFragmentationLevels: updated });
  }, [filters, selectedFragmentationLevels, onFiltersChange]);

  // Handle tag filter toggle
  const toggleTagFilter = useCallback((tagKey, value) => {
    const current = selectedTagFilters[tagKey] || [];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    onFiltersChange({
      ...filters,
      selectedTagFilters: { ...selectedTagFilters, [tagKey]: updated }
    });
  }, [filters, selectedTagFilters, onFiltersChange]);

  // Reset all filters
  const resetFilters = useCallback(() => {
    onFiltersChange({
      searchText: '',
      selectedAZs: [],
      minUtilization: 0,
      maxUtilization: 100,
      selectedFragmentationLevels: ['Low', 'Moderate', 'High'],
      selectedTagFilters: {},
      filterByIP: '',
    });
  }, [onFiltersChange]);

  // Validate IP error
  const ipFilterError = filterByIP && !isValidIP(filterByIP) ? 'Invalid IP address format' : '';

  // Handle tag section collapse toggle
  const toggleTagCollapse = useCallback((tagKey) => {
    setCollapsedTags(prev => ({
      ...prev,
      [tagKey]: !prev[tagKey]
    }));
  }, []);

  return (
    <div className={`filter-panel-sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="filter-panel-content">

        {/* Search Section */}
        <div className="filter-section">
          <label>Search:</label>
          <input
            type="text"
            className="filter-input search-input"
            placeholder="Subnet name..."
            value={searchText}
            onChange={(e) => onFiltersChange({ ...filters, searchText: e.target.value })}
          />
        </div>

        {/* IP Address Section */}
        <div className="filter-section">
          <label>IP Address:</label>
          <input
            type="text"
            className="filter-input"
            placeholder="e.g., 10.0.0.50"
            value={filterByIP}
            onChange={(e) => onFiltersChange({ ...filters, filterByIP: e.target.value })}
          />
          {ipFilterError && <span className="filter-error">{ipFilterError}</span>}
        </div>

        {/* Availability Zone Section */}
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
                        onFiltersChange({ ...filters, selectedAZs: [] });
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

        {/* Utilization Section */}
        <div className="filter-section">
          <label>Utilization: {minUtilization}% - {maxUtilization}%</label>
          <div className="filter-range">
            <input
              type="range"
              min="0"
              max="100"
              value={minUtilization}
              onChange={(e) => onFiltersChange({
                ...filters,
                minUtilization: Math.min(Number(e.target.value), maxUtilization)
              })}
              className="range-input"
            />
            <input
              type="range"
              min="0"
              max="100"
              value={maxUtilization}
              onChange={(e) => onFiltersChange({
                ...filters,
                maxUtilization: Math.max(Number(e.target.value), minUtilization)
              })}
              className="range-input"
            />
          </div>
        </div>

        {/* Fragmentation Level Section */}
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

        {/* Tags Section */}
        {Object.keys(availableTagValues).length > 0 && (
          <div className="filter-section filter-tags-section">
            <label>Tags:</label>
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

        {/* Reset Button */}
        <button className="reset-filters-btn" onClick={resetFilters}>
          Clear Filters
        </button>
      </div>
    </div>
  );
}

export default FilterPanel;
