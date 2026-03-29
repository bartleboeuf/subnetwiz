import React, { useCallback } from 'react';
import './RegionSelector.css';

function RegionSelector({ regions, selectedRegion, onSelect, loading }) {
  const handleChange = useCallback((e) => {
    const region = regions.find(r => r.id === e.target.value);
    onSelect(region || null);
  }, [regions, onSelect]);

  return (
    <div className="region-selector">
      <label htmlFor="region-select">AWS Region:</label>
      <select
        id="region-select"
        value={selectedRegion?.id || ''}
        onChange={handleChange}
        disabled={loading}
      >
        <option value="">-- Select a Region --</option>
        {regions.map(region => (
          <option key={region.id} value={region.id}>
            {region.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default React.memo(RegionSelector);
